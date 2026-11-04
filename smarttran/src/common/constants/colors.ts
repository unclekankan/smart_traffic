/**
 * 平台设计令牌 —— 颜色语义
 *
 * 与原型规范《UI 状态与交互说明》保持一致：
 * - 青色：交互 / 选中状态
 * - 深色衬底：地图底面与线路描边
 *
 * 该文件是地图渲染引擎（map2d / map3d）与 UI 组件共用的唯一颜色来源，
 * 修改颜色语义时只需调整此处。
 */

/** 平台基础色板 */
export const PALETTE = {
  /** 页面 / 场景底色 */
  bgDeep: '#0A101C',
  /** 地图底面（街区填充） */
  block: '#0F1828',
  /** 街区描边 */
  blockStroke: '#182741',
  /** 水系 */
  water: '#153350',
  /** 绿地 */
  park: '#13291F',
  /** 线路暗色描边（衬底） */
  roadCasing: '#0B1220',
  /** 交互 / 选中（青色） */
  accent: '#35C8E8',
  /** 交互高亮辅助（浅青） */
  accentLight: '#7FE6F7',
  /** 主文本 */
  textPrimary: '#E8F1FB',
  /** 次要文本 */
  textSecondary: '#8AA0BE',
  /** 弱化文本 */
  textMuted: '#5A7192',
} as const

/**
 * 缓冲区覆盖热力色带（按覆盖层数 1 → 5+ 由浅到深）
 *
 * 与参考的热力覆盖图一致：稀疏区域为浅冰蓝，覆盖层数越多颜色越暖越深，
 * 色带内部无描边，相邻色块连成一片。
 */
export const COVERAGE_RAMP = [
  { fill: '#9FD8F0', stroke: '#9FD8F0' }, // 1 层：浅冰蓝
  { fill: '#79CF9A', stroke: '#79CF9A' }, // 2 层：浅绿
  { fill: '#F3E36B', stroke: '#F3E36B' }, // 3 层：浅黄
  { fill: '#F5A83D', stroke: '#F5A83D' }, // 4 层：橙色
  { fill: '#E2491F', stroke: '#E2491F' }, // 5 层及以上：深红
] as const
