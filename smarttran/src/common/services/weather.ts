/**
 * 天气服务（Open-Meteo 免费接口，无需 API Key）
 *
 * - 单次批量请求：成都市 + 20 个区县的实时天气
 * - WMO 天气码 → 中文文案 / 图标的映射集中在本文件
 * 文档：https://open-meteo.com/en/docs
 */

import { CHENGDU_CITY, CHENGDU_DISTRICTS } from '../constants/chengdu'

export interface WeatherNow {
  /** 区域名（成都市 / 区县名） */
  name: string
  temperatureC: number
  weatherCode: number
  /** 中文天气描述 */
  text: string
  /** 图标（emoji，演示用） */
  icon: string
  windSpeedKmh: number
  humidity: number
}

interface OpenMeteoCurrent {
  temperature_2m: number
  relative_humidity_2m: number
  weather_code: number
  wind_speed_10m: number
}

/** WMO Weather interpretation codes → 中文 + 图标 */
const WMO_MAP: Record<number, { text: string; icon: string }> = {
  0: { text: '晴', icon: '☀️' },
  1: { text: '大部晴朗', icon: '🌤️' },
  2: { text: '多云', icon: '⛅' },
  3: { text: '阴', icon: '☁️' },
  45: { text: '雾', icon: '🌫️' },
  48: { text: '冻雾', icon: '🌫️' },
  51: { text: '小毛毛雨', icon: '🌦️' },
  53: { text: '毛毛雨', icon: '🌦️' },
  55: { text: '大毛毛雨', icon: '🌧️' },
  61: { text: '小雨', icon: '🌦️' },
  63: { text: '中雨', icon: '🌧️' },
  65: { text: '大雨', icon: '🌧️' },
  66: { text: '冻雨', icon: '🌧️' },
  67: { text: '强冻雨', icon: '🌧️' },
  71: { text: '小雪', icon: '🌨️' },
  73: { text: '中雪', icon: '🌨️' },
  75: { text: '大雪', icon: '❄️' },
  77: { text: '雪粒', icon: '🌨️' },
  80: { text: '小阵雨', icon: '🌦️' },
  81: { text: '阵雨', icon: '🌧️' },
  82: { text: '强阵雨', icon: '⛈️' },
  85: { text: '小阵雪', icon: '🌨️' },
  86: { text: '强阵雪', icon: '❄️' },
  95: { text: '雷暴', icon: '⛈️' },
  96: { text: '雷暴伴冰雹', icon: '⛈️' },
  99: { text: '强雷暴伴冰雹', icon: '⛈️' },
}

function describe(code: number): { text: string; icon: string } {
  return WMO_MAP[code] ?? { text: '未知', icon: '🌡️' }
}

/**
 * 拉取成都全市实时天气（市本级 + 各区县，一次 HTTP 请求）
 * Open-Meteo 支持 latitude/longitude 逗号分隔批量查询。
 */
export async function fetchChengduWeather(): Promise<WeatherNow[]> {
  const all = [CHENGDU_CITY, ...CHENGDU_DISTRICTS]
  const lat = all.map((d) => d.center[1]).join(',')
  const lon = all.map((d) => d.center[0]).join(',')
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&timezone=Asia%2FShanghai'

  const res = await fetch(url)
  if (!res.ok) throw new Error(`天气服务请求失败：HTTP ${res.status}`)
  const payload = (await res.json()) as Array<{ current: OpenMeteoCurrent }>
  if (!Array.isArray(payload) || payload.length !== all.length) {
    throw new Error('天气服务返回数据异常')
  }

  return payload.map((item, i) => {
    const { text, icon } = describe(item.current.weather_code)
    return {
      name: all[i]!.name,
      temperatureC: item.current.temperature_2m,
      weatherCode: item.current.weather_code,
      text,
      icon,
      windSpeedKmh: item.current.wind_speed_10m,
      humidity: item.current.relative_humidity_2m,
    }
  })
}
