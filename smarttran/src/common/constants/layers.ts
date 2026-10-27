/**
 * 图层注册表
 *
 * 2D（OpenLayers）与 3D（Cesium）引擎共用同一套图层标识，
 * 图层管理面板通过此注册表控制任意模式下对应图层的可见性。
 * UI 文案与统计数量也集中在此维护，避免散落在组件里。
 *
 * 说明：
 * - 站点符号（stations）与站点名称注记（stationLabels）拆分为两个图层，
 *   便于在大范围浏览时只保留符号、按需隐藏站名。
 * - 公交网络（busRoutes / busStops / busStopNames）数据来自 GeoServer WMS，
 *   仅在「公交」网络模式下可见。
 */

import type { NetworkMode } from '../types/network'

export const LAYER_IDS = [
  'roads',
  'stations',
  'stationLabels',
  'models3d',
  'busRoutes',
  'busStops',
  'busStopNames',
] as const

export type LayerId = (typeof LAYER_IDS)[number]

export interface LayerMeta {
  id: LayerId
  /** 面板展示名 */
  label: string
  /** 数据量描述 */
  summary: string
  /** 面板中的补充说明 */
  hint?: string
  /** 3D 场景中该图层是否仍有意义（如三维模型在 2D 下隐藏） */
  modes: Array<'2d' | '3d'>
}

/** 地铁网络图层 */
export const LAYER_REGISTRY: readonly LayerMeta[] = [
  { id: 'roads', label: '地铁线路', summary: '0 条线路', modes: ['2d', '3d'] },
  { id: 'stations', label: '站点符号', summary: '0 座车站', modes: ['2d', '3d'] },
  {
    id: 'stationLabels',
    label: '站点名称',
    summary: '0 个注记',
    hint: '取消勾选可隐藏站名注记',
    modes: ['2d', '3d'],
  },
  { id: 'models3d', label: '三维车站模型', summary: '换乘站体块', modes: ['3d'] },
]

/** 公交网络图层（GeoServer WMS） */
export const BUS_LAYER_REGISTRY: readonly LayerMeta[] = [
  {
    id: 'busRoutes',
    label: '公交线路',
    summary: 'WMS 服务',
    hint: 'smart_triffic:chengdu_bus_routes',
    modes: ['2d'],
  },
  {
    id: 'busStops',
    label: '公交站点',
    summary: 'WMS 服务',
    hint: 'smart_triffic:chengdu_bus_stops_unique',
    modes: ['2d'],
  },
  {
    id: 'busStopNames',
    label: '公交站点名称',
    summary: 'WMS 服务',
    hint: 'smart_triffic:chengdu_bus_stops_unique_name',
    modes: ['2d'],
  },
]

/** 按当前交通网络返回对应图层注册表 */
export function layerRegistryFor(mode: NetworkMode): readonly LayerMeta[] {
  return mode === 'bus' ? BUS_LAYER_REGISTRY : LAYER_REGISTRY
}

/** 图层初始可见性（全部开启） */
export const DEFAULT_LAYER_VISIBILITY: Record<LayerId, boolean> = {
  roads: true,
  stations: true,
  stationLabels: true,
  models3d: true,
  busRoutes: true,
  busStops: true,
  busStopNames: true,
}
