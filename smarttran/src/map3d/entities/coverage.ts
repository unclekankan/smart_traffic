/**
 * 三维全网服务范围（覆盖分析）实体
 *
 * 仅在 3D 引擎内使用，与 2D 的 `map2d/layers/analysis` 完全独立：
 * - 覆盖色带：后端网格化后的连续覆盖区域，按覆盖层数 1 → 5+ 由浅到深
 * - 贴地渲染：PolygonEntity + 无描边填充（同层相邻色块连成一片）
 * - 交互支持：hover 高亮 + 数据悬浮提示（由 Map3DEngine 点选链路配合实现）
 *
 * 实体 id 统一 `coverage:` 前缀，清除时按前缀整体移除，
 * 不会误删业务站点 / 线路 / 缓冲区实体。
 */

import * as Cesium from 'cesium'

import { COVERAGE_RAMP } from '@/common/constants/colors'
import type { CoverageResult } from '@/common/types/analysis'
import type { GeoJSONGeometry, LngLat } from '@/common/types/geo'

export const COVERAGE_PREFIX = 'coverage:'

interface CoverageEntityMeta {
  entity: Cesium.Entity
  level: number
  properties: Record<string, unknown>
}

/** 覆盖层数 → COVERAGE_RAMP 索引（level 1→0, 2→1, ..., 5+→4） */
function rampIndex(level: number): number {
  return Math.min(4, Math.max(0, level - 1))
}

/** GeoJSON PolygonGeometry 兼容 */
function polygonRings(geometry: GeoJSONGeometry): LngLat[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  const maybeMulti = geometry as unknown as { type: string; coordinates?: LngLat[][][] }
  if (maybeMulti.type === 'MultiPolygon' && maybeMulti.coordinates) return maybeMulti.coordinates
  return []
}

/** GeoJSON 环 → Cesium Cartesian3[]（贴地，高度 0） */
function ringToPositions(ring: LngLat[]): Cesium.Cartesian3[] {
  return ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
}

/**
 * 创建三维覆盖分析实体组
 *
 * 后端 zones 是连续覆盖色带（每个要素覆盖层数 level），
 * 按 level 从低到高添加，高层在上层，相邻色块无缝相连。
 */
export function createCoverageEntities(
  container: Cesium.EntityCollection,
  result: CoverageResult,
  opacity: number,
): CoverageEntityMeta[] {
  const meta: CoverageEntityMeta[] = []
  if (!result?.zones?.features) return meta

  // 按覆盖层数从低到高排序 → 低层先画，高层叠在上面
  const sorted = [...result.zones.features].sort(
    (a, b) => Number(a.properties?.level ?? 1) - Number(b.properties?.level ?? 1),
  )

  sorted.forEach((feature, featureIndex) => {
    const level = Number(feature.properties?.level ?? 1)
    const ramp = COVERAGE_RAMP[rampIndex(level)]!
    const fillColor = Cesium.Color.fromCssColorString(ramp.fill).withAlpha(opacity)

    polygonRings(feature.geometry).forEach((rings, polygonIndex) => {
      const outer = rings[0]
      if (!outer || outer.length < 3) return

      // 外环 + 内环（孔洞）组成 PolygonHierarchy
      const outerPositions = ringToPositions(outer)
      const holes = rings.slice(1).map((inner) => new Cesium.PolygonHierarchy(ringToPositions(inner)))

      const entity = container.add({
        id: `${COVERAGE_PREFIX}zone:${level}:${featureIndex}:${polygonIndex}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(outerPositions, holes),
          material: new Cesium.ColorMaterialProperty(fillColor),
          outline: false,
        },
        // 把 properties（level、原始 feature 的属性）挂到 entity 上供 pickTooltip 使用
        properties: {
          ...feature.properties,
          level,
        },
      })

      meta.push({
        entity,
        level,
        properties: { ...feature.properties, level },
      })
    })
  })

  return meta
}

/** 清除全部三维覆盖分析实体（不影响业务实体） */
export function removeCoverageEntities(container: Cesium.EntityCollection): void {
  container.values
    .filter((entity) => typeof entity.id === 'string' && entity.id.startsWith(COVERAGE_PREFIX))
    .forEach((entity) => container.remove(entity))
}

/** 调整覆盖色带透明度（遍历已创建的 polygon 实体修改 material alpha） */
export function setCoverageEntitiesOpacity(
  container: Cesium.EntityCollection,
  opacity: number,
): void {
  const clamped = Math.min(1, Math.max(0.05, opacity))
  container.values
    .filter((entity) => typeof entity.id === 'string' && entity.id.startsWith(COVERAGE_PREFIX) && entity.polygon)
    .forEach((entity) => {
      const id = entity.id as string
      // 从 id 解析 level：coverage:zone:<level>:<idx>:<pidx>
      const parts = id.split(':')
      const level = Number(parts[2] ?? 1)
      const ramp = COVERAGE_RAMP[rampIndex(level)]!
      const newColor = Cesium.Color.fromCssColorString(ramp.fill).withAlpha(clamped)
      if (entity.polygon) {
        entity.polygon.material = new Cesium.ColorMaterialProperty(newColor)
      }
    })
}

/** 判断 entity 是否属于覆盖分析（Map3DEngine 点选链路需要） */
export function isCoverageEntity(entity: Cesium.Entity | null | undefined): boolean {
  return !!entity && typeof entity.id === 'string' && entity.id.startsWith(COVERAGE_PREFIX)
}

/** 覆盖实体 tooltip 文本（展示覆盖层数、半径、站点范围） */
export function coverageTooltipText(
  properties: Record<string, unknown>,
  result: CoverageResult,
): string {
  const level = Number(properties.level ?? 1)
  const radiusKm = (result.radiusM / 1000).toFixed(1)
  const kindLabel = result.kind === 'metro' ? '地铁' : result.kind === 'bus' ? '公交' : '全部'
  return `覆盖层数：${level}\n服务半径：${radiusKm} km\n站点范围：${kindLabel}`
}
