/**
 * 公交数据仓储层
 *
 * 对应后端 FastAPI 路由 app/routers/bus.py，
 * 缓存线路轻量列表 + 按需拉取单条线路详情（含沿线站点）。
 * 与 metroRepository 的差异：
 *  - 公交 3048 条，**不拉全量 geom**（太重），详情按需拉
 *  - 公交线路-站点无关联表，站点由 PostGIS 空间过滤 + frac 排序得到
 *
 * 关键：所有返回类型在 services/bus.ts 已冻结，本层只做缓存与索引。
 */

import { busApi } from '@/common/services/bus'
import type {
  BusRouteDetail,
  BusRouteFeature,
  BusRouteSummary,
  BusStopFeature,
} from '@/common/types/bus'

/** 轻量线路列表缓存 */
let routeSummaries: BusRouteSummary[] | null = null
let loadPromise: Promise<BusRouteSummary[]> | null = null

/** 按 id 的详情缓存（线路 GeoJSON + 沿线站点） */
const detailCache = new Map<number | string, BusRouteDetail>()
/** 正在拉取的 in-flight Promise（同一个 id 避免并发重复请求） */
const inflightDetail = new Map<number | string, Promise<BusRouteDetail>>()

/** 拉取全部线路轻量列表（幂等，并发安全，无几何） */
export async function ensureBusRoutesLoaded(): Promise<BusRouteSummary[]> {
  if (routeSummaries) return routeSummaries
  if (!loadPromise) {
    loadPromise = busApi.listRoutes().then((arr) => {
      routeSummaries = arr
      return arr
    })
  }
  try {
    return await loadPromise
  } finally {
    loadPromise = null
  }
}

/** 全部线路轻量列表（未加载则返回空数组） */
export function allRouteSummaries(): BusRouteSummary[] {
  return routeSummaries ?? []
}

/** 按 id 查找线路轻量摘要（同步，供面板展示用） */
export function getRouteSummary(id: number | string): BusRouteSummary | undefined {
  return routeSummaries?.find((r) => String(r.id) === String(id))
}

/** 单条线路详情（线路 GeoJSON + 沿线站点，按需拉取并缓存；同一 id in-flight 共享） */
export async function getRouteDetail(id: number | string): Promise<BusRouteDetail> {
  const key = String(id)
  const cached = detailCache.get(key)
  if (cached) return cached
  const inflight = inflightDetail.get(key)
  if (inflight) return inflight
  const promise = busApi.getRoute(id).then((detail) => {
    detailCache.set(key, detail)
    inflightDetail.delete(key)
    return detail
  })
  inflightDetail.set(key, promise)
  return promise
}

/** 详情中的线路 Feature */
export async function getRouteFeature(id: number | string): Promise<BusRouteFeature | null> {
  try {
    const detail = await getRouteDetail(id)
    return detail.route
  } catch {
    return null
  }
}

/** 详情中的沿线站点 Feature（按 frac 已排序） */
export async function getRouteStops(id: number | string): Promise<BusStopFeature[]> {
  try {
    const detail = await getRouteDetail(id)
    return detail.stops.features
  } catch {
    return []
  }
}
