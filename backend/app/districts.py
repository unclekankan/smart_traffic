"""
成都市行政区划边界与点定位

边界数据来自公开的成都市（510100）区县 GeoJSON，随项目一同存放，
避免运行时依赖外部网络服务。定位算法为射线法（ray casting），
并先用区县外接矩形做快速排除。
"""

import json
from functools import lru_cache
from pathlib import Path

_GEOJSON_PATH = Path(__file__).resolve().parent / "data" / "chengdu_districts.geojson"


def _polygon_rings(geometry: dict):
    """展开 Polygon / MultiPolygon 的各个环坐标。"""
    if geometry["type"] == "Polygon":
        yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield from polygon


def _ring_bbox(ring: list) -> tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def _point_in_ring(lon: float, lat: float, ring: list) -> bool:
    """射线法判断点是否落在环内（奇数次穿越即在内）。"""
    inside = False
    count = len(ring)
    for i in range(count):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % count][0], ring[(i + 1) % count][1]
        if (y1 > lat) != (y2 > lat):
            cross_lon = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lon < cross_lon:
                inside = not inside
    return inside


@lru_cache(maxsize=1)
def _districts() -> tuple[tuple[str, tuple[tuple[float, float, float, float], list]], ...]:
    """加载区县边界，返回 (区县名, (外接矩形, 环列表)) 列表。"""
    data = json.loads(_GEOJSON_PATH.read_text(encoding="utf-8"))
    districts = []
    for feature in data.get("features", []):
        name = (feature.get("properties") or {}).get("name")
        geometry = feature.get("geometry") or {}
        if not name or not geometry.get("type"):
            continue
        rings = [ring for ring in _polygon_rings(geometry) if len(ring) >= 4]
        if not rings:
            continue
        # 整体外接矩形：所有环的并集范围
        boxes = [_ring_bbox(r) for r in rings]
        bbox = (
            min(b[0] for b in boxes),
            min(b[1] for b in boxes),
            max(b[2] for b in boxes),
            max(b[3] for b in boxes),
        )
        districts.append((name, (bbox, rings)))
    return tuple(districts)


@lru_cache(maxsize=4096)
def locate_district(lon: float, lat: float) -> str | None:
    """返回坐标所在的成都区县名称；不在成都市域内返回 None。"""
    for name, (bbox, rings) in _districts():
        min_lon, min_lat, max_lon, max_lat = bbox
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue
        if any(_point_in_ring(lon, lat, ring) for ring in rings):
            return name
    return None


def district_of_point_geometry(geometry: dict | None) -> str | None:
    """对 GeoJSON Point geometry 求所属区县。"""
    if not geometry or geometry.get("type") != "Point":
        return None
    lon, lat = geometry["coordinates"][0], geometry["coordinates"][1]
    return locate_district(round(lon, 6), round(lat, 6))
