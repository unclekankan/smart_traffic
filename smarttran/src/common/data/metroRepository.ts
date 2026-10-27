/**
 * 地铁数据仓储层
 *
 * 唯一数据来源为 FastAPI 后端的地铁接口（见 services/metro.ts），
 * 首次调用 ensureMetroLoaded() 时拉取全量线路/站点并建立索引缓存，
 * 之后 2D / 3D 引擎与各面板均从本模块同步读取。
 */

import { metroApi, type RouteDetail } from '@/common/services/metro'
import type { GeoJSONFeature, GeoJSONFeatureCollection, LngLat } from '@/common/types/geo'
import type {
  MetroRouteProps,
  MetroRouteStopProps,
  MetroStopProps,
} from '@/common/types/metro'

type RouteFeature = GeoJSONFeature<MetroRouteProps>
type StopFeature = GeoJSONFeature<MetroStopProps>

let routeFeatures: RouteFeature[] = []
let stopFeatures: StopFeature[] = []
let routeIndexMap: Map<string, RouteFeature> | null = null
let stopIndexMap: Map<string, StopFeature> | null = null
/** 线路详情缓存（含有序站点） key = route id */
const routeDetailCache = new Map<string, RouteDetail>()
let loadPromise: Promise<void> | null = null

/** 从后端加载全部线路与站点（幂等，并发安全） */
export async function ensureMetroLoaded(): Promise<void> {
  if (routeFeatures.length && stopFeatures.length) return
  if (!loadPromise) {
    loadPromise = (async () => {
      const [routesFc, stopsFc] = await Promise.all([metroApi.listRoutes(), metroApi.listStops()])
      routeFeatures = routesFc.features
      stopFeatures = stopsFc.features
      routeIndexMap = null
      stopIndexMap = null
    })()
  }
  try {
    await loadPromise
  } finally {
    loadPromise = null
  }
}

/** 全部线路要素（GeoJSON FeatureCollection） */
export function allRouteFeatures(): GeoJSONFeatureCollection<MetroRouteProps> {
  return { type: 'FeatureCollection', features: routeFeatures }
}

/** 全部站点要素（GeoJSON FeatureCollection） */
export function allStopFeatures(): GeoJSONFeatureCollection<MetroStopProps> {
  return { type: 'FeatureCollection', features: stopFeatures }
}

function routeIndex(): Map<string, RouteFeature> {
  if (!routeIndexMap) {
    routeIndexMap = new Map(routeFeatures.map((f) => [String(f.properties.id), f]))
  }
  return routeIndexMap
}

function stopIndex(): Map<string, StopFeature> {
  if (!stopIndexMap) {
    stopIndexMap = new Map(stopFeatures.map((f) => [f.properties.stop_id, f]))
  }
  return stopIndexMap
}

/** 获取线路要素（按主键 id） */
export function getRouteFeature(id: number | string): RouteFeature | undefined {
  return routeIndex().get(String(id))
}

/** 获取站点要素（按 stop_id） */
export function getStopFeature(stopId: string): StopFeature | undefined {
  return stopIndex().get(stopId)
}

/** 线路属性 + 便捷的 name 别名（供选中态与面板展示） */
export function getRoute(
  id: number | string,
): (MetroRouteProps & { name: string }) | undefined {
  const feature = getRouteFeature(id)
  if (!feature) return undefined
  return { ...feature.properties, name: feature.properties.route_cn }
}

/** 站点属性 + 便捷的 name 别名 */
export function getStop(
  stopId: string,
): (MetroStopProps & { name: string }) | undefined {
  const feature = getStopFeature(stopId)
  if (!feature) return undefined
  return { ...feature.properties, name: feature.properties.stop_cn }
}

/** 线路几何坐标（MultiLineString 取首段，供定位与空间分析使用） */
export function getRoutePath(id: number | string): LngLat[] | undefined {
  const geometry = getRouteFeature(id)?.geometry
  if (!geometry) return undefined
  if (geometry.type === 'LineString') return geometry.coordinates
  if (geometry.type === 'MultiLineString') return geometry.coordinates[0] ?? []
  return undefined
}

/** 线路中点坐标（沿线几何的中点，用于「定位线路」） */
export function getRouteMidpoint(id: number | string): LngLat | undefined {
  const path = getRoutePath(id)
  if (!path?.length) return undefined
  return path[Math.floor(path.length / 2)]
}

/** 站点坐标 */
export function getStopPoint(stopId: string): LngLat | undefined {
  const geometry = getStopFeature(stopId)?.geometry
  return geometry?.type === 'Point' ? geometry.coordinates : undefined
}

/** 某线路方向上的有序站点（按需请求并缓存） */
export async function getStopsOfRoute(
  routeId: number | string,
): Promise<GeoJSONFeature<MetroRouteStopProps>[]> {
  const key = String(routeId)
  let detail = routeDetailCache.get(key)
  if (!detail) {
    detail = await metroApi.getRoute(key)
    routeDetailCache.set(key, detail)
  }
  return detail.stops.features
}

/** 场景要素统计（供图层面板展示真实数量） */
export function getSceneStats(): { routes: number; stops: number } {
  return { routes: routeFeatures.length, stops: stopFeatures.length }
}
