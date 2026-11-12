/**
 * 三维空间分析实体
 *
 * 附近站点查询结果覆盖物：
 * - 搜索范围：测地缓冲圆（与 2D 同源的 createGeodesicBuffer 几何），
 *   半透明填充 + 虚线贴地边界，对应 2D 的虚线范围圈样式
 * - 查询中心点 / 站点标记：配色与 2D nearby 图层一致
 *
 * 实体 id 统一 `nearby:` 前缀，清理时按前缀整体移除。
 */

import * as Cesium from 'cesium'

import { PALETTE } from '@/common/constants/colors'
import type { NearbyStopsResult } from '@/common/types/analysis'
import { createGeodesicBuffer } from '@/tools'

const RADIUS_FILL = Cesium.Color.fromCssColorString('#0D253A').withAlpha(0.28)
const RADIUS_OUTLINE = Cesium.Color.fromCssColorString(PALETTE.accent)
const CENTER_COLOR = Cesium.Color.fromCssColorString(PALETTE.accentLight)
const CENTER_OUTLINE = Cesium.Color.fromCssColorString(PALETTE.bgDeep)
const STOP_COLOR = Cesium.Color.fromCssColorString('#FFE34D')
const STOP_OUTLINE = Cesium.Color.fromCssColorString('#172033')

/** 创建附近站点查询实体组（范围圈 + 中心点 + 站点标记），返回新增实体 */
export function createNearbyEntities(
  container: Cesium.EntityCollection,
  result: NearbyStopsResult,
): Cesium.Entity[] {
  const created: Cesium.Entity[] = []
  const [lon, lat] = result.center
  const ring = createGeodesicBuffer(result.center, result.radiusM).coordinates[0]!
  const ringPositions = ring.map(([x, y]) => Cesium.Cartesian3.fromDegrees(x, y))

  // 搜索范围：半透明填充 + 虚线边界（对应 2D 的虚线圆）
  created.push(
    container.add({
      id: 'nearby:radius-fill',
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ringPositions),
        material: new Cesium.ColorMaterialProperty(RADIUS_FILL),
      },
    }),
  )
  created.push(
    container.add({
      id: 'nearby:radius-outline',
      polyline: {
        positions: ringPositions,
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({ color: RADIUS_OUTLINE }),
        clampToGround: true,
      },
    }),
  )

  // 查询中心点
  created.push(
    container.add({
      id: 'nearby:center',
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 1),
      point: {
        pixelSize: 8,
        color: CENTER_COLOR,
        outlineColor: CENTER_OUTLINE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }),
  )

  // 站点标记（地铁 / 公交同色，与 2D 附近图层一致；顺序保持后端的距离升序）
  for (const stop of result.stops) {
    created.push(
      container.add({
        id: `nearby:stop:${stop.kind}:${stop.id}`,
        position: Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat, 1),
        point: {
          pixelSize: 12,
          color: STOP_COLOR,
          outlineColor: STOP_OUTLINE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    )
  }
  return created
}

/** 清除附近站点查询实体（不影响其它业务实体） */
export function removeNearbyEntities(container: Cesium.EntityCollection): void {
  container.values
    .filter((e) => typeof e.id === 'string' && e.id.startsWith('nearby:'))
    .forEach((e) => container.remove(e))
}
