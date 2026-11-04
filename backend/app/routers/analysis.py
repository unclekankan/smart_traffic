"""
空间分析接口（全部空间计算由 PostGIS 完成，前端只做渲染）

功能 A：附近站点查询
  GET /api/analysis/nearby-stops?lon&lat&radius
  以任意点为圆心，用 ST_DWithin(geography) 同时检索半径内的
  地铁站（chengdu_metro_stops_unique）与公交站（chengdu_bus_stops_unique），
  按 ST_Distance 距离升序返回。

功能 B：站点缓冲区覆盖分析
  GET /api/analysis/station-buffers?radius&kind
  ST_Buffer(geography) 逐站生成服务范围，ST_Union 求覆盖并集面积；
  重叠面积 = 缓冲区总面积 - 并集面积；
  重叠站点数用 ST_ClusterDBSCAN（eps = 2r）统计。
  缓冲区与覆盖并集通过 ST_AsGeoJSON 输出，前端仅渲染不计算。
"""

import json

from fastapi import APIRouter, HTTPException, Query
from psycopg2.extras import RealDictCursor

from app.database import get_conn

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

SCHEMA = "transport"

# 站点数据源：网络类型 → (表名, 主键列, 名称列)
STOP_TABLES = {
    "metro": (f"{SCHEMA}.chengdu_metro_stops_unique", "stop_id", "stop_cn"),
    "bus": (f"{SCHEMA}.chengdu_bus_stops_unique", "stop_id", "stop_cn"),
}

# 附近站点查询单次返回上限（防止大半径下返回过多点位）
NEARBY_LIMIT = 1000

# 缓冲圆的每象限分段数（值越大越圆滑，公交站数量大用较低值控制体积）
QUAD_SEGS = {"metro": 8, "bus": 4, "all": 4}


def _grid_cell(kind: str, radius: int) -> float:
    """覆盖色带的网格边长（度）。

    地铁站数量少可用细网格（约 200m）保证色带细腻；
    公交站密度高、半径越大用更粗网格，控制 SQL 计算量与响应体积。
    """
    if kind == "metro":
        return 0.002
    if radius <= 300:
        return 0.004
    if radius <= 500:
        return 0.005
    return 0.006


def _source_sql(kind: str) -> str:
    """按分析类型拼出站点源表 CTE（统一列：kind / id / name / geom）。"""
    parts = []
    for net in ("metro", "bus"):
        if kind != "all" and kind != net:
            continue
        table, id_col, name_col = STOP_TABLES[net]
        parts.append(
            f"SELECT '{net}' AS kind, {id_col} AS id, {name_col} AS name, geom FROM {table}"
        )
    return " UNION ALL ".join(parts)


# ------------------------------------------------------------------ #
# 功能 A：附近站点查询
# ------------------------------------------------------------------ #

@router.get("/nearby-stops", summary="附近站点查询（地铁站 + 公交站，按距离排序）")
def nearby_stops(
    lon: float = Query(..., ge=-180, le=180, description="中心点经度"),
    lat: float = Query(..., ge=-90, le=90, description="中心点纬度"),
    radius: int = Query(default=500, ge=100, le=3000, description="搜索半径（米）"),
):
    """
    以 (lon, lat) 为圆心检索半径内的所有地铁站与公交站。
    ST_DWithin 使用 geography 单位（米），距离同样按 geography 精确计算。
    """
    parts = []
    for net, (table, id_col, name_col) in STOP_TABLES.items():
        parts.append(
            f"""
            SELECT '{net}' AS kind, s.{id_col} AS id, s.{name_col} AS name,
                   ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
                   ST_Distance(s.geom::geography, pt.geom::geography) AS distance_m
            FROM {table} s, pt
            WHERE ST_DWithin(s.geom::geography, pt.geom::geography, %(radius)s)
            """
        )

    sql = f"""
        WITH pt AS (SELECT ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326) AS geom)
        SELECT * FROM ({' UNION ALL '.join(parts)}) t
        ORDER BY distance_m
        LIMIT %(limit)s
    """

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, {"lon": lon, "lat": lat, "radius": radius, "limit": NEARBY_LIMIT})
            rows = cur.fetchall()

    stops = [
        {
            "kind": r["kind"],
            "id": r["id"],
            # 名称缺失时用站点 ID 兜底
            "name": r["name"] or r["id"],
            "lon": float(r["lon"]),
            "lat": float(r["lat"]),
            "distance_m": round(float(r["distance_m"]), 1),
        }
        for r in rows
    ]

    metro_count = sum(1 for s in stops if s["kind"] == "metro")
    bus_count = len(stops) - metro_count

    return {
        "center": [lon, lat],
        "radius_m": radius,
        "total": len(stops),
        "metro_count": metro_count,
        "bus_count": bus_count,
        "truncated": len(rows) >= NEARBY_LIMIT,
        "stops": stops,
    }


