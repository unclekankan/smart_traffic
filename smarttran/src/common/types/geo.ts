/**
 * 通用地理类型
 *
 * 平台内部统一使用 WGS84 经纬度（EPSG:4326，[经度, 纬度]）。
 * 此处提供最小化的 GeoJSON 类型定义，避免额外依赖，
 * 与 ol / Cesium 的数据桥接在各自引擎模块内完成。
 */

/** 经纬度坐标：[lon, lat]（EPSG:4326） */
export type LngLat = [number, number]

export interface PointGeom {
  type: 'Point'
  coordinates: LngLat
}

export interface LineStringGeom {
  type: 'LineString'
  coordinates: LngLat[]
}

export interface MultiLineStringGeom {
  type: 'MultiLineString'
  coordinates: LngLat[][]
}

export interface PolygonGeom {
  type: 'Polygon'
  /** 外环（演示数据不含内环） */
  coordinates: LngLat[][]
}

export type GeoJSONGeometry = PointGeom | LineStringGeom | MultiLineStringGeom | PolygonGeom

export interface GeoJSONFeature<P = Record<string, unknown>> {
  type: 'Feature'
  id?: string
  geometry: GeoJSONGeometry
  properties: P
}

export interface GeoJSONFeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: GeoJSONFeature<P>[]
}

/** 地图相机状态：2D/3D 切换时的视角保持依据 */
export interface CameraState {
  lon: number
  lat: number
  /** 视角尺度：2D 为 OpenLayers zoom，3D 为相机高度（米） */
  scale: number
  /** 精确 3D 相机高度（米）；用于恢复原视角 */
  height?: number
  /** 3D 相机姿态（弧度）；2D 不设置 */
  heading?: number
  pitch?: number
  roll?: number
}
