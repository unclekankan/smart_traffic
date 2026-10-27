/**
 * 选中公交线路的矢量叠加层
 *
 * 区别于 GeoServer 发布的全量公交 WMS（覆盖全部 3048 条线路 + 13817 站点），
 * 本模块为**某一条**选中的公交线路单独渲染：
 *  - 线路本体（MultiLineString/LineString → 粗线 + 青色高亮描边，保证压过 WMS）
 *  - 站点符号（Point → 蓝底白边圆点，配 PALETTE.accent 边色）
 *  - 站点名称注记（Point → 白底深字标签，font 11px）
 *
 * 三个图层可以独立控制显隐，对应 store 里的 busRouteStopsVisible / busRouteNamesVisible。
 * 全部放最上层（zIndex 80+），避免被 WMS / 地铁图层遮挡。
 */

import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
  Text,
} from 'ol/style'

import { PALETTE } from '@/common/constants/colors'
import type { BusRouteFeature, BusStopFeature } from '@/common/types/bus'
import type { GeoJSONFeatureCollection } from '@/common/types/geo'

/** 三个图层的 zIndex（全部高于地铁 + WMS） */
const Z_ROUTE = 80
const Z_STOPS = 81
const Z_NAMES = 82

const format = new GeoJSON()

/** 选中公交线路的矢量 source（线路本体） */
export function createSelectedRouteSource(): VectorSource {
  return new VectorSource()
}

/** 选中公交线路的站点矢量 source */
export function createSelectedRouteStopSource(): VectorSource {
  return new VectorSource()
}

/** 选中公交线路的站点名称注记 source */
export function createSelectedRouteNameSource(): VectorSource {
  return new VectorSource()
}

/** 把后端返回的线路 GeoJSON 装进 source */
export function loadRouteFeature(source: VectorSource, feature: BusRouteFeature | null): void {
  source.clear()
  if (!feature) return
  // OpenLayers GeoJSON format 的 readFeatures 接受 Feature/Feature[]/FeatureCollection，统一返回数组
  const olFeats = format.readFeatures(
    feature as unknown as Parameters<GeoJSON['readFeatures']>[0],
  )
  const first = olFeats[0]
  if (first) source.addFeature(first)
}

/** 把后端返回的沿线站点 GeoJSON FeatureCollection 装进 source */
export function loadStopFeatures(
  source: VectorSource,
  features: GeoJSONFeatureCollection<BusStopFeature['properties']> | null,
): void {
  source.clear()
  if (!features) return
  const olFeats = format.readFeatures(
    features as unknown as Parameters<GeoJSON['readFeatures']>[0],
  )
  source.addFeatures(olFeats)
}

// ---- 创建三个 VectorLayer，各自可独立 setVisible ---- //

/** 选中公交线路本体（双层描边：亮青衬底 + 高亮主线） */
export function createSelectedRouteLayer(source: VectorSource): VectorLayer<VectorSource> {
  return new VectorLayer({
    source,
    zIndex: Z_ROUTE,
    properties: { layerId: 'selectedBusRoute' },
    style: () => [
      new Style({
        stroke: new Stroke({ color: 'rgba(53, 200, 232, 0.35)', width: 12 }),
      }),
      new Style({
        stroke: new Stroke({ color: PALETTE.accent, width: 5.5 }),
      }),
      new Style({
        stroke: new Stroke({ color: PALETTE.accentLight, width: 1.5 }),
      }),
    ],
  })
}

/** 选中公交线路的站点符号（蓝底白边圆点） */
export function createSelectedRouteStopLayer(source: VectorSource): VectorLayer<VectorSource> {
  return new VectorLayer({
    source,
    zIndex: Z_STOPS,
    properties: { layerId: 'selectedBusStops' },
    style: () =>
      new Style({
        image: new CircleStyle({
          radius: 5.5,
          fill: new Fill({ color: '#3a8dff' }),
          stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
        }),
      }),
  })
}

/** 选中公交线路的站点名称注记（白底深字） */
export function createSelectedRouteNameLayer(source: VectorSource): VectorLayer<VectorSource> {
  return new VectorLayer({
    source,
    zIndex: Z_NAMES,
    properties: { layerId: 'selectedBusNames' },
    style: (feature): Style | Style[] | undefined => {
      const props = feature.getProperties() as BusStopFeature['properties']
      const name = props.stop_cn ?? ''
      if (!name) return undefined
      return new Style({
        text: new Text({
          text: name,
          font: '11px sans-serif',
          offsetY: -11,
          padding: [2, 5, 2, 5],
          fill: new Fill({ color: '#0a101c' }),
          backgroundFill: new Fill({ color: 'rgba(232, 241, 251, 0.9)' }),
          backgroundStroke: new Stroke({ color: PALETTE.accent, width: 1 }),
        }),
      })
    },
  })
}