# ------------------------------------------------------------------ #
# 单站缓冲区影响分析
# ------------------------------------------------------------------ #

@router.get("/station-buffer", summary="单站缓冲区覆盖分析")
def station_buffer(
    kind: str = Query(..., pattern="^(metro|bus)$", description="站点类型"),
    id: str = Query(..., min_length=1, description="站点 stop_id"),
    radius: int = Query(default=500, ge=100, le=3000, description="分析半径（米）"),
):
    table, id_col, name_col = STOP_TABLES[kind]
    sql = f"""
        WITH station AS (
          SELECT {id_col} AS id, {name_col} AS name, geom
          FROM {table} WHERE {id_col} = %(id)s LIMIT 1
        ),
        area AS (
          SELECT id, name,
                 ST_Buffer(geom::geography, %(radius)s)::geometry AS buffer_geom
          FROM station
        ),
        nearby_metro AS (
          SELECT s.stop_id AS id, s.stop_cn AS name, s.geom
          FROM {SCHEMA}.chengdu_metro_stops_unique s, area a
          WHERE ST_DWithin(s.geom::geography, a.buffer_geom::geography, 0)
        ),
        nearby_bus AS (
          SELECT s.stop_id AS id, s.stop_cn AS name, s.geom
          FROM {SCHEMA}.chengdu_bus_stops_unique s, area a
          WHERE ST_DWithin(s.geom::geography, a.buffer_geom::geography, 0)
        ),
        nearby_metro_lines AS (
          SELECT r.id, r.route_cn AS name, r.geom
          FROM {SCHEMA}.chengdu_metro_routes r, area a
          WHERE ST_DWithin(r.geom::geography, a.buffer_geom::geography, 0)
        ),
        nearby_bus_lines AS (
          SELECT r.id, r.route_cn AS name, r.geom
          FROM {SCHEMA}.chengdu_bus_routes r, area a
          WHERE ST_DWithin(r.geom::geography, a.buffer_geom::geography, 0)
        )
        SELECT
          (SELECT ST_AsGeoJSON(buffer_geom) FROM area) AS buffer_geojson,
          (SELECT json_agg(json_build_object('type','Feature','geometry',ST_AsGeoJSON(geom)::json,
                    'properties',json_build_object('id',id,'name',name))) FROM nearby_metro) AS metro_features,
          (SELECT json_agg(json_build_object('type','Feature','geometry',ST_AsGeoJSON(geom)::json,
                    'properties',json_build_object('id',id,'name',name))) FROM nearby_bus) AS bus_features,
          (SELECT json_agg(json_build_object('type','Feature','geometry',ST_AsGeoJSON(geom)::json,
                    'properties',json_build_object('id',id,'name',name))) FROM nearby_metro_lines) AS metro_line_features,
          (SELECT json_agg(json_build_object('type','Feature','geometry',ST_AsGeoJSON(geom)::json,
                    'properties',json_build_object('id',id,'name',name))) FROM nearby_bus_lines) AS bus_line_features,
          (SELECT count(*) FROM nearby_metro) AS metro_count,
          (SELECT count(*) FROM nearby_bus) AS bus_count,
          (SELECT count(*) FROM nearby_metro_lines) AS metro_line_count,
          (SELECT count(*) FROM nearby_bus_lines) AS bus_line_count,
          (SELECT id FROM area) AS station_id,
          (SELECT name FROM area) AS station_name
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, {"id": id, "radius": radius})
            row = cur.fetchone()

    if not row or not row["buffer_geojson"]:
        raise HTTPException(status_code=404, detail=f"站点 {id} 不存在")

    buffer_geometry = json.loads(row["buffer_geojson"])
    metro_features = row["metro_features"] or []
    bus_features = row["bus_features"] or []
    metro_line_features = row["metro_line_features"] or []
    bus_line_features = row["bus_line_features"] or []
    return {
        "station": {"kind": kind, "id": row["station_id"], "name": row["station_name"]},
        "radius_m": radius,
        "buffer": {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": buffer_geometry,
             "properties": {"kind": kind, "id": row["station_id"], "name": row["station_name"]}}
        ]},
        "metro_stops": {"type": "FeatureCollection", "features": metro_features},
        "bus_stops": {"type": "FeatureCollection", "features": bus_features},
        "metro_lines": {"type": "FeatureCollection", "features": metro_line_features},
        "bus_lines": {"type": "FeatureCollection", "features": bus_line_features},
        "counts": {"metro_stops": int(row["metro_count"] or 0),
                   "bus_stops": int(row["bus_count"] or 0),
                   "metro_lines": int(row["metro_line_count"] or 0),
                   "bus_lines": int(row["bus_line_count"] or 0)},
    }


# ------------------------------------------------------------------ #
# 功能 B：站点缓冲区覆盖分析
# ------------------------------------------------------------------ #

@router.get("/station-buffers", summary="站点缓冲区覆盖分析（PostGIS 面积 / 重叠统计）")
def station_buffers(
    radius: int = Query(default=300, ge=100, le=1000, description="站点服务半径（米）"),
    kind: str = Query(default="metro", pattern="^(metro|bus|all)$", description="站点类型"),
):
    """
    逐站生成 ST_Buffer 服务范围并统计覆盖情况：

      - station_count          参与分析的站点数
      - buffer_area_km2        缓冲区总面积（逐站面积之和）
      - covered_area_km2       覆盖并集面积（ST_Union）
      - overlap_area_km2       重叠面积 = 缓冲总面积 - 并集面积
      - overlap_station_count  与其它站点缓冲区重叠的站点数（ST_ClusterDBSCAN）

    覆盖范围用 ST_SquareGrid 网格统计每个网格被多少站点缓冲区覆盖，
    经 3×3 邻域平滑后按密度分位（20/40/60/80%）分为 5 级，
    再合并同级网格，输出连成一片的热力色带 GeoJSON，前端仅按等级渲染颜色。
    """
    src = _source_sql(kind)
    qs = QUAD_SEGS[kind]
    cell = _grid_cell(kind, radius)
    # 色带轮廓轻微形态学平滑，网格边界简化以控制 GeoJSON 体积
    smooth = round(cell * 0.35, 6)
    tol = round(cell / 3.5, 6)

    main_sql = f"""
        WITH src AS ({src}),
             buf AS (
               SELECT kind, id, name,
                      ST_Buffer(geom::geography, %(radius)s, %(qs)s)::geometry AS g
               FROM src
             ),
             uni AS (SELECT ST_Union(g) AS geom FROM buf)
        SELECT (SELECT count(*) FROM buf) AS station_count,
               ST_Area((SELECT geom FROM uni)::geography) / 1e6 AS covered_km2,
               (SELECT sum(ST_Area(g::geography)) FROM buf) / 1e6 AS buffer_km2
    """

    # 重叠站点：中心距 ≤ 2r 即两个缓冲圆相交，用 DBSCAN 统计成簇站点
    overlap_sql = f"""
        WITH src AS ({src})
        SELECT count(*) AS n FROM (
          SELECT ST_ClusterDBSCAN(
                   ST_Transform(geom, 32648), eps := %(eps)s, minpoints := 2
                 ) OVER () AS cid
          FROM src
        ) t WHERE cid IS NOT NULL
    """

    # 覆盖色带：在覆盖范围上铺规则网格，统计每个网格被多少个站点缓冲区覆盖，
    # 再用 3×3 邻域均值做平滑，按覆盖层数（1-5+）合并同层网格 → 连成一片的热力色带
    # （1 层冷色 / 稀疏，5 层以上暖色 / 密集），不再输出单个站点圆。
    zone_sql = f"""
        WITH src AS ({src}),
             buf AS (
               SELECT kind, id,
                      ST_Buffer(geom::geography, %(radius)s, %(qs)s)::geometry AS g
               FROM src
             ),
             cells AS (
               SELECT b.kind, b.id, c.i, c.j, c.geom
               FROM buf b, LATERAL ST_SquareGrid(%(cell)s, b.g) c
               WHERE ST_Intersects(c.geom, b.g)
             ),
             grid AS (
               SELECT i, j,
                      count(DISTINCT kind || ':' || id) AS n,
                      ST_Union(geom) AS geom
               FROM cells
               GROUP BY i, j
             ),
             -- 邻域平滑：网格与其 8 个邻居的覆盖层数取平均（网格外视为 0），
             -- 消除逐格色差造成的马赛克感，让同密度的相邻网格归入同一色带
             offs AS (
               SELECT di, dj FROM (VALUES
                 (-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)
               ) o(di, dj)
             ),
             smooth AS (
               SELECT g.i, g.j, g.geom,
                      avg(COALESCE(h.n, 0)) AS ns
               FROM grid g
               CROSS JOIN offs o
               LEFT JOIN grid h ON h.i = g.i + o.di AND h.j = g.j + o.dj
               GROUP BY g.i, g.j, g.geom
             ),
             pct AS (
               SELECT percentile_cont(0.2) WITHIN GROUP (ORDER BY ns) AS p20,
                      percentile_cont(0.4) WITHIN GROUP (ORDER BY ns) AS p40,
                      percentile_cont(0.6) WITHIN GROUP (ORDER BY ns) AS p60,
                      percentile_cont(0.8) WITHIN GROUP (ORDER BY ns) AS p80
               FROM smooth
             ),
             zones AS (
               -- 按覆盖密度的 20/40/60/80 分位分级，保证稀疏区域浅、密集区域深，
               -- 色带在整幅图上都有层次（而非几乎全是最浅一档）
               SELECT CASE
                        WHEN s.ns <= p.p20 THEN 1
                        WHEN s.ns <= p.p40 THEN 2
                        WHEN s.ns <= p.p60 THEN 3
                        WHEN s.ns <= p.p80 THEN 4
                        ELSE 5
                      END AS lv,
                      ST_Union(s.geom) AS geom,
                      count(*) AS ncell
               FROM smooth s
               CROSS JOIN pct p
               GROUP BY 1
             )
        SELECT json_agg(
                 json_build_object(
                   'type', 'Feature',
                   'geometry', ST_AsGeoJSON(
                     ST_SimplifyPreserveTopology(
                       ST_Buffer(ST_Buffer(geom, %(smooth)s), -%(smooth)s),
                       %(tol)s
                     )
                   )::json,
                   'properties', json_build_object(
                     'role', 'zone', 'level', lv, 'cells', ncell
                   )
                 ) ORDER BY lv
               ) AS features,
               (SELECT count(*) FROM grid) AS cell_count
        FROM zones
    """

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(main_sql, {"radius": radius, "qs": qs})
            row = cur.fetchone()

            station_count = int(row["station_count"] or 0)
            covered = float(row["covered_km2"] or 0.0)
            buffer_area = float(row["buffer_km2"] or 0.0)

            # 缓冲圆相交判定（eps 使用米，投影到 UTM 48N 避免度单位的纬度差异）
            cur.execute(overlap_sql, {"eps": radius * 2})
            overlap_count = int(cur.fetchone()["n"] or 0)

            # 连续覆盖色带（无站点时跳过网格计算）
            zone_features: list = []
            cell_count = 0
            if station_count:
                cur.execute(
                    zone_sql,
                    {"radius": radius, "qs": qs, "cell": cell, "tol": tol, "smooth": smooth},
                )
                zone_row = cur.fetchone()
                raw = zone_row["features"]
                if raw:
                    zone_features = raw if isinstance(raw, list) else json.loads(raw)
                cell_count = int(zone_row["cell_count"] or 0)

    return {
        "radius_m": radius,
        "kind": kind,
        "station_count": station_count,
        "covered_area_km2": round(covered, 3),
        "buffer_area_km2": round(buffer_area, 3),
        "overlap_area_km2": round(max(buffer_area - covered, 0.0), 3),
        "overlap_station_count": overlap_count,
        # 覆盖色带（按覆盖层数 1-5+ 分级合并后的连续区域）
        "zones": {"type": "FeatureCollection", "features": zone_features},
        "cell_count": cell_count,
    }
