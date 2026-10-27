/**
 * 空间分析图层
 *
 * 承载缓冲区多边形（青色虚线 + 半透明填充，对应原型「分析范围」语义）。
 * 命中要素的高亮由各业务图层通过 styleState.analysisHitIds 自行叠加。
 */

import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'

import { PALETTE } from '@/common/constants/colors'
import type { BufferOverlay } from '@/common/types/engine'
import { createGeodesicBuffer } from '@/tools'
import { withAlpha } from '../styles/shared'

const BUFFER_STYLE = new Style({
  fill: new Fill({ color: withAlpha(PALETTE.accent, 0.1) }),
  stroke: new Stroke({ color: PALETTE.accent, width: 1.8, lineDash: [7, 6] }),
})

const CENTER_STYLE = new Style({
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: PALETTE.accentLight }),
    stroke: new Stroke({ color: PALETTE.bgDeep, width: 2 }),
  }),
})

export function createAnalysisLayer(): {
  layer: VectorLayer<VectorSource>
  source: VectorSource
} {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    zIndex: 30,
    properties: { layerId: 'analysis' },
    style: (feature) => (feature.get('role') === 'center' ? CENTER_STYLE : BUFFER_STYLE),
  })
  return { layer, source }
}

/** 将缓冲区覆盖物写入图层（null 表示清除） */
export function renderBufferOverlay(source: VectorSource, overlay: BufferOverlay | null): void {
  source.clear()
  if (!overlay) return
  const polygon = createGeodesicBuffer(overlay.center, overlay.radiusM)
  const polygonFeature = new Feature(new Polygon([polygon.coordinates[0]!]))
  polygonFeature.set('role', 'buffer')
  const center = new Feature(new Point(overlay.center))
  center.set('role', 'center')
  source.addFeatures([polygonFeature, center])
}
