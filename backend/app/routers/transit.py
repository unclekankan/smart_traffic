"""
公共交通路线规划接口

GET /api/transit/plan       起终点 WGS84 → 公交 / 地铁 / 步行混合路线
GET /api/transit/cities     支持的城市编码
GET /api/transit/strategies 出行策略枚举

统一响应：{ code, message, data }，code=0 成功。
"""

from fastapi import APIRouter, Query

from app.services.transit_service import (
    STRATEGIES,
    TransitError,
    plan_transit,
)

router = APIRouter(prefix="/api/transit", tags=["transit"])

CITIES = [{"adcode": "028", "name": "成都"}]


def _ok(data) -> dict:
    return {"code": 0, "message": "ok", "data": data}


def _err(code: int, message: str) -> dict:
    return {"code": code, "message": message, "data": None}


@router.get("/plan", summary="公共交通路线规划（起终点经纬度 → 多方案）")
def transit_plan(
    origin: str = Query(..., description="起点 WGS84：lng,lat"),
    destination: str = Query(..., description="终点 WGS84：lng,lat"),
    city: str = Query("028", pattern=r"^\d{3,6}$", description="起点城市 adcode"),
    cityd: str | None = Query(None, pattern=r"^\d{3,6}$", description="终点城市 adcode（跨城时必填）"),
    strategy: int = Query(0, ge=0, le=6, description="出行策略（0-6）"),
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="出行日期 YYYY-MM-DD"),
    time_value: str | None = Query(None, alias="time", pattern=r"^\d{2}:\d{2}$", description="出行时间 HH:mm"),
    nightflag: int = Query(0, ge=0, le=1, description="0 白天 / 1 夜间"),
    max_alternatives: int = Query(3, ge=1, le=5, description="返回方案数量上限"),
):
    try:
        data = plan_transit(
            origin=origin,
            destination=destination,
            city=city,
            cityd=cityd,
            strategy=strategy,
            date=date,
            time_value=time_value,
            nightflag=nightflag,
            max_alternatives=max_alternatives,
        )
    except TransitError as exc:
        return _err(exc.code, exc.message)
    return _ok(data)


@router.get("/cities", summary="支持的城市编码列表")
def transit_cities():
    return _ok(CITIES)


@router.get("/strategies", summary="出行策略枚举")
def transit_strategies():
    return _ok(STRATEGIES)
