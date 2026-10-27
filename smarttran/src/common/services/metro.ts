/**
 * 成都地铁数据接口封装
 *
 * 对应后端 FastAPI 路由 app/routers/metro.py：
 *  GET /api/metro/routes         全部线路 GeoJSON
 *  GET /api/metro/routes/{id}    单条线路详情（含站点/区间段）
 *  GET /api/metro/stops          全部去重站点 GeoJSON
 *  GET /api/metro/stops/{stopId} 单站详情（含途经线路）
 */

import type { GeoJSONFeatureCollection } from '@/common/types/geo'
import type {
  MetroRouteProps,
  MetroRouteStopProps,
  MetroStopLine,
  MetroStopProps,
} from '@/common/types/metro'
import { request } from './http'

export interface RouteDetail {
  route: { type: 'Feature'; geometry: unknown; properties: MetroRouteProps }
  stops: GeoJSONFeatureCollection<MetroRouteStopProps>
  segments: GeoJSONFeatureCollection<Record<string, unknown>>
}

export interface StopDetail {
  stop: { type: 'Feature'; geometry: unknown; properties: MetroStopProps }
  /** 途经线路（已归一化，如「地铁1号线」） */
  lines: MetroStopLine[]
  /** 途经线路方向明细 */
  routes: Array<{
    id: number
    name_cn: string
    stop_id: string
    route_cn: string | null
    route_id: string | null
    sequence: number | null
  }>
}

export const metroApi = {
  /** 全部地铁线路（GeoJSON FeatureCollection） */
  listRoutes(): Promise<GeoJSONFeatureCollection<MetroRouteProps>> {
    return request('/api/metro/routes')
  },

  /** 单条线路详情（线路 + 有序站点 + 区间段） */
  getRoute(id: number | string): Promise<RouteDetail> {
    return request(`/api/metro/routes/${id}`)
  },

  /** 全部去重站点（GeoJSON FeatureCollection） */
  listStops(): Promise<GeoJSONFeatureCollection<MetroStopProps>> {
    return request('/api/metro/stops')
  },

  /** 单站详情 */
  getStop(stopId: string): Promise<StopDetail> {
    return request(`/api/metro/stops/${encodeURIComponent(stopId)}`)
  },
}
