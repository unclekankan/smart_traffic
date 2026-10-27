"""
成都地铁线路 / 站点 GeoJSON 接口

数据来源：smart_traffic.transport schema 下 4 张表
  - chengdu_metro_routes        线路（42 条，含方向）
  - chengdu_metro_segments      站间区间段（807 段）
  - chengdu_metro_stops         站点明细（按线路方向展开，904 行）
  - chengdu_metro_stops_unique  去重物理站点（338 个）

所有空间字段通过 PostGIS 的 ST_AsGeoJSON 直接序列化为 GeoJSON geometry。
"""

import json
import re

from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor

from app.database import get_conn
from app.districts import district_of_point_geometry

router = APIRouter(prefix="/api/metro", tags=["metro"])

SCHEMA = "transport"

# 括号内容（方向说明 / 别名 / 嵌套站名），如「(韦家碾--科学城)」「(新都校区)」
_PAREN_RE = re.compile(r"[（(][^（）()]*[)）]")
# 线路分段与环向后缀，如「三期」「北延段」「临江段」「内环」
_SUFFIX_RE = re.compile(
    r"(内环|外环|北延段|南延段|东延段|西延段|临江段|支线|延长线|一期|二期|三期|四期|五期|六期)$"
)


def base_line_name(route_cn: str | None) -> str | None:
    """
    归一化线路名：同一线路的不同方向 / 分期 / 别名应归为同一条线。

    「地铁1号线(韦家碾--科学城)」            -> 「地铁1号线」
    「地铁10号线三期(人民公园--太平园)」     -> 「地铁10号线」
    「地铁7号线内环(火车北站--火车北站)」    -> 「地铁7号线」
    「地铁3号线(双流西站--成都医学院(新都校区))」-> 「地铁3号线」
    """
    if not route_cn:
        return route_cn
    cleaned = route_cn.strip()
    # 括号可能嵌套（站名内再带括号），逐层剥离直到稳定
    while True:
        stripped = _PAREN_RE.sub("", cleaned).strip()
        if stripped == cleaned:
            break
        cleaned = stripped
    # 剥离分期 / 环向 / 支线等后缀（可能叠加，如「北延段」+「一期」）
    while True:
        stripped = _SUFFIX_RE.sub("", cleaned).strip()
        if stripped == cleaned:
            break
        cleaned = stripped
    return cleaned or route_cn


def _summarize_lines(route_rows: list[dict]) -> list[dict]:
    """把同一线路的多个方向归并为一条，供前端展示「XX 号线经过该站」。"""
    grouped: dict[str, dict] = {}
    for row in route_rows:
        name = base_line_name(row["route_cn"])
        if not name:
            continue
        item = grouped.setdefault(name, {"name": name, "directions": []})
        direction = row["route_cn"]
        if direction and direction not in item["directions"]:
            item["directions"].append(direction)
    # 按线路编号排序（地铁1号线 < 地铁2号线 < …），便于阅读
    return sorted(grouped.values(), key=lambda x: _line_sort_key(x["name"]))


def _line_sort_key(name: str) -> tuple[int, int]:
    match = re.search(r"(\d+)", name or "")
    return (0 if (name or "").startswith("地铁") else 1, int(match.group(1)) if match else 999)

# 线路列表/展示所需的属性字段（按业务含义保留原始列名）
ROUTE_PROPS = [
    "id",
    "route_cn",
    "route_en",
    "city_code",
    "route_type",
    "type_en",
    "company_cn",
    "company_en",
    "s_stop_cn",
    "s_stop_en",
    "e_stop_cn",
    "e_stop_en",
    "distance",
    "total_stop",
    "start_time",
    "end_time",
    "loop",
    "status",
    "basic_prc",
    "total_prc",
    "city_cn",
    "city_en",
    "merged_cnt",
    "length",
]


def _row_to_feature(row: dict) -> dict:
    """将含 geom_geojson 字符串的数据库行转为 GeoJSON Feature。"""
    geom_str = row.pop("geom_geojson", None)
    geometry = json.loads(geom_str) if geom_str else None
    return {"type": "Feature", "geometry": geometry, "properties": dict(row)}


# ------------------------------------------------------------------ #
# 线路
# ------------------------------------------------------------------ #

