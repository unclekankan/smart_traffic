/**
 * 公交图层（GeoServer WMS）
 *
 * 使用 OpenLayers TileWMS 直接叠加服务端渲染的瓦片：
 * 线路在站点之下（zIndex 20 < 21），二者仅在公交网络模式下可见，
 * 由 Map2DEngine 统一控制显隐。
 */

import TileLayer from 'ol/layer/Tile'
import TileWMS from 'ol/source/TileWMS'

import { BUS_WMS_LAYERS, BUS_WMS_URL } from '../config/busWms'

function createWmsLayer(layerName: string, layerId: string, zIndex: number): TileLayer<TileWMS> {
  return new TileLayer({
    source: new TileWMS({
      url: BUS_WMS_URL,
      // VERSION 使用 1.1.1：SRS=EPSG:4326 按 lon/lat 轴序请求，与视图投影一致
      params: {
        LAYERS: layerName,
        FORMAT: 'image/png',
        TRANSPARENT: true,
        VERSION: '1.1.1',
        TILED: true,
      },
      serverType: 'geoserver',
    }),
    zIndex,
    properties: { layerId },
  })
}

/** 公交线路 WMS 图层 */
export function createBusRouteLayer(): TileLayer<TileWMS> {
  return createWmsLayer(BUS_WMS_LAYERS.routes, 'busRoutes', 20)
}

/** 公交站点 WMS 图层 */
export function createBusStopLayer(): TileLayer<TileWMS> {
  return createWmsLayer(BUS_WMS_LAYERS.stops, 'busStops', 21)
}

/** 公交站点名称 WMS 图层（注记压在最上层，避免被站点符号遮挡） */
export function createBusStopNameLayer(): TileLayer<TileWMS> {
  return createWmsLayer(BUS_WMS_LAYERS.stopNames, 'busStopNames', 22)
}
