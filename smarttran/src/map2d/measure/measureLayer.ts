/**
 * 测量图层与样式
 *
 * 测量结果几何与绘制草图共用青色系样式，与缓冲区分析图层区分层级：
 * measure zIndex 32 > analysis 30，保证测量图形始终浮于分析面之上。
 * 标注文本使用 ol/style/Text 直接绘制在几何锚点上，无需额外 DOM。
 */

import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'

import { PALETTE } from '@/common/constants/colors'
import type { LngLat } from '@/common/types/geo'
import { withAlpha } from '../styles/shared'

/** 标注文本锚点：折线取末点，面取内部点 */
function labelAnchor(geometry: Geometry): Point {
  if (geometry instanceof LineString) {
    const coords = geometry.getCoordinates()
    return new Point(coords[coords.length - 1] ?? [0, 0])
  }
  const interior = (geometry as Geometry & { getInteriorPoint?: () => Point }).getInteriorPoint?.()
  if (interior) return interior
  const extent = geometry.getExtent()
  const minX = extent[0] ?? 0
  const minY = extent[1] ?? 0
  const maxX = extent[2] ?? 0
  const maxY = extent[3] ?? 0
  return new Point([(minX + maxX) / 2, (minY + maxY) / 2])
}

/** 已完成标注的几何 + 文本样式（选中态加粗提亮） */
function annotationStyle(feature: Feature): Style[] {
  const selected = feature.get('selected') === true
  const visible = feature.get('visible') !== false
  const strokeColor = selected ? PALETTE.accentLight : PALETTE.accent
  const styles: Style[] = [
    new Style({
      fill: new Fill({ color: withAlpha(PALETTE.accent, selected ? 0.2 : 0.12) }),
      stroke: new Stroke({
        color: strokeColor,
        width: selected ? 3 : 2,
        lineDash: selected ? undefined : [7, 5],
      }),
      image: new CircleStyle({
        radius: selected ? 6 : 4,
        fill: new Fill({ color: selected ? '#FFFFFF' : PALETTE.accentLight }),
        stroke: new Stroke({ color: PALETTE.bgDeep, width: 2 }),
      }),
    }),
  ]
  if (!visible) return styles

  const labelPosition = feature.get('labelPosition') as LngLat | undefined
  const geometry = feature.getGeometry()
  if (!geometry) return styles
  const text = String(feature.get('text') ?? feature.get('label') ?? '')
  if (!text) return styles

  styles.push(
    new Style({
      geometry: labelPosition ? new Point(labelPosition) : labelAnchor(geometry),
      text: new Text({
        text,
        font: '600 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        fill: new Fill({ color: '#E8F1FB' }),
        stroke: new Stroke({ color: '#0A101C', width: 3 }),
        backgroundFill: new Fill({ color: 'rgba(10,16,28,0.88)' }),
        backgroundStroke: new Stroke({ color: selected ? PALETTE.accent : '#1B2A41', width: 1 }),
        padding: [4, 8, 4, 8],
        offsetY: -16,
        textAlign: 'center',
        overflow: true,
      }),
    }),
  )
  return styles
}

/** 绘制中的草图样式（实线 + 更明显的填充，便于与已完成结果区分） */
export function measureSketchStyle(): Style {
  return new Style({
    fill: new Fill({ color: withAlpha(PALETTE.accent, 0.16) }),
    stroke: new Stroke({ color: PALETTE.accent, width: 2.5 }),
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
    style: (feature) => annotationStyle(feature as Feature),
  })
  return { layer, source }
}
