"""
成都公交线路 / 站点 GeoJSON 接口

数据来源：smart_traffic.transport schema 下 2 张表
  - chengdu_bus_routes        线路（3048 条，含 MultiLineString 几何）
  - chengdu_bus_stops_unique  去重物理站点（13817 个 Point，**不含线路关联列**）

由于公交数据没有「线路-站点按顺序关联表」，某条线路的站点通过
 PostGIS `ST_DWithin(100m)` + `ST_LineLocatePoint` 空间过滤并沿线路排序得到。
距离阈值 100m 可排除紧邻但不属于该线的站点；若站点被排除，可放宽到 150m。
"""

import json
import re

from fastapi import APIRouter, HTTPException, Query
from psycopg2.extras import RealDictCursor

from app.database import get_conn

router = APIRouter(prefix="/api/bus", tags=["bus"])

SCHEMA = "transport"

# 沿线站点过滤距离（米）—— PostGIS geography ST_DWithin 用米做单位
STOP_DISTANCE_M = 100

# 线路列表要返回的字段（轻量，不含 geom，避免 3048 条 × 几 KB = 几 MB）
LIST_FIELDS = [
    "id", "route_cn", "route_en",
    "s_stop_cn", "e_stop_cn",
    "total_stop", "distance", "length",
    "route_type", "type_en",
    "company_cn",
    "loop", "status",
]

# 线路详情要返回的字段（带 geom）
DETAIL_FIELDS = LIST_FIELDS + ["start_time", "end_time", "basic_prc", "total_prc",
                               "city_cn", "city_en", "city_code"]


def _row_to_feature(row: dict) -> dict:
    """把 PostGIS ST_AsGeoJSON 结果组装成 GeoJSON Feature。"""
    geom_str = row.pop("geom_geojson", None)
    geometry = json.loads(geom_str) if geom_str else None
    return {"type": "Feature", "geometry": geometry, "properties": dict(row)}


# ------------------------------------------------------------------ #
# 列表
# ------------------------------------------------------------------ #

@router.get("/routes", summary="轻量公交线路列表（无几何，支持关键字搜索）")
def get_routes(q: str | None = Query(default=None, description="线路名/起终点站模糊搜索")):
    """
    返回全部公交线路的轻量摘要（3048 条，无 geom，约 400 KB）。
    支持可选 `q` 参数对 route_cn / s_stop_cn / e_stop_cn 做 ILIKE 搜索。
    """
    cols = ", ".join(LIST_FIELDS)
    sql = f"SELECT {cols} FROM {SCHEMA}.chengdu_bus_routes"
    params: tuple = ()
    if q:
        like = f"%{q}%"
        sql += " WHERE route_cn ILIKE %s OR s_stop_cn ILIKE %s OR e_stop_cn ILIKE %s"
        params = (like, like, like)
    sql += " ORDER BY id"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

    # 轻量列表不需要完整 Feature（没有 geom），直接返回 list[dict]
    return [dict(r) for r in rows]


# ------------------------------------------------------------------ #
# 公交站详情：所属线路由空间距离推断
# ------------------------------------------------------------------ #

