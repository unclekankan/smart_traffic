/**
 * 公共交通路线规划图层
 *
 * - 路线：步行虚线 / 公交蓝色实线 / 地铁紫色实线
 * - 多方案：非选中方案淡化，选中方案完全不透明并后绘制（置顶）
 * - 标记：起点（绿）、终点（红）、换乘点（带序号）、选中方案的站点
 */

import Feature, { type FeatureLike } from 'ol/Feature'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'

import type { TransitPlanResult, TransitSegmentType } from '@/common/types/transit'
import { withAlpha } from '../styles/shared'

interface RouteStyleDef {
  color: string
  width: number
  lineDash?: number[]
}

const ROUTE_DEFS: Record<TransitSegmentType, RouteStyleDef> = {
  walk: { color: '#8FA3B8', width: 4, lineDash: [10, 8] },
  bus: { color: '#2979FF', width: 6 },
  metro: { color: '#7C4DFF', width: 6 },
}

const ROUTE_STYLES: Record<TransitSegmentType, Style> = {
  walk: new Style({
    stroke: new Stroke({
      color: ROUTE_DEFS.walk.color,
      width: ROUTE_DEFS.walk.width,
      lineDash: ROUTE_DEFS.walk.lineDash,
    }),
  }),
  bus: new Style({ stroke: new Stroke({ color: ROUTE_DEFS.bus.color, width: ROUTE_DEFS.bus.width }) }),
  metro: new Style({ stroke: new Stroke({ color: ROUTE_DEFS.metro.color, width: ROUTE_DEFS.metro.width }) }),
}

const DIMMED_STYLES: Record<TransitSegmentType, Style> = {
  walk: new Style({
    stroke: new Stroke({
      color: withAlpha(ROUTE_DEFS.walk.color, 0.35),
      width: 3,
      lineDash: ROUTE_DEFS.walk.lineDash,
    }),
  }),
  bus: new Style({ stroke: new Stroke({ color: withAlpha(ROUTE_DEFS.bus.color, 0.35), width: 4 }) }),
  metro: new Style({ stroke: new Stroke({ color: withAlpha(ROUTE_DEFS.metro.color, 0.35), width: 4 }) }),
}

const STOP_STYLES: Record<'bus' | 'metro', Style> = {
  bus: new Style({
    image: new CircleStyle({
      radius: 4,
      fill: new Fill({ color: '#FFFFFF' }),
      stroke: new Stroke({ color: ROUTE_DEFS.bus.color, width: 2 }),
    }),
  }),
  metro: new Style({
    image: new CircleStyle({
      radius: 4,
      fill: new Fill({ color: ROUTE_DEFS.metro.color }),
      stroke: new Stroke({ color: '#FFFFFF', width: 1.5 }),
    }),
  }),
}

const transferStyles = new Map<string, Style>()

function transferStyle(label: string): Style {
  let style = transferStyles.get(label)
  if (!style) {
    style = new Style({
      image: new CircleStyle({
        radius: 9,
        fill: new Fill({ color: '#F5A83D' }),
        stroke: new Stroke({ color: '#FFFFFF', width: 2 }),
      }),
      text: new Text({
        text: label,
        font: '600 10px "PingFang SC", "Microsoft YaHei", sans-serif',
        fill: new Fill({ color: '#0A101C' }),
        textAlign: 'center',
        textBaseline: 'middle',
      }),
      zIndex: 18,
    })
    transferStyles.set(label, style)
  }
  return style
}

function styleOf(feature: FeatureLike): Style | Style[] | undefined {
  const role = String(feature.get('role') ?? '')
  if (role === 'route') {
    const type = String(feature.get('segmentType') ?? 'walk') as TransitSegmentType
    const selected = Boolean(feature.get('selected'))
    return selected ? ROUTE_STYLES[type] : DIMMED_STYLES[type]
  }
  if (role === 'transfer') return transferStyle(String(feature.get('label') ?? '换'))
  if (role === 'stop') {
    return String(feature.get('segmentType')) === 'metro' ? STOP_STYLES.metro : STOP_STYLES.bus
  }
  return undefined
}

export function createTransitLayer(): {
  layer: VectorLayer<VectorSource>
  source: VectorSource
} {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    zIndex: 40,
    declutter: true,
    properties: { layerId: 'transit-route' },
    style: styleOf,
  })
  return { layer, source }
}

/** 写入 / 清除路线规划结果（起终点标记由引擎 DOM Overlay 渲染） */
export function renderTransitPlan(
  source: VectorSource,
  result: TransitPlanResult | null,
  selectedId: string | null,
): void {
  source.clear()
  if (!result || !result.alternatives.length) return

  const selected = selectedId ?? result.alternatives[0]!.id
  const dimmed = result.alternatives.filter((alt) => alt.id !== selected)
  const highlighted = result.alternatives.find((alt) => alt.id === selected)

  // 先画非选中方案，再画选中方案，保证选中方案在最上层
  for (const alt of dimmed) addAlternative(source, result, alt.id, false)
  if (highlighted) addAlternative(source, result, highlighted.id, true)
}

function addAlternative(
  source: VectorSource,
  result: TransitPlanResult,
  altId: string,
  selected: boolean,
): void {
  const alt = result.alternatives.find((item) => item.id === altId)
  if (!alt) return

  const stopKeys = new Set<string>()
  let transferIndex = 0

  alt.segments.forEach((segment, index) => {
    if (segment.polyline.length >= 2) {
      const feature = new Feature({ geometry: new LineString(segment.polyline) })
      feature.setId(`transit:${altId}:route:${index}`)
      feature.setProperties({ role: 'route', segmentType: segment.type, selected })
      source.addFeature(feature)
    }

    if (!selected) return

    // 站点标记（起终点站 + 途经站）
    const stops = segment.type === 'walk'
      ? []
      : [...segment.stops]
    for (const stop of stops) {
      const key = stop.id || `${stop.name}:${stop.lng},${stop.lat}`
      if (stopKeys.has(key)) continue
      stopKeys.add(key)
      const feature = new Feature({ geometry: new Point([stop.lng, stop.lat]) })
      feature.setId(`transit:${altId}:stop:${key}`)
      feature.setProperties({
        role: 'stop',
        segmentType: segment.type,
        name: stop.name,
      })
      source.addFeature(feature)
    }

    // 换乘点（公交 / 地铁段到下一段的衔接点，带序号）
    if (segment.transfer) {
      transferIndex += 1
      const feature = new Feature({
        geometry: new Point([segment.arrivalStop.lng, segment.arrivalStop.lat]),
      })
      feature.setId(`transit:${altId}:transfer:${transferIndex}`)
      feature.setProperties({
        role: 'transfer',
        label: String(transferIndex),
        name: segment.arrivalStop.name,
      })
      source.addFeature(feature)
    }
  })
}
