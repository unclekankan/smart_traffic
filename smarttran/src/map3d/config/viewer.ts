/**
 * 三维视图默认参数
 *
 * 演示场景不依赖在线影像与地形：底面使用 Cesium 内置
 * GridImageryProvider（程序化网格，非静态贴图），与原型的
 * 「三维车站场景」网格地面一致。
 */

import { CHENGDU_CENTER } from '@/map2d/config/view'
import { PALETTE } from '@/common/constants/colors'
import * as Cesium from 'cesium'

/** 相机初始位：成都市中心上空，俯视全市地铁线网 */
export const MAP3D_CAMERA = {
  lon: CHENGDU_CENTER[0],
  lat: CHENGDU_CENTER[1],
  height: 65000,
  headingDeg: 0,
  pitchDeg: -55,
} as const

/** 2D zoom ↔ 3D 高度的经验换算（2D/3D 切换时保持视角尺度） */
export function zoomToHeight(zoom: number): number {
  return 5900 * Math.pow(2, 16 - zoom)
}

export function heightToZoom(height: number): number {
  return 16 - Math.log2(height / 5900)
}

/** Viewer 基础外观设置（深色 + 网格底面） */
export const GRID_STYLE = {
  cells: 8,
  color: Cesium.Color.fromCssColorString('#182A45'),
  glowColor: Cesium.Color.fromCssColorString('#20365A'),
  glowWidth: 1,
  backgroundColor: Cesium.Color.fromCssColorString(PALETTE.bgDeep),
}

/** 三维模型体块配色（对应原型 LOD-2 车站体块） */
export const MODEL_COLORS = {
  canopy: Cesium.Color.fromCssColorString('#8FB3CC'),
  core: Cesium.Color.fromCssColorString('#3D5A75'),
  platform: Cesium.Color.fromCssColorString('#4A6B85'),
} as const
