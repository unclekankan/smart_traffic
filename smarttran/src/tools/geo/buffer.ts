/**
 * 缓冲区分析工具
 *
 * 对站点生成测地缓冲圆（对应原型「缓冲区分析 · 站点服务范围」），
 * 并对地铁线路 / 站点执行命中判定，产出结果表。
 */

import type { GeoJSONFeature, LngLat, PolygonGeom } from '@/common/types/geo'
import type { MetroRouteProps, MetroStopProps } from '@/common/types/metro'
import { allRouteFeatures, allStopFeatures } from '@/common/data/metroRepository'
import { toRad } from './coordinate'
import { haversineDistance, pointToPathDistance } from './measure'

export const BUFFER_RADIUS_LIMITS = { min: 10, max: 5000 } as const

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

export type SpatialRelation = '包含' | '相交' | '相邻'

export interface BufferHit {
  kind: 'road' | 'station'
  id: string
  name: string
  /** 类型文本（表格列） */
  typeText: string
  /** 距源对象距离（米），0 表示源对象自身 */
  distanceM: number
  relation: SpatialRelation
  /** 业务状态（当前均为正常运营） */
  status: string
  /** 源对象自身 */
  isSource: boolean
}

export interface BufferAnalysisResult {
  /** 分析编号，如 BA-001 */
  batchId: string
  center: LngLat
  centerName: string
  radiusM: number
  /** 缓冲面几何（2D/3D 渲染共用） */
  polygon: PolygonGeom
  /** 缓冲面积（km²，投影平面近似） */
  areaKm2: number
  hits: BufferHit[]
}

let batchCounter = 0

/**
 * 以某个站点为中心执行缓冲区分析。
 */
export function analyzeStationBuffer(station: { id: string; name: string; coordinates: LngLat }, radiusM: number): BufferAnalysisResult {
  batchCounter += 1
  const polygon = createGeodesicBuffer(station.coordinates, radiusM)

  const roadHits: BufferHit[] = allRouteFeatures().features.map((f: GeoJSONFeature<MetroRouteProps>) => {
    const g = f.geometry
    const path: LngLat[] = g.type === 'MultiLineString' ? (g.coordinates[0] ?? []) : (g.coordinates as LngLat[])
    const { distanceM } = pointToPathDistance(station.coordinates, path)
    return {
      kind: 'road',
      id: String(f.properties.id),
      name: f.properties.route_cn,
      typeText: '地铁线路',
      distanceM: distanceM,
      relation: distanceM <= 1 ? '包含' : distanceM < radiusM ? '相交' : '相邻',
      status: '正常',
      isSource: false,
    }
  })

  const stationHits: BufferHit[] = allStopFeatures().features.map((f: GeoJSONFeature<MetroStopProps>) => {
    const coords = f.geometry.coordinates as LngLat
    const distanceM = haversineDistance(station.coordinates, coords)
    return {
      kind: 'station',
      id: f.properties.stop_id,
      name: f.properties.stop_cn,
      typeText: '地铁站点',
      distanceM: Math.round(distanceM),
      relation: distanceM <= 1 ? '包含' : distanceM < radiusM ? '包含' : '相邻',
      status: '正常',
      isSource: f.properties.stop_id === station.id,
    }
  })

  const hits = [...stationHits, ...roadHits]
    .filter((h) => h.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)

  return {
    batchId: `BA-${String(batchCounter).padStart(3, '0')}`,
    center: station.coordinates,
    centerName: station.name,
    radiusM,
    polygon,
    // 投影平面面积（与原型口径一致）
    areaKm2: Number(((Math.PI * radiusM * radiusM) / 1_000_000).toFixed(3)),
    hits,
  }
}
