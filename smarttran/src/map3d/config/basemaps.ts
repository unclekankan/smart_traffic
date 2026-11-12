/**
 * Cesium 在线底图注册表（3D）
 *
 * 与 map2d/config/basemaps 共用同一套 BasemapId 常量与 TIANDITU_KEY，
 * 但 URL 模板写法适配 Cesium UrlTemplateImageryProvider：
 * - OpenLayers XYZ 的 glob `{1-4}` / `{0-7}` 需替换为 Cesium 的 `{s}` + subdomains 数组
 * - 两种引擎切片投影一致（EPSG:3857 Web Mercator），URL 模板的 `{x}` `{y}` `{z}` 不变
 */

import * as Cesium from 'cesium'

import { TIANDITU_KEY } from '@/map2d/config/basemaps'
import { GRID_STYLE } from './viewer'

export type BasemapId3D =
  | 'grid' // 程序化网格（无在线请求，默认）
  | 'osm'
  | 'amap-vector'
  | 'amap-satellite'
  | 'tianditu-vector'
  | 'tianditu-satellite'

/**
 * 3D 模式默认底图：优先天地图矢量（官方政务地理底图）
 * 切换到 3D 时自动加载；若该底图不可用（瓦片加载持续失败），
 * 按 DEFAULT_3D_BASEMAP_FALLBACK 顺序自动回退到其他标准矢量底图。
 */
export const DEFAULT_3D_BASEMAP_ID: BasemapId3D = 'tianditu-vector'

/** 默认底图失败时的回退顺序（仅矢量底图，保证 3D 场景可读性） */
export const DEFAULT_3D_BASEMAP_FALLBACK: BasemapId3D[] = ['amap-vector', 'osm']

/** 天地图瓦片（球面墨卡托 _w 系列）
 * 域名格式为 `t{0-7}.tianditu.gov.cn`（t 前缀 + 负载均衡数字）。
 * Cesium UrlTemplateImageryProvider 的 subdomains 数组会直接替换 `{s}`，
 * 因此 URL 模板必须写 `t{s}.tianditu.gov.cn`（而非 `{s}.tianditu.gov.cn`），
 * 否则生成 `https://0.tianditu.gov.cn`（缺 t 前缀）导致连接被拒。
 */
function tiandituUrl(layer: 'vec_w' | 'cva_w' | 'img_w' | 'cia_w'): string {
  return `https://t{s}.tianditu.gov.cn/DataServer?T=${layer}&x={x}&y={y}&l={z}&tk=${TIANDITU_KEY}`
}

/**
 * 按 id 构建 Cesium ImageryLayer 数组
 * - 影像类底图含「底图 + 注记」两层，按顺序返回（底图在前、注记在后）
 * - 所有在线瓦片走 Web Mercator（Cesium 默认 UrlTemplateImageryProvider 投影）
 */
export function createBaseMapLayers3D(id: string): Cesium.ImageryLayer[] {
  switch (id) {
    case 'grid':
      return [
        new Cesium.ImageryLayer(
          new Cesium.GridImageryProvider({
            cells: GRID_STYLE.cells,
            color: GRID_STYLE.color,
            glowColor: GRID_STYLE.glowColor,
            glowWidth: GRID_STYLE.glowWidth,
            backgroundColor: GRID_STYLE.backgroundColor,
          }),
        ),
      ]

    case 'amap-vector':
      return [
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
            subdomains: ['1', '2', '3', '4'],
            maximumLevel: 18,
          }),
        ),
      ]

    case 'amap-satellite':
      return [
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
            subdomains: ['1', '2', '3', '4'],
            maximumLevel: 18,
          }),
        ),
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
            subdomains: ['1', '2', '3', '4'],
            maximumLevel: 18,
          }),
        ),
      ]

    case 'tianditu-vector':
      return [
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: tiandituUrl('vec_w'),
            subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
            maximumLevel: 18,
          }),
        ),
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: tiandituUrl('cva_w'),
            subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
            maximumLevel: 18,
          }),
        ),
      ]

    case 'tianditu-satellite':
      return [
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: tiandituUrl('img_w'),
            subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
            maximumLevel: 18,
          }),
        ),
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: tiandituUrl('cia_w'),
            subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
            maximumLevel: 18,
          }),
        ),
      ]

    case 'osm':
    default:
      return [
        new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            maximumLevel: 19,
          }),
        ),
      ]
  }
}