@router.get("/routes", summary="获取全部地铁线路（GeoJSON）")
def get_routes():
    """
    返回成都全部地铁线路的 GeoJSON FeatureCollection。
    每条线路为一个 MultiLineString Feature，properties 包含线路名称、起终站、
    里程、站数、首末班时间、票价、运营状态等展示字段。
    """
    cols = ", ".join(ROUTE_PROPS)
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT {cols}, ST_AsGeoJSON(geom) AS geom_geojson
                FROM {SCHEMA}.chengdu_metro_routes
                ORDER BY id
                """
            )
            rows = cur.fetchall()

    features = [_row_to_feature(dict(r)) for r in rows]
    return {"type": "FeatureCollection", "features": features}


@router.get("/routes/{route_id}", summary="获取单条线路详情")
def get_route_detail(route_id: int):
    """
    返回指定线路的完整详情：
      - route: 线路本身（GeoJSON Feature）
      - stops: 该线路方向上的所有站点（按 sequence 排序的 GeoJSON Point 集合）
      - segments: 该线路的站间区间段（GeoJSON MultiLineString 集合）
    """
    cols = ", ".join(ROUTE_PROPS)
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1) 线路本体
            cur.execute(
                f"""
                SELECT {cols}, ST_AsGeoJSON(geom) AS geom_geojson
                FROM {SCHEMA}.chengdu_metro_routes
                WHERE id = %s
                """,
                (route_id,),
            )
            route_row = cur.fetchone()
            if not route_row:
                raise HTTPException(status_code=404, detail=f"线路 {route_id} 不存在")

            route_cn = route_row["route_cn"]
            route = _row_to_feature(dict(route_row))

            # 2) 该方向站点（按 sequence 排序）
            cur.execute(
                f"""
                SELECT id, name_cn, name_en, stop_id, route_cn, route_en,
                       route_id, city_code, city_cn, city_en,
                       sequence, merged_cnt, ST_AsGeoJSON(geom) AS geom_geojson
                FROM {SCHEMA}.chengdu_metro_stops
                WHERE route_cn = %s
                ORDER BY sequence
                """,
                (route_cn,),
            )
            stop_rows = cur.fetchall()

            # 3) 该线路的站间区间段
            # segments 表无 route_id，需用「有序相邻站点对」精确匹配：
            # 先取该线路所有起点站的区间段，再在 Python 端按相邻 stop_id 对过滤。
            stop_ids = [r["stop_id"] for r in stop_rows]
            # 环线首尾相连，非环线到末站为止
            is_loop = str(route_row["loop"]) == "1"
            if is_loop and len(stop_ids) > 1:
                ordered_pairs = set(zip(stop_ids, stop_ids[1:] + [stop_ids[0]]))
            else:
                ordered_pairs = set(zip(stop_ids, stop_ids[1:]))

            if stop_ids:
                cur.execute(
                    f"""
                    SELECT seg.id, seg.s_stop_cn, seg.s_stop_en, seg.s_stopid,
                           seg.e_stop_cn, seg.e_stop_en, seg.e_stopid,
                           seg.distance, seg.city_cn, seg.city_en, seg.num,
                           ST_AsGeoJSON(seg.geom) AS geom_geojson
                    FROM {SCHEMA}.chengdu_metro_segments seg
                    WHERE seg.s_stopid = ANY(%s)
                    """,
                    (stop_ids,),
                )
                seg_rows = [
                    r for r in cur.fetchall()
                    if (r["s_stopid"], r["e_stopid"]) in ordered_pairs
                ]
            else:
                seg_rows = []

    stop_features = [_row_to_feature(dict(r)) for r in stop_rows]
    seg_features = [_row_to_feature(dict(r)) for r in seg_rows]

    return {
        "route": route,
        "stops": {"type": "FeatureCollection", "features": stop_features},
        "segments": {"type": "FeatureCollection", "features": seg_features},
    }


# ------------------------------------------------------------------ #
# 站点
# ------------------------------------------------------------------ #

@router.get("/stops", summary="获取全部去重站点（GeoJSON）")
def get_stops():
    """
    返回成都全部去重物理站点的 GeoJSON FeatureCollection（338 个 Point）。
    properties.district 为站点所属区县（由区县边界空间定位得出）；
    properties.lines 为途经线路（已按线路归一化，如「地铁1号线」），
    properties.line_count 为途经线路条数（用于换乘站识别）。
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT id, stop_cn, stop_en, stop_id,
                       city_cn, city_en, ST_AsGeoJSON(geom) AS geom_geojson
                FROM {SCHEMA}.chengdu_metro_stops_unique
                ORDER BY id
                """
            )
            rows = cur.fetchall()

            # 一次取回全部「站点-线路方向」关系，在内存中按站点归并线路
            cur.execute(
                f"""
                SELECT stop_id, route_cn FROM {SCHEMA}.chengdu_metro_stops
                """
            )
            lines_by_stop: dict[str, list[dict]] = {}
            for relation in cur.fetchall():
                lines_by_stop.setdefault(relation["stop_id"], []).append(dict(relation))

    features = []
    for row in rows:
        feature = _row_to_feature(dict(row))
        properties = feature["properties"]
        lines = _summarize_lines(lines_by_stop.get(properties["stop_id"], []))
        properties["district"] = district_of_point_geometry(feature["geometry"])
        properties["lines"] = lines
        properties["line_count"] = len(lines)
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}


@router.get("/stops/{stop_id}", summary="获取单个站点详情")
def get_stop_detail(stop_id: str):
    """
    返回指定站点（按 stop_id）的详情：
      - stop: 站点本身（含所属区县 district、途经线路 lines / line_count）
      - lines: 途经该站的线路（已按线路归一化并排序，如「地铁1号线」）
      - routes: 途经该站的所有线路方向明细（来自 chengdu_metro_stops）
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT id, stop_cn, stop_en, stop_id,
                       city_cn, city_en, ST_AsGeoJSON(geom) AS geom_geojson
                FROM {SCHEMA}.chengdu_metro_stops_unique
                WHERE stop_id = %s
                """,
                (stop_id,),
            )
            stop_row = cur.fetchone()
            if not stop_row:
                raise HTTPException(status_code=404, detail=f"站点 {stop_id} 不存在")

            stop = _row_to_feature(dict(stop_row))

            cur.execute(
                f"""
                SELECT id, name_cn, name_en, stop_id, route_cn, route_en,
                       route_id, sequence, merged_cnt
                FROM {SCHEMA}.chengdu_metro_stops
                WHERE stop_id = %s
                ORDER BY route_cn, sequence
                """,
                (stop_id,),
            )
            route_rows = [dict(r) for r in cur.fetchall()]

    lines = _summarize_lines(route_rows)
    stop["properties"]["district"] = district_of_point_geometry(stop["geometry"])
    stop["properties"]["lines"] = lines
    stop["properties"]["line_count"] = len(lines)

    return {
        "stop": stop,
        "lines": lines,
        "routes": route_rows,
    }
