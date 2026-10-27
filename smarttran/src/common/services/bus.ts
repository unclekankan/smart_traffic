/**
 * 成都公交数据接口封装
 *
 * 对应后端 FastAPI 路由 app/routers/bus.py：
 *  GET /api/bus/routes        全部线路轻量列表（无几何，支持 q 关键字搜索）
 *  GET /api/bus/routes/{id}  单条线路详情（线路 GeoJSON + 沿线有序站点 GeoJSON）
 *
 * 公交数据**没有**线路-站点关联表，某条线路的站点通过 PostGIS
 * ST_DWithin(100m) + ST_LineLocatePoint 空间过滤得到，详情接口里
 * stops.properties.distance_m / frac 供前端按需过滤/排序。
 */

import { request } from './http'
import type {
  BusPickResult,
  BusRouteDetail,
  BusRouteFeature,
  BusRouteSummary,
} from '@/common/types/bus'

export const busApi = {
  /** 全部公交线路轻量列表（无 geom，约 400 KB） */
  listRoutes(q?: string): Promise<BusRouteSummary[]> {
    const url = q ? `/api/bus/routes?q=${encodeURIComponent(q)}` : '/api/bus/routes'
    return request<BusRouteSummary[]>(url)
  },

  /** 单条线路详情：线路 GeoJSON + 沿线站点 GeoJSON FeatureCollection */
  async getRoute(id: number | string): Promise<BusRouteDetail> {
    const body = await request<BusRouteDetail>(`/api/bus/routes/${id}`)
    // 确保 route.geometry 是 GeoJSON 对象（后端直接用 ST_AsGeoJSON 拼）
    return body
  },

  /**
   * 按经纬度拾取最近的公交线路（地图点击选线用）
   *
   * WMS 瓦片无法在前端命中要素，改由后端 PostGIS 做容差空间反查。
   * 无命中时返回 null。
   */
  pickRoute(lon: number, lat: number, toleranceM = 60): Promise<BusPickResult | null> {
    return request<BusPickResult | null>(
      `/api/bus/pick?lon=${lon}&lat=${lat}&tolerance=${toleranceM}`,
    )
  },
}

/** 线路 Feature 的便捷 name 别名（两种对象都含 route_cn，统一处理） */
export function routeName(route: BusRouteFeature | BusRouteSummary): string {
  // BusRouteFeature.route_cn 不存在（它在 properties 里），
  // BusRouteSummary 顶层就有 route_cn。用类型守卫区分。
  if ('properties' in route && 'geometry' in route) {
    return (route as BusRouteFeature).properties.route_cn ?? ''
  }
  return (route as BusRouteSummary).route_cn ?? ''
}
