/**
 * 量测工具
 *
 * 演示区范围小（约 4km），统一采用「等经纬平面近似」：
 * 距离与缓冲误差相对 300m 半径在 1% 量级，满足原型演示要求。
 * 接入真实业务时可替换为测地算法，接口保持不变。
 */

import type { LngLat } from '@/common/types/geo'
import { METERS_PER_DEGREE_LAT, metersPerDegreeLon, toRad } from './coordinate'

const EARTH_RADIUS_M = 6_371_008.8

/** 两点球面距离（Haversine，米） */
export function haversineDistance(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinLon * sinLon
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** 折线长度（米） */
export function pathLength(path: LngLat[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) total += haversineDistance(path[i - 1]!, path[i]!)
  return total
}

/** 点到线段最近点（平面近似，输入与输出均为经纬度） */
export function pointToSegment(p: LngLat, a: LngLat, b: LngLat): { point: LngLat; distanceM: number } {
  const latRef = p[1]
  const mPerLon = metersPerDegreeLon(latRef)
  // 将经度按当地比例转换为「米平面」再运算
  const px = p[0] * mPerLon
  const py = p[1] * METERS_PER_DEGREE_LAT
  const ax = a[0] * mPerLon
  const ay = a[1] * METERS_PER_DEGREE_LAT
  const bx = b[0] * mPerLon
  const by = b[1] * METERS_PER_DEGREE_LAT

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return {
    point: [cx / mPerLon, cy / METERS_PER_DEGREE_LAT],
    distanceM: Math.hypot(px - cx, py - cy),
  }
}

/** 点到折线的最短距离与最近点（平面近似，米） */
export function pointToPathDistance(p: LngLat, path: LngLat[]): { point: LngLat; distanceM: number } {
  let best = { point: path[0]!, distanceM: Number.POSITIVE_INFINITY }
  for (let i = 1; i < path.length; i++) {
    const r = pointToSegment(p, path[i - 1]!, path[i]!)
    if (r.distanceM < best.distanceM) best = r
  }
  return best
}

/** 由折线推算某点处的行进方位角（度，正北为 0，顺时针） */
export function bearingDeg(from: LngLat, to: LngLat): number {
  const mPerLon = metersPerDegreeLon(from[1])
  const dx = (to[0] - from[0]) * mPerLon
  const dy = (to[1] - from[1]) * METERS_PER_DEGREE_LAT
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI
  return (deg + 360) % 360
}
