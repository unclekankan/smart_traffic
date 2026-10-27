/**
 * 测量业务类型
 *
 * 距离 / 面积由 OpenLayers 原生测地算法（ol/sphere）计算，
 * 结果以业务对象形式经 MapEngine 的 `measure` 事件上报，
 * UI 层不直接依赖任何地图库。
 */

/** 测量模式 */
export type MeasureMode = 'distance' | 'area'

/** 一次测量的结果 */
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
}
