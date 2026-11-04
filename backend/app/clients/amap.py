"""
高德公交路线规划客户端

端点：https://restapi.amap.com/v3/direction/transit/integrated
仅在后端调用：密钥不写入日志、不下发前端。

- 连接 / 读取超时统一 8 秒
- 对网络异常、HTTP 5xx 与高德服务端类错误（10004/10021/10084）最多重试 2 次
- 参数错误、Key 问题、无结果不重试，直接抛出 AmapError
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

AMAP_URL = "https://restapi.amap.com/v3/direction/transit/integrated"

# 可通过环境变量 AMAP_KEY 覆盖；默认内置成都项目演示用 Web 服务 Key
DEFAULT_KEY = "78628d55e0e2a0e4bb33db020ae5a749"

TIMEOUT_SEC = 8
MAX_RETRIES = 2
RETRY_BACKOFF = (0.2, 0.4)

# 可重试的高德错误码（服务端繁忙 / 频率超限 / 内部错误）
RETRYABLE_INFOCDES = {"10004", "10021", "10084"}


class AmapError(Exception):
    """高德接口调用失败（已归一为可读信息）。"""

    def __init__(self, message: str, infocode: str | None = None):
        super().__init__(message)
        self.infocode = infocode


def amap_key() -> str:
    return os.getenv("AMAP_KEY", DEFAULT_KEY)


def _request(params: dict[str, str]) -> dict:
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{AMAP_URL}?{query}")
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_transit(
    *,
    origin: tuple[float, float],
    destination: tuple[float, float],
    city: str = "028",
    cityd: str | None = None,
    strategy: int = 0,
    nightflag: int = 0,
    date: str | None = None,
    time_value: str | None = None,
) -> dict:
    """调用高德公交规划接口，返回原始 JSON（GCJ-02 坐标）。"""
    params: dict[str, str] = {
        "key": amap_key(),
        "origin": f"{origin[0]:.6f},{origin[1]:.6f}",
        "destination": f"{destination[0]:.6f},{destination[1]:.6f}",
        "city": city,
        "strategy": str(strategy),
        "nightflag": str(nightflag),
        "extensions": "all",
        "show_fields": "cost,polyline",
    }
    if cityd:
        params["cityd"] = cityd
    if date:
        params["date"] = date
    if time_value:
        params["time"] = time_value

    last_error: AmapError | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            data = _request(params)
        except urllib.error.HTTPError as exc:
            last_error = AmapError(f"地图服务返回 HTTP {exc.code}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = AmapError(f"地图服务网络异常：{exc}")
        else:
            if str(data.get("status")) == "1":
                return data
            infocode = str(data.get("infocode") or "")
            message = str(data.get("info") or "地图服务返回错误")
            if infocode in RETRYABLE_INFOCDES and attempt < MAX_RETRIES:
                last_error = AmapError(message, infocode)
            else:
                raise AmapError(message, infocode)

        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BACKOFF[attempt])

    raise last_error or AmapError("地图服务不可用")
