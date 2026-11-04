/**
 * 空间分析接口封装
 *
 * 对应后端 FastAPI 路由 app/routers/analysis.py：
 *  GET /api/analysis/nearby-stops     附近站点查询（地铁站 + 公交站，按距离排序）
 *  GET /api/analysis/station-buffers  站点缓冲区覆盖分析（面积 / 重叠统计）
 *
 * 后端返回 snake_case 字段，这里统一转换为前端 camelCase 结构。
 */

import { request } from './http'
import type { GeoJSONFeatureCollection, LngLat } from '@/common/types/geo'
import type {
  StationBufferFeatureCollection,
  CoverageKind,
  CoverageResult,
  NearbyStop,
  NearbyStopsResult,
  StationKind,
  StationBufferResult,
} from '@/common/types/analysis'

interface RawNearbyStop {
  kind: StationKind
  id: string
  name: string
  lon: number
  lat: number
  distance_m: number
}

interface RawNearbyResult {
  center: LngLat
  radius_m: number
  total: number
  metro_count: number
  bus_count: number
  truncated: boolean
  stops: RawNearbyStop[]
}

interface RawStationBufferResult {
  station: { kind: StationKind; id: string; name: string }
  radius_m: number
  buffer: GeoJSONFeatureCollection
  metro_stops: StationBufferFeatureCollection
  bus_stops: StationBufferFeatureCollection
  metro_lines: StationBufferFeatureCollection
  bus_lines: StationBufferFeatureCollection
  counts: { metro_stops: number; bus_stops: number; metro_lines: number; bus_lines: number }
}

interface RawCoverageResult {
  radius_m: number
  kind: CoverageKind
  station_count: number
  covered_area_km2: number
  buffer_area_km2: number
  overlap_area_km2: number
  overlap_station_count: number
  zones: GeoJSONFeatureCollection
  cell_count: number
}

export const analysisApi = {
  /** 附近站点查询：以 (lon, lat) 为圆心检索半径内的地铁站与公交站 */
  async nearbyStops(lon: number, lat: number, radiusM: number): Promise<NearbyStopsResult> {
    const body = await request<RawNearbyResult>(
      `/api/analysis/nearby-stops?lon=${lon}&lat=${lat}&radius=${radiusM}`,
    )
    const stops: NearbyStop[] = body.stops.map((s) => ({
      kind: s.kind,
      id: s.id,
      name: s.name,
      lon: s.lon,
      lat: s.lat,
      distanceM: s.distance_m,
    }))
    return {
      center: body.center,
      radiusM: body.radius_m,
      stops,
      truncated: body.truncated,
    }
  },

  async stationBuffer(kind: StationKind, id: string, radiusM: number): Promise<StationBufferResult> {
    const body = await request<RawStationBufferResult>(
      `/api/analysis/station-buffer?kind=${kind}&id=${encodeURIComponent(id)}&radius=${radiusM}`,
    )
    return {
      station: body.station,
      radiusM: body.radius_m,
      buffer: body.buffer,
      metroStops: body.metro_stops,
      busStops: body.bus_stops,
      metroLines: body.metro_lines,
      busLines: body.bus_lines,
      counts: {
        metroStops: body.counts.metro_stops,
        busStops: body.counts.bus_stops,
        metroLines: body.counts.metro_lines,
        busLines: body.counts.bus_lines,
      },
    }
  },

  /** 站点缓冲区覆盖分析（服务半径 + 站点范围） */
  async stationBuffers(radiusM: number, kind: CoverageKind): Promise<CoverageResult> {
    const body = await request<RawCoverageResult>(
      `/api/analysis/station-buffers?radius=${radiusM}&kind=${kind}`,
    )
    return {
      radiusM: body.radius_m,
      kind: body.kind,
      zones: body.zones,
      cellCount: body.cell_count,
      stats: {
        stationCount: body.station_count,
        coveredAreaKm2: body.covered_area_km2,
        bufferAreaKm2: body.buffer_area_km2,
        overlapAreaKm2: body.overlap_area_km2,
        overlapStationCount: body.overlap_station_count,
      },
    }
  },
}
