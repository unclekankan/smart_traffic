/**
 * 三维地铁线路实体
 *
 * 保留贴地业务线，并叠加轻微离地的窄圆管增强立体感；颜色取自与 2D 共用的 routeColor。
 */

import * as Cesium from 'cesium'

import type { GeoJSONFeature, LngLat } from '@/common/types/geo'
import type { BusRouteFeature, BusStopProps } from '@/common/types/bus'
import type { GeoJSONFeatureCollection } from '@/common/types/geo'
import type { MetroRouteProps } from '@/common/types/metro'
import { routeColor } from '@/map2d/layers/roads'

/** 业务实体 id 约定：`<kind>:<bizId>`，拾取时解析 */
export const ENTITY_ID_PREFIX = { road: 'road', station: 'station' } as const
export type EntityBizId = `${string}:${string}`

export function positionsFromPath(path: LngLat[], height = 0): Cesium.Cartesian3[] {
  return path.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, height))
}

/** 创建地铁线路实体：每条路径保留贴地线并可叠加圆管视觉层 */
export interface RoadRenderOptions {
  /** 贴地线路宽度（像素） */
  width: number
  /** 立体线路圆管半径（米） */
  volumeRadius: number
  /** 立体线路离地高度（米） */
  volumeHeight: number
}

export const DEFAULT_ROAD_RENDER_OPTIONS: RoadRenderOptions = {
  width: 4,
  volumeRadius: 15,
  volumeHeight: 4,
}

export function createRoadEntities(
  container: Cesium.EntityCollection,
  feature: GeoJSONFeature<MetroRouteProps>,
  options: Partial<RoadRenderOptions> = {},
): Cesium.Entity {
  const config = { ...DEFAULT_ROAD_RENDER_OPTIONS, ...options }
  const bizId = feature.properties.id
  const geometry = feature.geometry
  const paths: LngLat[][] = geometry.type === 'MultiLineString'
    ? geometry.coordinates
    : geometry.type === 'LineString'
      ? [geometry.coordinates]
      : []
  const color = Cesium.Color.fromCssColorString(routeColor(bizId))
  let primary: Cesium.Entity | null = null
  paths.forEach((path, index) => {
    if (path.length < 2) return
    const routeId = index === 0 ? `road:${bizId}` : `road:${bizId}:segment:${index}`
    const entity = container.add({
      id: routeId,
      polyline: {
        positions: positionsFromPath(path),
        width: config.width,
        clampToGround: true,
        material: new Cesium.ColorMaterialProperty(color),
      },
    })
    if (config.volumeRadius > 0) {
      const heightPositions = positionsFromPath(path, config.volumeHeight)
      container.add({
        id: `road-volume:${bizId}:${index}`,
        polylineVolume: {
          positions: heightPositions,
          shape: Array.from({ length: 16 }, (_, pointIndex) => {
            const angle = (pointIndex / 16) * Cesium.Math.TWO_PI
            return new Cesium.Cartesian2(
              config.volumeRadius * Math.cos(angle),
              config.volumeRadius * Math.sin(angle),
            )
          }),
          material: new Cesium.ColorMaterialProperty(color.withAlpha(0.2)),
          outline: false,
        },
      })
    }
    primary ??= entity
  })

  if (!primary) {
    primary = container.add({
      id: `road:${bizId}`,
      polyline: {
        positions: [],
        width: config.width,
        clampToGround: true,
        material: new Cesium.ColorMaterialProperty(color),
        show: false,
      },
    })
  }
  return primary
}

export interface BusRouteRenderOptions {
  radius: number
  height: number
  color: string
}

const DEFAULT_BUS_ROUTE_RENDER_OPTIONS: BusRouteRenderOptions = {
  radius: 12,
  height: 10,
  color: '#F3A64A',
}

/** 选中公交线路的站点点标记 / 名称标注样式 */
const BUS_STOP_MARKER = {
  pixelSize: 9,
  color: '#35C8E8',
  outlineColor: '#FFFFFF',
  outlineWidth: 2,
} as const

