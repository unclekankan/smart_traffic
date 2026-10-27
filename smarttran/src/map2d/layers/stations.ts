/**
 * 地铁站点符号图层
 *
 * 仅绘制站点圆点：选中时青色描边加粗并出现光晕。
 * 换乘站（途经 ≥ 2 条线路）使用更大的符号与强调色，便于识别。
 * 站名注记已拆分到 stationLabels 图层，可独立开关。
 */

import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'

import { PALETTE } from '@/common/constants/colors'
import type { GeoJSONFeatureCollection } from '@/common/types/geo'
import type { MetroStopProps } from '@/common/types/metro'
import { styleState, withAlpha } from '../styles/shared'

const STATION_RADIUS = 5.5
const TRANSFER_RADIUS = 7.5

function stationStyle(feature: { getId(): string | number | undefined; get(key: string): unknown }): Style[] {
  const selected = String(feature.getId()) === styleState.selectedId
  const isTransfer = Number(feature.get('line_count') ?? 1) >= 2
  const radius = (isTransfer ? TRANSFER_RADIUS : STATION_RADIUS) * (selected ? 1.2 : 1)
  const styles: Style[] = []

  if (selected) {
    styles.push(
      new Style({
        image: new CircleStyle({
          radius: 13,
          fill: new Fill({ color: withAlpha(PALETTE.accent, 0.18) }),
          stroke: new Stroke({ color: withAlpha(PALETTE.accent, 0.55), width: 1.5 }),
        }),
      }),
    )
  }

  styles.push(
    new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: isTransfer ? PALETTE.accent : '#0E1626' }),
        stroke: new Stroke({
          color: isTransfer ? PALETTE.accentLight : PALETTE.accent,
          width: selected ? 2.5 : 1.8,
        }),
      }),
    }),
  )

  return styles
}

export function createStationLayer(
  stopCollection: GeoJSONFeatureCollection<MetroStopProps>,
): VectorLayer<VectorSource> {
  const features = new GeoJSON().readFeatures(stopCollection as object)
  // 以 stop_id 作为要素 id，供拾取与高亮使用
  features.forEach((f) => f.setId(String(f.get('stop_id'))))
  return new VectorLayer({
    source: new VectorSource({ features }),
    zIndex: 25,
    properties: { layerId: 'stations' },
    style: stationStyle,
  })
}
