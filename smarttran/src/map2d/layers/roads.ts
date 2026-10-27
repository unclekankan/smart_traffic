/**
 * 地铁线路图层
 *
 * 双描边渲染：深色衬底 + 线路语义色主线；
 * 选中时叠加青色高亮（与原型「线路选中」语义一致）。
 * 不同线路通过 id 哈希从调色板取色，便于区分。
 */

import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Stroke, Style } from 'ol/style'

import { PALETTE } from '@/common/constants/colors'
import type { GeoJSONFeatureCollection } from '@/common/types/geo'
import type { MetroRouteProps } from '@/common/types/metro'
import { styleState, withAlpha } from '../styles/shared'

const CASING_WIDTH = 6
const ROAD_WIDTH = 3.5

/** 地铁线路调色板（按线路 id 取模循环） */
const METRO_PALETTE = [
  '#E60012', '#009B6B', '#FFB800', '#005BAC', '#9B59B6',
  '#E91E63', '#00BCD4', '#FF7043', '#607D8B', '#795548',
  '#3F51B5', '#8BC34A', '#FF5722', '#009688', '#9C27B0',
]

export function routeColor(id: number | string): string {
  const n = typeof id === 'number' ? id : parseInt(id, 10) || 0
  return METRO_PALETTE[Math.abs(n) % METRO_PALETTE.length] ?? '#4C9AFF'
}

function roadStyle(feature: { getId(): string | number | undefined }): Style[] {
  const id = String(feature.getId())
  const color = routeColor(feature.getId() ?? 0)

  if (id === styleState.selectedId) {
    return [
      new Style({ stroke: new Stroke({ color: withAlpha(PALETTE.accent, 0.3), width: 14 }) }),
      new Style({ stroke: new Stroke({ color: PALETTE.accent, width: 7 }) }),
      new Style({ stroke: new Stroke({ color: PALETTE.accentLight, width: 2 }) }),
    ]
  }
  if (styleState.analysisHitIds.has(id)) {
    return [
      new Style({ stroke: new Stroke({ color: withAlpha(PALETTE.accent, 0.22), width: 9 }) }),
      new Style({ stroke: new Stroke({ color: PALETTE.roadCasing, width: CASING_WIDTH }) }),
      new Style({ stroke: new Stroke({ color, width: ROAD_WIDTH }) }),
    ]
  }
  return [
    new Style({ stroke: new Stroke({ color: PALETTE.roadCasing, width: CASING_WIDTH }) }),
    new Style({ stroke: new Stroke({ color, width: ROAD_WIDTH }) }),
  ]
}

export function createRoadLayer(
  routeCollection: GeoJSONFeatureCollection<MetroRouteProps>,
): VectorLayer<VectorSource> {
  const features = new GeoJSON().readFeatures(routeCollection as object)
  // 以业务 id 作为要素 id（线路主键 id），供拾取与高亮使用
  features.forEach((f) => f.setId(String(f.get('id'))))
  return new VectorLayer({
    source: new VectorSource({ features }),
    zIndex: 20,
    properties: { layerId: 'roads' },
    style: roadStyle,
  })
}
