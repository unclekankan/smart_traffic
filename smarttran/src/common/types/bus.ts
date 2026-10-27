/**
 * 公交数据类型
 *
 * 对应后端 FastAPI 路由 app/routers/bus.py，两张表：
 * - chengdu_bus_routes        3048 条线路（MultiLineString 几何）
 * - chengdu_bus_stops_unique  13817 个去重物理站点（Point 几何）
 *
 * 公交数据**没有**线路-站点关联表，某条线路的站点通过 PostGIS
 * ST_DWithin(100m) + ST_LineLocatePoint 空间过滤得到，因此详情接口
 * 返回的站点属性里附带 distance_m / frac 以便前端按需二次过滤。
 */

import type { GeoJSONFeatureCollection, GeoJSONGeometry } from '@/common/types/geo'

/** 线路轻量列表项（无几何，GET /api/bus/routes 返回） */
export interface BusRouteSummary {
  id: number
  route_cn: string
  route_en: string | null
  s_stop_cn: string | null
  e_stop_cn: string | null
  total_stop: number | null
  distance: number | null
  length: number | null
  route_type: string | null
  type_en: string | null
  company_cn: string | null
  loop: string | null
  status: string | null
}

/** 线路 GeoJSON Feature 的 properties（含完整业务字段） */
export interface BusRouteProps extends BusRouteSummary {
  start_time: string | null
  end_time: string | null
  basic_prc: string | null
  total_prc: string | null
  city_cn: string | null
  city_en: string | null
  city_code: string | null
}

/** 线路 GeoJSON Feature（几何 + 业务属性） */
export interface BusRouteFeature {
  type: 'Feature'
  geometry: GeoJSONGeometry | null
  properties: BusRouteProps
}

/** 沿线站点 GeoJSON Feature 的 properties */
export interface BusStopProps {
  id: number
  stop_cn: string | null
  stop_en: string | null
  stop_id: string | null
  num: number | null
  city_cn: string | null
  city_en: string | null
  /** 到线路的最短距离（米，POSTGIS ST_Distance 计算值） */
  distance_m: number | null
  /** 沿线位置（0–1，ST_LineLocatePoint 计算值） */
  frac: number | null
}

/** 沿线站点 GeoJSON Feature */
export interface BusStopFeature {
  type: 'Feature'
  geometry: GeoJSONGeometry | null
  properties: BusStopProps
}

/** 单条线路详情返回体 */
export interface BusRouteDetail {
  route: BusRouteFeature
  stops: GeoJSONFeatureCollection<BusStopProps>
  /** 接口侧沿线过滤用的距离阈值（米） */
  stop_distance_m: number
}

/** 地图点击拾取结果（GET /api/bus/pick，无命中时为 null） */
export interface BusPickResult {
  id: number
  route_cn: string
  /** 点击点到线路的最短距离（米） */
  distance_m: number
}
