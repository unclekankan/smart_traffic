/**
 * 公交线路模糊搜索（与地铁搜索共用顶部同一个输入框）
 *
 * 数据来自 busRepository 的内存列表（3048 条轻量线路，无几何），
 * 纯同步计算，输入即搜，不产生额外网络请求。
 *
 * 匹配规则与 metroSearch 对齐：
 *  - 完全相等 100
 *  - 前缀匹配 80
 *  - 包含匹配 60
 *  - 起终点站命中时降权 10，保证站名匹配不会压过线路名匹配
 */

import { allRouteSummaries } from '@/common/data/busRepository'

export interface BusSearchHit {
  kind: 'busRoute'
  /** 线路主键 id（字符串，便于与地铁命中项统一结构） */
  id: string
  name: string
  /** 次要说明：起终点站 + 站数 */
  meta: string
  score: number
}

const MAX_HITS = 30

function matchScore(text: string | null | undefined, query: string): number {
  if (!text) return 0
  const value = text.toLowerCase()
  if (value === query) return 100
  if (value.startsWith(query)) return 80
  if (value.includes(query)) return 60
  return 0
}

/** 模糊搜索公交线路（线路名 / 起终点站） */
export function searchBus(keyword: string, limit = MAX_HITS): BusSearchHit[] {
  const query = keyword.trim().toLowerCase()
  if (!query) return []

  const hits: BusSearchHit[] = []
  for (const r of allRouteSummaries()) {
    const score = Math.max(
      matchScore(r.route_cn, query),
      matchScore(r.s_stop_cn, query) - 10,
      matchScore(r.e_stop_cn, query) - 10,
    )
    if (score <= 0) continue
    hits.push({
      kind: 'busRoute',
      id: String(r.id),
      name: r.route_cn,
      meta: `${r.s_stop_cn ?? '—'} ↔ ${r.e_stop_cn ?? '—'} · ${r.total_stop ?? '—'} 站`,
      score,
    })
  }

  return hits
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name, 'zh-CN'),
    )
    .slice(0, limit)
}
