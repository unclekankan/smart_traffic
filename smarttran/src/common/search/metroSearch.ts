/**
 * 地铁对象模糊搜索
 *
 * 数据来自 metroRepository 的内存索引（338 座车站 / 42 条线路），
 * 纯同步计算，输入即搜，不产生额外网络请求。
 *
 * 匹配规则（命中分值由高到低）：
 *  - 完全相等 100
 *  - 前缀匹配 80
 *  - 包含匹配 60
 *  - 数字查询（如「1」「1号线」）额外加权 90，优先命中 1 号线
 *  - 车站的途经线路命中时降权 10，保证同名线路排在其车站之前
 */

import { allRouteFeatures, allStopFeatures } from '@/common/data/metroRepository'

export type SearchKind = 'station' | 'road'

export interface SearchHit {
  kind: SearchKind
  /** 站点为 stop_id，线路为线路主键 id */
  id: string
  name: string
  /** 次要说明文本（区县 / 起终点） */
  meta: string
  /** 车站途经线路（已归一化），线路结果为空数组 */
  lines: string[]
  score: number
}

/** 默认返回上限，避免下拉面板过长 */
const MAX_HITS = 40

function matchScore(text: string | null | undefined, query: string): number {
  if (!text) return 0
  const value = text.toLowerCase()
  if (value === query) return 100
  if (value.startsWith(query)) return 80
  if (value.includes(query)) return 60
  return 0
}

/** 从线路名中取线路编号，如「地铁18号线临江段」→ 18 */
function routeNumber(name: string): string | undefined {
  return /(\d+)/.exec(name)?.[1]
}

/**
 * 模糊搜索车站与线路。
 * @param keyword 用户输入
 * @param limit 返回条数上限
 */
export function searchMetro(keyword: string, limit = MAX_HITS): SearchHit[] {
  const query = keyword.trim().toLowerCase()
  if (!query) return []

  const digits = query.replace(/[^\d]/g, '')
  const hits: SearchHit[] = []

  /* ---------------- 线路 ---------------- */
  for (const feature of allRouteFeatures().features) {
    const p = feature.properties
    let score = Math.max(matchScore(p.route_cn, query), matchScore(p.route_en, query))

    // 「1」「1号线」这类数字检索优先命中对应线路
    const number = routeNumber(p.route_cn)
    if (number && digits === number && query.length <= 6) {
      score = Math.max(score, 90)
    }
    if (score <= 0) continue

    hits.push({
      kind: 'road',
      id: String(p.id),
      name: p.route_cn,
      meta: `${p.s_stop_cn ?? '—'} ↔ ${p.e_stop_cn ?? '—'} · ${p.total_stop ?? '—'} 站`,
      lines: [],
      score,
    })
  }

  /* ---------------- 车站 ---------------- */
  for (const feature of allStopFeatures().features) {
    const p = feature.properties
    let score = Math.max(
      matchScore(p.stop_cn, query),
      matchScore(p.stop_en, query),
      matchScore(p.stop_id, query),
      matchScore(p.district, query),
    )

    // 途经线路命中：搜「1号线」时返回该线全部车站
    for (const line of p.lines) {
      const lineScore = matchScore(line.name, query)
      if (lineScore > 0) score = Math.max(score, lineScore - 10)
    }
    if (score <= 0) continue

    hits.push({
      kind: 'station',
      id: p.stop_id,
      name: p.stop_cn,
      meta: `${p.district ?? '市域外'} · ${p.line_count} 条线路`,
      lines: p.lines.map((line) => line.name),
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
