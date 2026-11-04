"""
公交 / 地铁路线规划处理流水线

输入：前端 WGS84 起终点
流程：WGS84→GCJ-02 → 高德公交规划 → 响应字段归一（步行 / 公交 / 地铁）
      → 全量坐标 GCJ-02→WGS84 → 组装前端可直接渲染的 TransitPlanResult

输出结构与《公共交通路线规划功能技术方案》第 6 节一致。
"""

from app.clients.amap import AmapError, fetch_transit
from app.core.coords import (
    gcj_polyline_to_wgs84,
    gcj02_to_wgs84,
    haversine_m,
    parse_lnglat,
    round_lnglat,
    wgs84_to_gcj02,
)

# 策略枚举（与高德 strategy 一一映射）
STRATEGIES: list[dict] = [
    {"value": 0, "label": "推荐路线"},
    {"value": 1, "label": "少换乘"},
    {"value": 2, "label": "少步行"},
    {"value": 3, "label": "不坐地铁"},
    {"value": 4, "label": "时间优先"},
    {"value": 5, "label": "地铁优先"},
    {"value": 6, "label": "公交优先"},
]
STRATEGY_LABELS = {item["value"]: item["label"] for item in STRATEGIES}

# 高德 v3 公交规划仅原生支持 0-3，扩展策略做等价映射：
# 时间优先 / 地铁优先 → 最快捷；公交优先 → 不乘地铁（无方案时再回退推荐路线）
AMAP_STRATEGY = {0: 0, 1: 1, 2: 2, 3: 3, 4: 0, 5: 0, 6: 3}

WALK_SPEED_MPS = 1.25  # 4.5 km/h
SAME_POINT_M = 5
WALK_ONLY_M = 50


class TransitError(Exception):
    """业务错误：code / message 直接回传前端。"""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _num(value) -> int:
    """高德数值字段可能是字符串、空列表或缺失。"""
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return 0


def _cost(value) -> float | None:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _point(value: str | None) -> list[float] | None:
    """高德 `lng,lat`（GCJ-02）→ WGS84 [lon, lat]。"""
    if not value:
        return None
    try:
        lon, lat = parse_lnglat(value)
    except ValueError:
        return None
    w_lon, w_lat = gcj02_to_wgs84(lon, lat)
    return [round_lnglat(w_lon, w_lat)[0], round_lnglat(w_lon, w_lat)[1]]


def _stop(raw: dict | None, default_name: str = "") -> dict | None:
    if not raw:
        return None
    loc = _point(raw.get("location"))
    if not loc:
        return None
    return {
        "id": str(raw.get("id") or ""),
        "name": str(raw.get("name") or default_name),
        "lng": loc[0],
        "lat": loc[1],
        "matched": False,
        "localId": None,
    }


def _walk_segment(walking: dict) -> dict | None:
    steps = walking.get("steps") or []
    points: list[list[float]] = []
    for step in steps:
        points.extend(gcj_polyline_to_wgs84(step.get("polyline")))
    if len(points) < 2:
        origin = _point(walking.get("origin"))
        destination = _point(walking.get("destination"))
        if origin and destination:
            points = [origin, destination]
    if len(points) < 2:
        return None

    departure = points[0]
    arrival = points[-1]
    # 最后一步的 assistant_action 常为「到达XX站」，优先用作步行终点名称
    arrival_name = "步行终点"
    for step in reversed(steps):
        action = step.get("assistant_action")
        if isinstance(action, str) and action.startswith("到达"):
            arrival_name = action[2:] or arrival_name
            break

    return {
        "type": "walk",
        "lineId": None,
        "lineName": None,
        "direction": "",
        "matched": False,
        "localLineId": None,
        "departureStop": {
            "id": "", "name": "起点", "lng": departure[0], "lat": departure[1],
            "matched": False, "localId": None,
        },
        "arrivalStop": {
            "id": "", "name": arrival_name, "lng": arrival[0], "lat": arrival[1],
            "matched": False, "localId": None,
        },
        "stops": [],
        "polyline": points,
        "durationSec": _num(walking.get("duration")),
        "distanceM": _num(walking.get("distance")),
        "cost": 0,
        "transfer": None,
    }


