/**
 * 空间分析类型
 *
 * 所有空间计算（距离 / 缓冲区 / 并集 / 重叠）均由后端 PostGIS 完成，
 * 前端只消费结果做渲染与展示。
 */

import type { GeoJSONFeatureCollection, LngLat } from './geo'

/** 站点网络类型 */
export type StationKind = 'metro' | 'bus'

/** 覆盖分析的站点范围 */
export type CoverageKind = StationKind | 'all'

/** 附近站点查询结果中的单个站点（已按距离升序） */
export interface NearbyStop {
  kind: StationKind
  id: string
  name: string
  lon: number
  lat: number
  /** 到查询中心的距离（米） */
  distanceM: number
}

/** 附近站点查询结果 */
export interface NearbyStopsResult {
  center: LngLat
  radiusM: number
  stops: NearbyStop[]
  /** 结果被截断（超出后端单次返回上限） */
  truncated: boolean
}

/** 缓冲区覆盖统计 */
export interface CoverageStats {
  /** 参与分析的站点数 */
  stationCount: number
  /** 覆盖并集面积（km²） */
  coveredAreaKm2: number
  /** 逐站缓冲区面积之和（km²） */
  bufferAreaKm2: number
  /** 重叠面积（km²）= 缓冲总面积 - 并集面积 */
  overlapAreaKm2: number
  /** 与其它站点缓冲区重叠的站点数 */
  overlapStationCount: number
}

/** 缓冲区覆盖分析结果 */
export interface StationBufferFeature {
  type: 'Feature'
  geometry: import('./geo').GeoJSONGeometry
  properties: { id: string | number; name: string }
}

export interface StationBufferFeatureCollection {
  type: 'FeatureCollection'
  features: StationBufferFeature[]
}

export interface StationBufferResult {
  station: { kind: StationKind; id: string; name: string }
  radiusM: number
  buffer: GeoJSONFeatureCollection
  metroStops: StationBufferFeatureCollection
  busStops: StationBufferFeatureCollection
  metroLines: StationBufferFeatureCollection
  busLines: StationBufferFeatureCollection
  counts: { metroStops: number; busStops: number; metroLines: number; busLines: number }
}

export interface CoverageResult {
  radiusM: number
  kind: CoverageKind
  stats: CoverageStats
  /**
   * 连续覆盖色带：后端按网格覆盖层数（1-5+）合并后的区域，
   * 每个要素的 properties.level 即覆盖层数（越大越密集）
   */
  zones: GeoJSONFeatureCollection
  /** 参与统计的网格数量 */
  cellCount: number
}
