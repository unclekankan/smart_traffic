/**
 * 坐标工具
 *
 * 平台内部统一使用 WGS84 经纬度；演示环境不涉及偏转坐标系，
 * GCJ-01 转换保留接口位以便接入真实底图时启用。
 */

import type { LngLat } from '@/common/types/geo'

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/** 度 → 弧度 */
export const toRad = (deg: number): number => deg * D2R

/** 弧度 → 度 */
export const toDeg = (rad: number): number => rad * R2D

/** 格式化为「120.2106°」样式 */
export function formatDegree(value: number, digits = 4): string {
  return `${value.toFixed(digits)}°`
}

/** 格式化为带方位的经纬度（状态栏用）：120.2106°E 30.2084°N */
export function formatLngLat([lon, lat]: LngLat): string {
  const ew = lon >= 0 ? 'E' : 'W'
  const ns = lat >= 0 ? 'N' : 'S'
  return `${formatDegree(Math.abs(lon))}${ew}  ${formatDegree(Math.abs(lat))}${ns}`
}

/** 十进制度 → 度分秒（如 30°12′30″） */
export function toDMS(value: number): string {
  const dir = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const d = Math.floor(abs)
  const mFloat = (abs - d) * 60
  const m = Math.floor(mFloat)
  const s = ((mFloat - m) * 60).toFixed(0)
  return `${dir}${d}°${String(m).padStart(2, '0')}′${s.padStart(2, '0')}″`
}

/**
 * 某纬度处 1° 经度的地面长度（米），用于平面近似换算。
 * 演示数据范围小（<4km），平面近似误差可忽略。
 */
export function metersPerDegreeLon(lat: number): number {
  return 111_320 * Math.cos(toRad(lat))
}

/** 1° 纬度的地面长度（米） */
export const METERS_PER_DEGREE_LAT = 111_320

/**
 * WGS-84 → GCJ-01（火星坐标）。接入国内在线底图（天地图/高德）时使用。
 * 算法为公开的通用近似实现。
 */
export function wgs84ToGcj02([lon, lat]: LngLat): LngLat {
  const outOfChina = lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
  if (outOfChina) return [lon, lat]

  const transformLon = (x: number, y: number): number => {
    let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
    ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
    ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3
    return ret
  }
  const transformLat = (x: number, y: number): number => {
    let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
    ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
    ret += ((160 * Math.sin((x / 12) * Math.PI) + 320 * Math.sin((x * Math.PI) / 30)) * 2) / 3
    return ret
  }

  const dLon = transformLon(lon - 105, lat - 35)
  const dLat = transformLat(lon - 105, lat - 35)
  const radLat = (lat / 180) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - 0.00669342162296594323 * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const offsetLon = (dLon * 180) / ((6378137 / sqrtMagic) * Math.cos(radLat) * Math.PI)
  const offsetLat = (dLat * 180) / ((6378137 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic) / Math.PI)
  return [lon + offsetLon, lat + offsetLat]
}