def _bus_segment(busline: dict) -> dict | None:
    name = str(busline.get("name") or "公交线路")
    line_type = str(busline.get("type") or "")
    # 优先使用高德 type 字段；缺失时才按线路名前缀判断，
    # 避免把名称中带有「地铁XX站」的公交线路误判为地铁
    is_metro = "地铁" in line_type or "轻轨" in line_type
    if not line_type:
        is_metro = name.startswith("地铁") or name.startswith("轻轨")

    polyline = gcj_polyline_to_wgs84(busline.get("polyline"))
    departure = _stop(busline.get("departure_stop"))
    arrival = _stop(busline.get("arrival_stop"))
    if len(polyline) < 2:
        if departure and arrival:
            polyline = [[departure["lng"], departure["lat"]], [arrival["lng"], arrival["lat"]]]
        else:
            return None

    # 途经站按顺序合并为完整站点序列
    stops: list[dict] = []
    if departure:
        stops.append({**departure, "seq": 1})
    for via in busline.get("via_stops") or []:
        stop = _stop(via)
        if stop:
            stops.append({**stop, "seq": len(stops) + 1})
    if arrival:
        stops.append({**arrival, "seq": len(stops) + 1})

    direction = str(busline.get("direction") or "")
    if not direction and "(" in name and "--" in name:
        # 名称形如「地铁2号线(犀浦--龙泉驿)」→ 终点方向
        inner = name[name.find("(") + 1:name.rfind(")")]
        tail = inner.split("--")[-1].strip()
        if tail:
            direction = f"{tail}方向"

    return {
        "type": "metro" if is_metro else "bus",
        "lineId": str(busline.get("id") or ""),
        "lineName": name,
        "direction": direction,
        "matched": False,
        "localLineId": None,
        "departureStop": departure or {
            "id": "", "name": "上车点", "lng": polyline[0][0], "lat": polyline[0][1],
            "matched": False, "localId": None,
        },
        "arrivalStop": arrival or {
            "id": "", "name": "下车点", "lng": polyline[-1][0], "lat": polyline[-1][1],
            "matched": False, "localId": None,
        },
        "stops": stops,
        "polyline": polyline,
        "durationSec": _num(busline.get("duration")),
        "distanceM": _num(busline.get("distance")),
        "cost": _cost(busline.get("cost")),
        "transfer": None,
    }


def _railway_segment(railway: dict | None) -> dict | None:
    """城际铁路 / 部分地铁线路由 railway 字段返回，统一归一为 metro。"""
    if not railway:
        return None
    polyline = gcj_polyline_to_wgs84(railway.get("polyline"))
    departure = _stop(railway.get("departure_stop"), "出发站")
    arrival = _stop(railway.get("arrival_stop"), "到达站")
    if len(polyline) < 2 and not (departure and arrival):
        return None
    if len(polyline) < 2:
        polyline = [[departure["lng"], departure["lat"]], [arrival["lng"], arrival["lat"]]]

    stops: list[dict] = []
    if departure:
        stops.append({**departure, "seq": 1})
    for via in railway.get("via_stops") or []:
        stop = _stop(via)
        if stop:
            stops.append({**stop, "seq": len(stops) + 1})
    if arrival:
        stops.append({**arrival, "seq": len(stops) + 1})

    return {
        "type": "metro",
        "lineId": str(railway.get("id") or ""),
        "lineName": str(railway.get("name") or "城际铁路"),
        "direction": str(railway.get("trip") or ""),
        "matched": False,
        "localLineId": None,
        "departureStop": departure or {
            "id": "", "name": "出发站", "lng": polyline[0][0], "lat": polyline[0][1],
            "matched": False, "localId": None,
        },
        "arrivalStop": arrival or {
            "id": "", "name": "到达站", "lng": polyline[-1][0], "lat": polyline[-1][1],
            "matched": False, "localId": None,
        },
        "stops": stops,
        "polyline": polyline,
        "durationSec": _num(railway.get("time")),
        "distanceM": _num(railway.get("distance")),
        "cost": None,
        "transfer": None,
    }


def _attach_transfers(segments: list[dict]) -> None:
    """为公交 / 地铁段补充到下一段的换乘步行信息（仅描述换乘关系，不新增段）。"""
    for index, seg in enumerate(segments):
        if seg["type"] not in ("bus", "metro"):
            continue
        if index + 1 >= len(segments):
            continue
        nxt = segments[index + 1]
        to_type = nxt["type"]
        if nxt["type"] == "walk":
            after = segments[index + 2] if index + 2 < len(segments) else None
            to_type = after["type"] if after and after["type"] in ("bus", "metro") else "walk"
            seg["transfer"] = {
                "toNextType": to_type,
                "walkingDurationSec": nxt["durationSec"],
                "walkingDistanceM": nxt["distanceM"],
            }
            continue
        dep = seg.get("arrivalStop") or {}
        arr = nxt.get("departureStop") or {}
        distance = round(haversine_m(dep.get("lng", 0), dep.get("lat", 0), arr.get("lng", 0), arr.get("lat", 0)))
        seg["transfer"] = {
            "toNextType": to_type,
            "walkingDurationSec": round(distance / WALK_SPEED_MPS),
            "walkingDistanceM": distance,
        }


