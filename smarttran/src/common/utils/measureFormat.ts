/**
 * 测量数值格式化
 *
 * 地图浮层（MeasureController）与测量面板（MeasurePanel）共用，
 * 保证同一结果在两处展示口径一致。
 */

/** 距离：不足 1 km 用米，否则用千米 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—'
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`
}

/** 面积：不足 1 km² 用平方米，否则用平方千米 */
export function formatArea(squareMeters: number): string {
  if (!Number.isFinite(squareMeters)) return '—'
  return squareMeters >= 1_000_000
    ? `${(squareMeters / 1_000_000).toFixed(2)} km²`
    : `${squareMeters.toFixed(0)} m²`
}
