/**
 * 测量图层与样式
 *
 * 测量结果几何与绘制草图共用青色系样式，与缓冲区分析图层区分层级：
 * measure zIndex 32 > analysis 30，保证测量图形始终浮于分析面之上。
 */

import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'

import { PALETTE } from '@/common/constants/colors'
import { withAlpha } from '../styles/shared'

/** 测量完成后的几何样式 */
const MEASURE_STYLE = new Style({
  fill: new Fill({ color: withAlpha(PALETTE.accent, 0.1) }),
  stroke: new Stroke({ color: PALETTE.accentLight, width: 2, lineDash: [7, 5] }),
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: PALETTE.accentLight }),
    stroke: new Stroke({ color: PALETTE.bgDeep, width: 2 }),
  }),
})

/** 绘制中的草图样式（实线 + 更明显的填充，便于与已完成结果区分） */
export function measureSketchStyle(): Style {
  return new Style({
    fill: new Fill({ color: withAlpha(PALETTE.accent, 0.16) }),
    stroke: new Stroke({ color: PALETTE.accent, width: 2 }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: PALETTE.accent }),
      stroke: new Stroke({ color: PALETTE.bgDeep, width: 2 }),
    }),
  })
}

export function createMeasureLayer(): {
  layer: VectorLayer<VectorSource>
  source: VectorSource
} {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    zIndex: 32,
    properties: { layerId: 'measure' },
    style: MEASURE_STYLE,
  })
  return { layer, source }
}