@router.get("/stops/{stop_id}", summary="公交站点详情及附近线路")
def get_stop_detail(stop_id: str):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT id, stop_cn, stop_en, stop_id, num, city_cn, city_en
                FROM {SCHEMA}.chengdu_bus_stops_unique
                WHERE stop_id = %s
                LIMIT 1
                """,
                (stop_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"公交站 {stop_id} 不存在")
            stop = dict(row)
            cur.execute(
                f"""
                SELECT r.id, r.route_cn AS name,
                       ST_Distance(r.geom::geography, s.geom::geography) AS distance_m
                FROM {SCHEMA}.chengdu_bus_routes r
                JOIN {SCHEMA}.chengdu_bus_stops_unique s
                  ON s.stop_id = %s
                WHERE ST_DWithin(r.geom::geography, s.geom::geography, %s)
                ORDER BY distance_m, r.id
                """,
                (stop_id, STOP_DISTANCE_M),
            )
            lines = [
                {"id": r["id"], "name": r["name"], "distance_m": round(float(r["distance_m"]), 1)}
                for r in cur.fetchall()
            ]
    return {"stop": stop, "lines": lines, "line_count": len(lines), "line_distance_m": STOP_DISTANCE_M}


# ------------------------------------------------------------------ #
# 地图点击拾取：按经纬度找最近的公交线路
# ------------------------------------------------------------------ #

@router.get("/pick", summary="按经纬度拾取最近的公交线路（地图点击选线）")
def pick_route(
    lon: float = Query(..., ge=-180, le=180, description="点击点经度"),
    lat: float = Query(..., ge=-90, le=90, description="点击点纬度"),
    tolerance: float = Query(default=60, ge=1, le=500, description="拾取容差（米）"),
):
    """
    WMS 瓦片是服务端渲染图片，前端无法直接命中要素；
    这里用 PostGIS 按点击点做 60m 容差空间反查，返回距离最近的一条线路。
    无命中时返回 null。
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT r.id, r.route_cn,
                       ST_Distance(r.geom::geography, pt.geom) AS distance_m
                FROM {SCHEMA}.chengdu_bus_routes r,
                     (SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography AS geom) pt
                WHERE ST_DWithin(r.geom::geography, pt.geom, %s)
                ORDER BY distance_m
                LIMIT 1
                """,
                (lon, lat, tolerance),
            )
            row = cur.fetchone()

    if not row:
        return None
    return {
        "id": row["id"],
        "route_cn": row["route_cn"],
        "distance_m": round(float(row["distance_m"]), 1),
    }


# ------------------------------------------------------------------ #
# 详情：单条线路 + 沿线 100m 内按顺序排列的站点
# ------------------------------------------------------------------ #

@router.get("/routes/{route_id}", summary="单条线路详情：几何 + 沿线站点")
def get_route_detail(route_id: int):
    """
    返回指定线路的完整详情：
      - route: 线路本体 GeoJSON Feature（含 MultiLineString 几何 + 所有业务字段）
      - stops: 沿线 100m 内的站点 GeoJSON FeatureCollection（Point，
               按 `ST_LineLocatePoint` 得到的 frac 沿线路方向排序）
    站点属性里附带 `distance_m`（到线路的最短距离，供前端调阈值过滤）。
    """
    cols = ", ".join(DETAIL_FIELDS)
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT {cols}, ST_AsGeoJSON(geom) AS geom_geojson
                FROM {SCHEMA}.chengdu_bus_routes WHERE id = %s
                """,
                (route_id,),
            )
            route_row = cur.fetchone()
            if not route_row:
                raise HTTPException(status_code=404, detail=f"线路 {route_id} 不存在")

            route = _row_to_feature(dict(route_row))

            # 沿线空间过滤：JOIN 用 geography，ST_DWithin 单位为米
            cur.execute(
                f"""
                SELECT stop.id, stop.stop_cn, stop.stop_en, stop.stop_id,
                       stop.num, stop.city_cn, stop.city_en,
                       ST_AsGeoJSON(stop.geom) AS geom_geojson,
                       ST_Distance(stop.geom::geography, r.geom::geography) AS distance_m,
                       ST_LineLocatePoint(
                           ST_LineMerge(r.geom::geometry),
                           stop.geom::geometry
                       ) AS frac
                FROM {SCHEMA}.chengdu_bus_routes r
                JOIN {SCHEMA}.chengdu_bus_stops_unique stop
                  ON ST_DWithin(stop.geom::geography, r.geom::geography, %s)
                WHERE r.id = %s
                ORDER BY frac
                """,
                (STOP_DISTANCE_M, route_id),
            )
            stop_rows = cur.fetchall()

    stop_features = []
    for r in stop_rows:
        geom_str = r.pop("geom_geojson")
        geometry = json.loads(geom_str) if geom_str else None
        # distance_m 保留在 properties 供前端可选过滤
        distance = float(r.pop("distance_m") or 0.0)
        frac = float(r.pop("frac") or 0.0)
        props = {**dict(r), "distance_m": round(distance, 1), "frac": round(frac, 4)}
        stop_features.append({"type": "Feature", "geometry": geometry, "properties": props})

    stops_fc = {"type": "FeatureCollection", "features": stop_features}

    return {
        "route": route,
        "stops": stops_fc,
        "total_stop": len(stop_features),
        "stop_distance_m": STOP_DISTANCE_M,
    }
