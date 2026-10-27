/**
 * 三维分析覆盖物
 *
 * 缓冲区渲染为贴地半透明圆 + 中心点标记（青色，对应原型「分析范围」语义）。
 */

import * as Cesium from 'cesium'

import { PALETTE } from '@/common/constants/colors'
import type { BufferOverlay } from '@/common/types/engine'

const ACCENT = Cesium.Color.fromCssColorString(PALETTE.accent)

/** 渲染 / 清除缓冲区（overlay 为 null 时清除） */
export function renderBufferEntity(
  container: Cesium.EntityCollection,
  overlay: BufferOverlay | null,
): void {
  container.values
    .filter((e) => typeof e.id === 'string' && e.id.startsWith('buffer:'))
    .forEach((e) => container.remove(e))

  if (!overlay) return
  const [lon, lat] = overlay.center
  container.add({
    id: 'buffer:area',
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    ellipse: {
      semiMajorAxis: overlay.radiusM,
      semiMinorAxis: overlay.radiusM,
      material: new Cesium.ColorMaterialProperty(ACCENT.withAlpha(0.12)),
      outline: true,
      outlineColor: ACCENT.withAlpha(0.75),
      height: 1,
    },
  })
  container.add({
    id: 'buffer:center',
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 4),
    point: {
      pixelSize: 7,
      color: ACCENT.withAlpha(0.95),
      outlineColor: Cesium.Color.fromCssColorString(PALETTE.bgDeep),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })
}
