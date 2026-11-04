/**
 * 空间分析叠加图层
 *
 * - 覆盖分析：后端网格化后的连续覆盖色带（按覆盖层数 1→5+ 由浅到深）
 * - 附近站点：查询范围圈、中心点、地铁站 / 公交站标记
 *
 * 缓冲区与统计结果均由后端 PostGIS 计算，前端只负责渲染。
 */

import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import LineString from 'ol/geom/LineString'
import MultiLineString from 'ol/geom/MultiLineString'

import { COVERAGE_RAMP, PALETTE } from '@/common/constants/colors'
import type { CoverageResult, NearbyStopsResult, StationBufferResult } from '@/common/types/analysis'
import { createGeodesicBuffer } from '@/tools'
import { withAlpha } from '../styles/shared'

/**
 * 覆盖色带样式：按覆盖层数取色，1 层浅、5 层以上深。
 * 填充使用同色描边（无色差），相邻色块连成一片，避免出现单个圆或网格缝隙。
 */
const COVERAGE_STYLES = COVERAGE_RAMP.map(
  (c) =>
    new Style({
      fill: new Fill({ color: withAlpha(c.fill, 0.9) }),
      stroke: new Stroke({ color: withAlpha(c.fill, 0.9), width: 0 }),
    }),
)

const NEARBY_RADIUS_STYLE = new Style({
  fill: new Fill({ color: 'rgba(13, 37, 58, 0.28)' }),
  stroke: new Stroke({ color: '#35C8E8', width: 2, lineDash: [7, 6] }),
})

const CENTER_STYLE = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: PALETTE.accentLight }),
    stroke: new Stroke({ color: PALETTE.bgDeep, width: 2 }),
  }),
})

const NEARBY_STOP_STYLE = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: '#FFE34D' }),
    stroke: new Stroke({ color: '#172033', width: 2 }),
  }),
})

/** 覆盖分析图层（连续覆盖色带，透明度由图层整体控制） */
export function createCoverageLayer(): {
  layer: VectorLayer<VectorSource>
  source: VectorSource
} {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    zIndex: 30,
    properties: { layerId: 'coverage' },
    style: (feature) => {
      // 覆盖层数 1 → 5+ 映射到浅 → 深色带
      const level = Math.min(5, Math.max(1, Number(feature.get('level') ?? 1)))
      return COVERAGE_STYLES[level - 1]!
    },
  })
  return { layer, source }
}

/** 附近站点查询图层 */
export function createNearbyLayer(): {
  layer: VectorLayer<VectorSource>
  source: VectorSource
} {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    zIndex: 31,
    properties: { layerId: 'nearby' },
    style: (feature) => {
      const role = feature.get('role')
      if (role === 'radius') return NEARBY_RADIUS_STYLE
      if (role === 'center') return CENTER_STYLE
      return NEARBY_STOP_STYLE
    },
  })
  return { layer, source }
}

/** 写入覆盖分析结果（null 表示清除） */
export function renderCoverageOverlay(
  source: VectorSource,
  result: CoverageResult | null,
): void {
  source.clear()
  if (!result) return
  // 连续色带：每层一个（或多个）连续多边形，按层数从低到高绘制
  const format = new GeoJSON()
  const features = format.readFeatures(result.zones as object)
  features.sort((a, b) => Number(a.get('level') ?? 1) - Number(b.get('level') ?? 1))
  source.addFeatures(features)
}

const STATION_BUFFER_SOURCE = new VectorSource()
const BUFFER_LINE_STYLE = new Style({ stroke: new Stroke({ color: '#E53935', width: 2.5 }) })
const SELECTED_BUFFER_LINE_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(255, 225, 77, 0.35)', width: 10 }),
})
const SELECTED_BUFFER_LINE_CORE_STYLE = new Style({
  stroke: new Stroke({ color: '#FFE14D', width: 5 }),
})
const SELECTED_BUFFER_STOP_STYLE = new Style({
  image: new CircleStyle({ radius: 9, fill: new Fill({ color: '#FF4D6D' }), stroke: new Stroke({ color: '#FFFFFF', width: 2.5 }) }),
})
let selectedBufferObject: { kind: string; id: string } | null = null

export function setStationBufferSelection(target: { kind: string; id: string } | null): void {
  selectedBufferObject = target
  stationBufferLayer.changed()
}

export const stationBufferLayer = new VectorLayer({
  source: STATION_BUFFER_SOURCE,
  zIndex: 32,
  properties: { layerId: 'station-buffer-analysis' },
  style: (feature) => {
    const role = String(feature.get('analysisRole') ?? '')
    if (role === 'buffer') return NEARBY_RADIUS_STYLE
    const isLine = feature.getGeometry() instanceof LineString || feature.getGeometry() instanceof MultiLineString
    const selected = selectedBufferObject
      && String(feature.get('kind')) === selectedBufferObject.kind
      && String(feature.get('id') ?? feature.getId()) === selectedBufferObject.id
    if (selected && isLine) return [SELECTED_BUFFER_LINE_STYLE, SELECTED_BUFFER_LINE_CORE_STYLE]
    if (selected) return SELECTED_BUFFER_STOP_STYLE
    if (isLine) return BUFFER_LINE_STYLE
    const kind = feature.get('kind')
    return kind === 'metro' ? NEARBY_STOP_STYLE : new Style({
      image: new CircleStyle({ radius: 5, fill: new Fill({ color: '#3DDC97' }), stroke: new Stroke({ color: '#172033', width: 1.5 }) }),
    })
  },
})

export function renderStationBufferOverlay(result: StationBufferResult | null): void {
  STATION_BUFFER_SOURCE.clear()
  if (!result) return
  const format = new GeoJSON()
  const collections = [
    { data: result.buffer, role: 'buffer' },
    { data: result.metroStops, role: 'metro' },
    { data: result.busStops, role: 'bus' },
    { data: result.metroLines, role: 'metro-line' },
    { data: result.busLines, role: 'bus-line' },
  ]
  for (const { data, role } of collections) {
    const features = format.readFeatures(data as object)
    for (const feature of features) {
      feature.set('analysisRole', role)
      feature.set('kind', role.startsWith('metro') ? 'metro' : 'bus')
      STATION_BUFFER_SOURCE.addFeature(feature)
    }
  }
}

/** 写入附近站点分析结果（null 表示清除） */
export function renderNearbyOverlay(
  source: VectorSource,
  result: NearbyStopsResult | null,
): void {
  source.clear()
  if (!result) return

  // 搜索范围圈 + 中心点
  const [lon, lat] = result.center
  const area = new Feature(new Polygon([createGeodesicBuffer(result.center, result.radiusM).coordinates[0]!]))
  area.set('role', 'radius')
  const center = new Feature(new Point([lon, lat]))
  center.set('role', 'center')
  source.addFeatures([area, center])

  // 站点标记（地铁/公交不同颜色）
  for (const stop of result.stops) {
    const feature = new Feature(new Point([stop.lon, stop.lat]))
    feature.setId(`nearby:${stop.kind}:${stop.id}`)
    feature.setProperties({
      role: 'stop',
      kind: stop.kind,
      name: stop.name,
      distanceM: stop.distanceM,
    })
    source.addFeature(feature)
  }
}
