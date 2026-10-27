/**
 * 公交 WMS 数据源配置
 *
 * 数据由本地 GeoServer（工作区 smart_triffic）以 WMS 1.1.1 发布，
 * 视图投影 EPSG:4326，与地图视图一致，无需额外重投影。
 */

/** GeoServer WMS 根地址（GetMap 由 OpenLayers TileWMS 自动拼接） */
export const BUS_WMS_URL = 'http://localhost:8080/geoserver/smart_triffic/wms'

/** 公交 WMS 图层名 */
export const BUS_WMS_LAYERS = {
  /** 公交线路（线状） */
  routes: 'smart_triffic:chengdu_bus_routes',
  /** 公交站点（点状） */
  stops: 'smart_triffic:chengdu_bus_stops_unique',
  /** 公交站点名称（注记） */
  stopNames: 'smart_triffic:chengdu_bus_stops_unique_name',
} as const
