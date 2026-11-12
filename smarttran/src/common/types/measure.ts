/**
 * 测量业务类型
 *
 * 距离 / 面积分别由 OpenLayers（ol/sphere）与 Cesium（EllipsoidGeodesic）
 * 两套成熟开源库计算，结果以业务对象形式经 MapEngine 事件上报，
 * UI 层不直接依赖任何地图库。
 */

import type { LngLat } from './geo'

/** 测量模式 */
export type MeasureMode = 'distance' | 'area'

/** 一次测量的结果（绘制中 / 完成后共用） */
export interface MeasureResult {
  mode: MeasureMode
  /** 距离模式为折线总长（米）；面积模式为多边形面积（平方米） */
  value: number
  /** 距离模式：各分段长度（米） */
  segments: number[]
  /** 面积模式：周长（米） */
  perimeter: number
  /** 距离模式为取点数，面积模式为环上顶点数 */
  vertexCount: number
  /** 测量几何顶点（WGS84；面积模式为未闭合的外环） */
  points: LngLat[]
}

/**
 * 已完成的测量标注
 *
 * 每个标注是一份可独立管理的测量成果：可重命名、显隐、删除，
 * 并可进入顶点编辑模式调整几何后重新计算。
 */
export interface MeasureAnnotation extends MeasureResult {
  /** 标注唯一 id（引擎生成） */
  id: string
  /** 标注名称（可编辑） */
  label: string
  /** 是否显示地图上的文本标注 */
  visible: boolean
}
