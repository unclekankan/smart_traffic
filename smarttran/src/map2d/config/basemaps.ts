/**
 * 在线底图注册表（2D）
 *
 * - 免费公共源：OpenStreetMap / 高德（矢量、影像），开箱即用
 * - 天地图：国家地理信息公共服务平台，需申请 API Key；
 *   拿到 Key 后填入下方 TIANDITU_KEY，对应条目自动启用
 */

import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import OSM from 'ol/source/OSM'
import type BaseLayer from 'ol/layer/Base'

/**
 * 天地图 API Key（预留）
 * 申请地址：https://console.tianditu.gov.cn/（服务端类型 / 浏览器端均可）
 */
export const TIANDITU_KEY = 'f3d29392f79e17190742644052afc5bc'

export type BasemapId =
  | 'osm'
  | 'amap-vector'
  | 'amap-satellite'
  | 'tianditu-vector'
  | 'tianditu-satellite'

export interface BasemapMeta {
  id: BasemapId
  label: string
  /** 依赖天地图 Key，未配置时在面板中禁用 */
  requiresKey?: boolean
}

export const BASEMAP_REGISTRY: readonly BasemapMeta[] = [
  { id: 'osm', label: 'OpenStreetMap' },
  { id: 'amap-vector', label: '高德 · 矢量' },
  { id: 'amap-satellite', label: '高德 · 影像' },
  { id: 'tianditu-vector', label: '天地图 · 矢量', requiresKey: true },
  { id: 'tianditu-satellite', label: '天地图 · 影像', requiresKey: true },
]

export const DEFAULT_BASEMAP_ID: BasemapId = 'osm'

/** 底图条目当前是否可用 */
export function isBasemapAvailable(meta: BasemapMeta): boolean {
  return !meta.requiresKey || TIANDITU_KEY.length > 0
}

/** 天地图瓦片地址（球面墨卡托 _w 系列，t0-t7 负载均衡） */
function tiandituUrl(layer: 'vec_w' | 'cva_w' | 'img_w' | 'cia_w'): string {
  return `https://t{0-7}.tianditu.gov.cn/DataServer?T=${layer}&x={x}&y={y}&l={z}&tk=${TIANDITU_KEY}`
}

function xyzTile(url: string, zIndex: number): TileLayer<XYZ> {
  return new TileLayer({
    source: new XYZ({ url, crossOrigin: 'anonymous', maxZoom: 18 }),
    zIndex,
  })
}

/** 按 id 构建底图图层（影像类为「底图 + 注记」两层） */
export function createBaseMapLayers(id: BasemapId): BaseLayer[] {
  switch (id) {
    case 'amap-vector':
      return [
        xyzTile(
          'https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
          0,
        ),
      ]
    case 'amap-satellite':
      return [
        xyzTile('https://webst0{1-4}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', 0),
        xyzTile('https://webst0{1-4}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', 1),
      ]
    case 'tianditu-vector':
      return [xyzTile(tiandituUrl('vec_w'), 0), xyzTile(tiandituUrl('cva_w'), 1)]
    case 'tianditu-satellite':
      return [xyzTile(tiandituUrl('img_w'), 0), xyzTile(tiandituUrl('cia_w'), 1)]
    case 'osm':
    default:
      return [
        new TileLayer({
          source: new OSM(),
          zIndex: 0,
          properties: { layerId: 'base-map' },
        }),
      ]
  }
}