const BUS_STOP_LABEL = {
  font: '12px "Microsoft YaHei", sans-serif',
  fillColor: '#FFFFFF',
  outlineColor: '#0B1626',
  outlineWidth: 3,
  pixelOffsetY: -16,
} as const

/** Create one selected bus route as independent 3D tube entities. */
export function createBusRouteEntities(
  container: Cesium.EntityCollection,
  feature: BusRouteFeature,
  options: Partial<BusRouteRenderOptions> = {},
): Cesium.Entity[] {
  const config = { ...DEFAULT_BUS_ROUTE_RENDER_OPTIONS, ...options }
  const geometry = feature.geometry
  if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString')) return []

  const paths = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates]
  const color = Cesium.Color.fromCssColorString(config.color)
  const entities: Cesium.Entity[] = []
  paths.forEach((path, index) => {
    if (path.length < 2) return
    entities.push(container.add({
      id: `bus-route:${feature.properties.id}:${index}`,
      polylineVolume: {
        positions: positionsFromPath(path, config.height),
        shape: Array.from({ length: 16 }, (_, pointIndex) => {
          const angle = (pointIndex / 16) * Cesium.Math.TWO_PI
          return new Cesium.Cartesian2(config.radius * Math.cos(angle), config.radius * Math.sin(angle))
        }),
        material: new Cesium.ColorMaterialProperty(color),
        outline: false,
      },
    }))
  })
  return entities
}

/** Create stop markers + name labels for the selected bus route. */
export function createBusStopEntities(
  container: Cesium.EntityCollection,
  stops: GeoJSONFeatureCollection<BusStopProps>,
  height = 10,
): { markers: Cesium.Entity[]; labels: Cesium.Entity[] } {
  const markers: Cesium.Entity[] = []
  const labels: Cesium.Entity[] = []
  stops.features.forEach((stop, index) => {
    if (stop.geometry.type !== 'Point') return
    const [lon, lat] = stop.geometry.coordinates
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
    const bizId = stop.properties.stop_id ?? stop.properties.id ?? index
    const name = stop.properties.stop_cn ?? stop.properties.stop_en ?? ''
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, height)
    markers.push(container.add({
      id: `bus-stop:${bizId}`,
      position,
      point: {
        pixelSize: BUS_STOP_MARKER.pixelSize,
        color: Cesium.Color.fromCssColorString(BUS_STOP_MARKER.color),
        outlineColor: Cesium.Color.fromCssColorString(BUS_STOP_MARKER.outlineColor),
        outlineWidth: BUS_STOP_MARKER.outlineWidth,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }))
    if (name) {
      labels.push(container.add({
        id: `bus-stop-label:${bizId}`,
        position,
        label: {
          text: name,
          font: BUS_STOP_LABEL.font,
          fillColor: Cesium.Color.fromCssColorString(BUS_STOP_LABEL.fillColor),
          outlineColor: Cesium.Color.fromCssColorString(BUS_STOP_LABEL.outlineColor),
          outlineWidth: BUS_STOP_LABEL.outlineWidth,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, BUS_STOP_LABEL.pixelOffsetY),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }))
    }
  })
  return { markers, labels }
}

/** Remove the whole selected bus-route overlay (tube + stop markers + labels). */
export function removeBusRouteEntities(container: Cesium.EntityCollection): void {
  container.values
    .filter((entity) => typeof entity.id === 'string'
      && (entity.id.startsWith('bus-route:')
        || entity.id.startsWith('bus-stop:')
        || entity.id.startsWith('bus-stop-label:')))
    .forEach((entity) => container.remove(entity))
}

/** 清除道路实体 */
export function removeRoads(container: Cesium.EntityCollection): void {
  container.values
    .filter((e) => typeof e.id === 'string' && (e.id.startsWith('road:') || e.id.startsWith('road-volume:')))
    .forEach((e) => container.remove(e))
}