def _alternative(transit: dict, index: int, strategy: int) -> dict | None:
    segments: list[dict] = []
    for raw in transit.get("segments") or []:
        walk = _walk_segment(raw.get("walking") or {})
        if walk:
            segments.append(walk)
        buslines = (raw.get("bus") or {}).get("buslines") or []
        if buslines:
            bus = _bus_segment(buslines[0])
            if bus:
                segments.append(bus)
        else:
            rail = _railway_segment(raw.get("railway"))
            if rail:
                segments.append(rail)

    if not segments:
        return None
    _attach_transfers(segments)

    transit_count = sum(1 for s in segments if s["type"] in ("bus", "metro"))
    walk_distance = sum(s["distanceM"] for s in segments if s["type"] == "walk")
    total_duration = _num(transit.get("duration")) or sum(s["durationSec"] for s in segments)
    total_distance = _num(transit.get("distance")) or sum(s["distanceM"] for s in segments)

    tags = [STRATEGY_LABELS.get(strategy, "推荐路线")]
    if any(s["type"] == "metro" for s in segments):
        tags.append("含地铁")

    return {
        "id": f"alt_{index}",
        "totalDurationSec": total_duration,
        "totalDistanceM": total_distance,
        "totalCost": _cost(transit.get("cost")),
        "transfers": max(0, transit_count - 1),
        "walkingDistanceM": _num(transit.get("walking_distance")) or walk_distance,
        "tags": tags,
        "segments": segments,
    }


def _walk_only(origin: list[float], destination: list[float]) -> dict:
    distance = round(haversine_m(origin[0], origin[1], destination[0], destination[1]))
    duration = max(1, round(distance / WALK_SPEED_MPS))
    segment = {
        "type": "walk",
        "lineId": None,
        "lineName": None,
        "direction": "",
        "matched": False,
        "localLineId": None,
        "departureStop": {"id": "", "name": "起点", "lng": origin[0], "lat": origin[1],
                          "matched": False, "localId": None},
        "arrivalStop": {"id": "", "name": "终点", "lng": destination[0], "lat": destination[1],
                        "matched": False, "localId": None},
        "stops": [],
        "polyline": [origin, destination],
        "durationSec": duration,
        "distanceM": distance,
        "cost": 0,
        "transfer": None,
    }
    return {
        "id": "alt_0",
        "totalDurationSec": duration,
        "totalDistanceM": distance,
        "totalCost": 0,
        "transfers": 0,
        "walkingDistanceM": distance,
        "tags": ["步行"],
        "segments": [segment],
    }


def plan_transit(
    *,
    origin: str,
    destination: str,
    city: str = "028",
    cityd: str | None = None,
    strategy: int = 0,
    date: str | None = None,
    time_value: str | None = None,
    nightflag: int = 0,
    max_alternatives: int = 3,
) -> dict:
    if strategy not in STRATEGY_LABELS:
        raise TransitError(40001, "不支持的出行策略")
    try:
        o_lon, o_lat = parse_lnglat(origin)
        d_lon, d_lat = parse_lnglat(destination)
    except ValueError as exc:
        raise TransitError(40001, str(exc)) from exc

    straight = haversine_m(o_lon, o_lat, d_lon, d_lat)
    if straight < SAME_POINT_M:
        raise TransitError(50004, "起点与终点相同")

    origin_wgs = [round_lnglat(o_lon, o_lat)[0], round_lnglat(o_lon, o_lat)[1]]
    destination_wgs = [round_lnglat(d_lon, d_lat)[0], round_lnglat(d_lon, d_lat)[1]]

    if straight < WALK_ONLY_M:
        return {
            "origin": origin_wgs,
            "destination": destination_wgs,
            "city": city,
            "strategy": strategy,
            "alternatives": [_walk_only(origin_wgs, destination_wgs)],
        }

    o_gcj = wgs84_to_gcj02(o_lon, o_lat)
    d_gcj = wgs84_to_gcj02(d_lon, d_lat)

    # 先按映射后的策略请求；无可用方案时自动回退「推荐路线」，
    # 避免「公交优先 / 地铁优先」等扩展策略直接报无路线
    effective = AMAP_STRATEGY[strategy]
    attempts = [effective]
    if effective != 0:
        attempts.append(0)

    alternatives: list[dict] = []
    amap_errors: list[AmapError] = []
    for amap_strategy in attempts:
        try:
            data = fetch_transit(
                origin=o_gcj,
                destination=d_gcj,
                city=city,
                cityd=cityd,
                strategy=amap_strategy,
                nightflag=nightflag,
                date=date,
                time_value=time_value,
            )
        except AmapError as exc:
            amap_errors.append(exc)
            continue

        transits = (data.get("route") or {}).get("transits") or []
        for index, transit in enumerate(transits):
            if len(alternatives) >= max(1, min(5, max_alternatives)):
                break
            alt = _alternative(transit, index, strategy)
            if alt:
                alternatives.append(alt)
        if alternatives:
            break

    if not alternatives:
        # 所有策略请求都失败：属于服务异常；否则属于「无可用方案」
        if amap_errors and len(amap_errors) == len(attempts):
            raise TransitError(50001, f"地图服务暂不可用：{amap_errors[-1]}")
        raise TransitError(
            50003,
            "该起终点间暂未找到匹配的公共交通方案，可尝试调整出行策略、"
            "重新选择更近的起终点，或改用驾车 / 骑行方式。",
        )

    return {
        "origin": origin_wgs,
        "destination": destination_wgs,
        "city": city,
        "strategy": strategy,
        "alternatives": alternatives,
    }
