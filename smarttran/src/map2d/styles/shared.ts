/**
 * 2D 样式共享状态与工具
 *
 * 样式函数需要响应「选中」运行时状态。
 * 状态变更由引擎写入此处，并触发对应图层 changed() 重新求值，
 * 避免每次重建样式对象。
 */

import { PALETTE } from '@/common/constants/colors'

export const styleState = {
  /** 当前选中的要素 id（地铁线路 / 站点共用命名空间） */
  selectedId: null as string | null,
}

/** hex → rgba(alpha 0-1) */
export function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const MAP_FONT_STACK =
  "'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif"

/** 注记字号 / 颜色层级（原型：区域大字 → 道路小字） */
export const LABEL_TIERS = {
  lg: { font: `600 17px ${MAP_FONT_STACK}`, color: withAlpha(PALETTE.textSecondary, 0.75) },
  md: { font: `500 13px ${MAP_FONT_STACK}`, color: withAlpha(PALETTE.textSecondary, 0.8) },
  sm: { font: `400 11px ${MAP_FONT_STACK}`, color: withAlpha(PALETTE.textSecondary, 0.7) },
} as const
