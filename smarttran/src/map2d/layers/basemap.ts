/**
 * 在线底图图层组
 *
 * 底图来源见 map2d/config/basemaps 注册表（OSM / 高德 / 天地图预留）。
 * 以 LayerGroup 承载（影像类底图含「底图 + 注记」两层），
 * 切换底图时整组替换，zIndex 恒为 0，始终位于业务图层之下。
 */

import LayerGroup from 'ol/layer/Group'
import Collection from 'ol/Collection'

import {
  createBaseMapLayers,
  DEFAULT_BASEMAP_ID,
  type BasemapId,
} from '../config/basemaps'

export function createBaseMapGroup(id: BasemapId = DEFAULT_BASEMAP_ID): LayerGroup {
  const group = new LayerGroup({
    layers: new Collection(createBaseMapLayers(id)),
    properties: { layerId: 'basemap' },
    zIndex: 0,
  })
  return group
}

/** 切换底图：替换图层组内容 */
export function setBaseMap(group: LayerGroup, id: BasemapId): void {
  group.setLayers(new Collection(createBaseMapLayers(id)))
}
