/**
 * 地铁站点名称注记图层
 *
 * 与站点符号（stations）分离，便于独立开关：大范围浏览时可关闭注记，
 * 避免 338 个站名互相压盖。注记不参与拾取，交互仍由站点符号承担。
 */

import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Text } from 'ol/style'

import { PALETTE } from '@/common/constants/colors'
import type { GeoJSONFeatureCollection } from '@/common/types/geo'
import type { MetroStopProps } from '@/common/types/metro'
import { MAP_FONT_STACK, styleState, withAlpha } from '../styles/shared'

export function createStationLabelLayer(
  stopCollection: GeoJSONFeatureCollection<MetroStopProps>,
): VectorLayer<VectorSource> {
  const features = new GeoJSON().readFeatures(stopCollection as object)
  features.forEach((f) => f.setId(String(f.get('stop_id'))))

  return new VectorLayer({
    source: new VectorSource({ features }),
    zIndex: 26,
    properties: { layerId: 'stationLabels' },
    // 注记图层不参与点击/悬停拾取
    declutter: true,
    style: (feature) => {
      const selected = String(feature.getId()) === styleState.selectedId
      return new Style({
        text: new Text({
          text: String(feature.get('stop_cn') ?? ''),
          font: `${selected ? 600 : 500} 11px ${MAP_FONT_STACK}`,
          fill: new Fill({
            color: selected ? PALETTE.accentLight : withAlpha(PALETTE.textPrimary, 0.85),
          }),
          stroke: new Stroke({ color: withAlpha(PALETTE.bgDeep, 0.9), width: 3 }),
          offsetY: -14,
        }),
      })
    },
  })
}
