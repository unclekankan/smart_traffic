/**
 * 缓冲圆几何工具
 *
 * 仅提供测地缓冲圆（正多边形近似）的生成，用于地图叠加层渲染
 * （如附近站点查询的搜索范围圈）。
 * 站点缓冲区覆盖分析中的 ST_Buffer / ST_Union / 面积统计
 * 全部由后端 PostGIS 完成，前端不做空间计算。
 */

import type { LngLat, PolygonGeom } from '@/common/types/geo'
import { toRad } from './coordinate'

/**
 * 生成测地缓冲圆（正多边形近似）。
 * @param center 圆心经纬度
 * @param radiusM 半径（米）
 * @param segments 边数，默认 96，保证圆形观感
 */
export function createGeodesicBuffer(center: LngLat, radiusM: number, segments = 96): PolygonGeom {
  const [lon, lat] = center
  const dLat = radiusM / 111_320
  const dLon = radiusM / (111_320 * Math.cos(toRad(lat)))
  const ring: LngLat[] = []
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * 2 * Math.PI
    ring.push([lon + dLon * Math.cos(theta), lat + dLat * Math.sin(theta)])
  }
  ring.push(ring[0]!)
  return { type: 'Polygon', coordinates: [ring] }
}
