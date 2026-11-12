/**
 * 三维单站缓冲区分析实体
 *
 * 仅在 3D 引擎内使用，与 2D 的 `map2d/layers/analysis` 完全独立：
 * - 缓冲面：后端 PostGIS 返回的缓冲区多边形（贴地半透明填充 + 虚线边界）
 * - 范围内站点：地铁 / 公交不同配色的点符号（与 2D 缓冲图层同源配色）
 * - 范围内线路：贴地折线
 *
 * 实体 id 统一 `station-buffer:` 前缀，清除时按前缀整体移除，
 * 不会误删业务站点 / 线路实体。
 */

import * as Cesium from 'cesium'

import { PALETTE } from '@/common/constants/colors'
import type { StationBufferFeature, StationBufferResult } from '@/common/types/analysis'
import type { GeoJSONGeometry, LngLat } from '@/common/types/geo'

export const STATION_BUFFER_PREFIX = 'station-buffer:'

const BUFFER_FILL = Cesium.Color.fromCssColorString('#0D253A').withAlpha(0.28)
const BUFFER_OUTLINE = Cesium.Color.fromCssColorString(PALETTE.accent)
const METRO_STOP_COLOR = Cesium.Color.fromCssColorString('#FFE34D')
const BUS_STOP_COLOR = Cesium.Color.fromCssColorString('#3DDC97')
const STOP_OUTLINE = Cesium.Color.fromCssColorString('#172033')
const LINE_COLOR = Cesium.Color.fromCssColorString('#E53935')

/** GeoJSON 环 → Cesium 世界坐标（高度 0，贴地渲染） */
function toPositions(ring: LngLat[]): Cesium.Cartesian3[] {
  return ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
}

/** 兼容 Polygon / MultiPolygon（后端缓冲区通常为 Polygon） */
function polygonsOf(geometry: GeoJSONGeometry): LngLat[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  // GeoJSONGeometry 未声明 MultiPolygon，这里做结构兼容，避免类型收窄报错
  const maybeMulti = geometry as unknown as { type: string; coordinates?: LngLat[][][] }
  if (maybeMulti.type === 'MultiPolygon' && maybeMulti.coordinates) return maybeMulti.coordinates
  return []
}

/** 兼容 LineString / MultiLineString */
function linesOf(geometry: GeoJSONGeometry): LngLat[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return []
}

/** 缓冲区面：半透明填充 + 虚线边界（对应 2D 的范围圈样式） */
function addBufferArea(
  container: Cesium.EntityCollection,
  feature: { geometry: GeoJSONGeometry },
  index: number,
): Cesium.Entity[] {
  const created: Cesium.Entity[] = []
  polygonsOf(feature.geometry).forEach((rings, polygonIndex) => {
    const outer = rings[0]
    if (!outer || outer.length < 3) return
    const positions = toPositions(outer)
    created.push(
      container.add({
        id: `${STATION_BUFFER_PREFIX}area:${index}:${polygonIndex}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: new Cesium.ColorMaterialProperty(BUFFER_FILL),
        },
      }),
    )
    created.push(
      container.add({
        id: `${STATION_BUFFER_PREFIX}outline:${index}:${polygonIndex}`,
        polyline: {
          positions,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({ color: BUFFER_OUTLINE }),
          clampToGround: true,
        },
      }),
    )
  })
  return created
}

/** 范围内站点：地铁黄色、公交绿色（与 2D 缓冲图层配色一致） */
function addStopMarkers(
  container: Cesium.EntityCollection,
  features: StationBufferFeature[],
  kind: 'metro' | 'bus',
): Cesium.Entity[] {
  const created: Cesium.Entity[] = []
  features.forEach((feature, index) => {
    if (feature.geometry.type !== 'Point') return
    const [lon, lat] = feature.geometry.coordinates
    created.push(
      container.add({
        id: `${STATION_BUFFER_PREFIX}stop:${kind}:${String(feature.properties.id)}:${index}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 1),
        point: {
          pixelSize: kind === 'metro' ? 12 : 10,
          color: kind === 'metro' ? METRO_STOP_COLOR : BUS_STOP_COLOR,
          outlineColor: STOP_OUTLINE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    )
  })
  return created
}

/** 范围内线路：贴地折线（与 2D 缓冲图层同为红色描线） */
function addLineFeatures(
  container: Cesium.EntityCollection,
  features: StationBufferFeature[],
  kind: 'metro' | 'bus',
): Cesium.Entity[] {
  const created: Cesium.Entity[] = []
  features.forEach((feature, index) => {
    linesOf(feature.geometry).forEach((path, pathIndex) => {
      if (path.length < 2) return
      created.push(
        container.add({
          id: `${STATION_BUFFER_PREFIX}line:${kind}:${String(feature.properties.id)}:${index}:${pathIndex}`,
          polyline: {
            positions: toPositions(path),
            width: 2.5,
            material: new Cesium.ColorMaterialProperty(LINE_COLOR),
            clampToGround: true,
          },
        }),
      )
    })
  })
  return created
}

/** 创建三维缓冲区分析实体组（缓冲面 + 范围内站点 / 线路），返回新增实体 */
export function createStationBufferEntities(
  container: Cesium.EntityCollection,
  result: StationBufferResult,
): Cesium.Entity[] {
  const created: Cesium.Entity[] = []
  result.buffer.features.forEach((feature, index) => {
    created.push(...addBufferArea(container, feature, index))
  })
  created.push(...addStopMarkers(container, result.metroStops.features, 'metro'))
  created.push(...addStopMarkers(container, result.busStops.features, 'bus'))
  created.push(...addLineFeatures(container, result.metroLines.features, 'metro'))
  created.push(...addLineFeatures(container, result.busLines.features, 'bus'))
  return created
}

/** 清除全部三维缓冲区分析实体（不影响业务实体） */
export function removeStationBufferEntities(container: Cesium.EntityCollection): void {
  container.values
    .filter((entity) => typeof entity.id === 'string' && entity.id.startsWith(STATION_BUFFER_PREFIX))
    .forEach((entity) => container.remove(entity))
}
