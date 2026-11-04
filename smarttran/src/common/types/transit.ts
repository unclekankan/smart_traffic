/**
 * 公共交通路线规划类型
 *
 * 后端 /api/transit/plan 已输出结构化结果（WGS84 坐标），
 * 前端直接消费用于地图渲染与方案列表展示。
 */

import type { LngLat } from './geo'

export type TransitSegmentType = 'walk' | 'bus' | 'metro'

/** 方案内的站点 / 换乘点 */
export interface TransitStop {
  id: string
  name: string
  lng: number
  lat: number
  /** 是否匹配到本地交通库（当前未启用本地匹配时恒为 false） */
  matched: boolean
  localId: number | null
  /** 途经站序号（仅公交 / 地铁段） */
  seq?: number
}

/** 换乘信息：当前段终点到下一段起点的步行 */
export interface TransitTransfer {
  toNextType: TransitSegmentType
  walkingDurationSec: number
  walkingDistanceM: number
}

/** 单个出行分段 */
export interface TransitSegment {
  type: TransitSegmentType
  lineId: string | null
  lineName: string | null
  direction: string
  matched: boolean
  localLineId: number | null
  departureStop: TransitStop
  arrivalStop: TransitStop
  stops: TransitStop[]
  /** WGS84 坐标数组 [[lon, lat], ...] */
  polyline: LngLat[]
  durationSec: number
  distanceM: number
  cost: number | null
  transfer: TransitTransfer | null
}

/** 单个规划方案 */
export interface TransitAlternative {
  id: string
  totalDurationSec: number
  totalDistanceM: number
  totalCost: number | null
  transfers: number
  walkingDistanceM: number
  tags: string[]
  segments: TransitSegment[]
}

/** 路线规划结果 */
export interface TransitPlanResult {
  origin: LngLat
  destination: LngLat
  city: string
  strategy: number
  alternatives: TransitAlternative[]
}

/** 出行策略枚举（与后端 / 高德 strategy 一致） */
export const TRANSIT_STRATEGIES: { value: number; label: string }[] = [
  { value: 0, label: '推荐路线' },
  { value: 1, label: '少换乘' },
  { value: 2, label: '少步行' },
  { value: 3, label: '不坐地铁' },
  { value: 4, label: '时间优先' },
  { value: 5, label: '地铁优先' },
  { value: 6, label: '公交优先' },
]
