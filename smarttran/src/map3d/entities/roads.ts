/**
 * 三维地铁线路实体
 *
 * 每条线路渲染为「深色衬底线 + 线路色主线」的双折线；
 * 选中态由引擎的独立高亮实体叠加（见 Map3DEngine.refreshHighlight）。
 */

import * as Cesium from 'cesium'

import type { GeoJSONFeature, LngLat } from '@/common/types/geo'
import type { MetroRouteProps } from '@/common/types/metro'
import { routeColor } from '@/map2d/layers/roads'

/** 业务实体 id 约定：`<kind>:<bizId>`，拾取时解析 */
export const ENTITY_ID_PREFIX = { road: 'road', station: 'station' } as const
export type EntityBizId = `${string}:${string}`

export function positionsFromPath(path: LngLat[], height = 0): Cesium.Cartesian3[] {
  return path.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, height))
}

/** 创建地铁线路双线实体，返回 [衬底, 主线] */
export function createRoadEntities(
  container: Cesium.EntityCollection,
  feature: GeoJSONFeature<MetroRouteProps>,
): Cesium.Entity[] {
  const bizId = feature.properties.id
  const g = feature.geometry
  // 多段线取首段用于展示（与 2D 保持一致）
  const path: LngLat[] = g.type === 'MultiLineString' ? (g.coordinates[0] ?? []) : (g.coordinates as LngLat[])
  const positions = positionsFromPath(path, 2)
  const color = Cesium.Color.fromCssColorString(routeColor(bizId))

  const casing = container.add({
    id: `road:${bizId}:casing`,
    polyline: {
      positions,
      width: 9,
      material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#0B1220').withAlpha(0.9)),
      clampToGround: true,
    },
  })
  const main = container.add({
    id: `road:${bizId}`,
    polyline: {
      positions,
      width: 5,
      material: new Cesium.ColorMaterialProperty(color),
      clampToGround: true,
    },
  })
  return [casing, main]
}

/** 清除道路实体 */
export function removeRoads(container: Cesium.EntityCollection): void {
  container.values
    .filter((e) => typeof e.id === 'string' && e.id.startsWith('road:'))
    .forEach((e) => container.remove(e))
}
