"""
坐标系转换工具

系统内部（数据库、接口、前端）统一使用 WGS84 经纬度 [lon, lat]；
高德 API 使用 GCJ-02。本模块提供双向转换、坐标 / 轨迹字符串解析与精度控制，
转换算法与前端 `src/tools/geo/coordinate.ts` 的 wgs84ToGcj02 保持一致。
"""

import math

# 中国范围（之外不做偏移）
LON_MIN, LON_MAX = 72.004, 137.8347
LAT_MIN, LAT_MAX = 0.8293, 55.8271

# 统一保留小数位（6 位约 0.11 米）
PRECISION = 6

_A = 6378137.0
_EE = 0.00669342162296594323


def out_of_china(lon: float, lat: float) -> bool:
    return lon < LON_MIN or lon > LON_MAX or lat < LAT_MIN or lat > LAT_MAX


def _transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lon(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(x / 12.0 * math.pi) + 320.0 * math.sin(x * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def wgs84_to_gcj02(lon: float, lat: float) -> tuple[float, float]:
    """WGS84 → GCJ-02（中国境外的点原样返回）。"""
    if out_of_china(lon, lat):
        return lon, lat
    d_lat = _transform_lat(lon - 105.0, lat - 35.0)
    d_lon = _transform_lon(lon - 105.0, lat - 35.0)
    rad_lat = math.radians(lat)
    magic = 1.0 - _EE * math.sin(rad_lat) ** 2
    sqrt_magic = math.sqrt(magic)
    d_lat = (d_lat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi)
    d_lon = (d_lon * 180.0) / (_A / sqrt_magic * math.cos(rad_lat) * math.pi)
    return lon + d_lon, lat + d_lat


def gcj02_to_wgs84(lon: float, lat: float, iterations: int = 3) -> tuple[float, float]:
    """GCJ-02 → WGS84：迭代逼近，2–3 次即可收敛到厘米级。"""
    if out_of_china(lon, lat):
        return lon, lat
    w_lon, w_lat = lon, lat
    for _ in range(iterations):
        g_lon, g_lat = wgs84_to_gcj02(w_lon, w_lat)
        w_lon += lon - g_lon
        w_lat += lat - g_lat
    return w_lon, w_lat


def round_lnglat(lon: float, lat: float) -> tuple[float, float]:
    return round(lon, PRECISION), round(lat, PRECISION)


def valid_lnglat(lon: float, lat: float) -> bool:
    return -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0


def parse_lnglat(value: str) -> tuple[float, float]:
    """解析 `lng,lat` 字符串，格式或范围错误抛 ValueError。"""
    parts = [p.strip() for p in value.split(",")]
    if len(parts) != 2:
        raise ValueError("坐标格式应为 lng,lat")
    try:
        lon, lat = float(parts[0]), float(parts[1])
    except ValueError as exc:
        raise ValueError("坐标必须为数字") from exc
    if not valid_lnglat(lon, lat):
        raise ValueError("坐标超出合法经纬度范围")
    return lon, lat


def parse_polyline(value: str | None) -> list[tuple[float, float]]:
    """解析高德轨迹串 `lng,lat;lng,lat;...`，非法点自动跳过。"""
    if not value:
        return []
    points: list[tuple[float, float]] = []
    for item in value.split(";"):
        parts = item.split(",")
        if len(parts) != 2:
            continue
        try:
            lon, lat = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        if valid_lnglat(lon, lat):
            points.append((lon, lat))
    return points


def gcj_polyline_to_wgs84(value: str | None) -> list[list[float]]:
    """高德轨迹串 GCJ-02 → WGS84 坐标数组 [[lon, lat], ...]。"""
    out: list[list[float]] = []
    for lon, lat in parse_polyline(value):
        w_lon, w_lat = gcj02_to_wgs84(lon, lat)
        out.append([round_lnglat(w_lon, w_lat)[0], round_lnglat(w_lon, w_lat)[1]])
    return out


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """两点球面距离（米）。"""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_phi = p2 - p1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(d_lambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
