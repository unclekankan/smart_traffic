/**
 * 二维视图默认参数
 *
 * 视图投影采用 EPSG:4326（与状态栏「坐标系 WGS 84 / EPSG:4326」一致），
 * 数据即经纬度，无需重投影。中心对准成都市。
 */

/** 成都市中心经纬度 */
export const CHENGDU_CENTER: [number, number] = [104.0665, 30.67]

/** 成都市大致范围 [minLon, minLat, maxLon, maxLat]（仅用于限制视图不外移过远） */
export const CHENGDU_EXTENT: [number, number, number, number] = [
  103.4, 30.0, 104.8, 31.2,
]

export const MAP2D_VIEW = {
  projection: 'EPSG:4326',
  center: CHENGDU_CENTER,
  /** 默认缩放：成都市域概览 */
  zoom: 11.2,
  minZoom: 9.5,
  maxZoom: 18,
  extent: CHENGDU_EXTENT,
} as const
