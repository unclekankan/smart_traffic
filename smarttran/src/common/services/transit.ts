/**
 * 公共交通路线规划接口封装
 *
 * 对应后端 FastAPI 路由 app/routers/transit.py：
 *  GET /api/transit/plan  起终点 WGS84 → 标准化规划结果
 */

import { request } from './http'
import type { LngLat } from '@/common/types/geo'
import type { TransitPlanResult } from '@/common/types/transit'

interface ApiEnvelope<T> {
  code: number
  message: string
  data: T | null
}

/** 规划失败（携带后端业务码，便于区分「无可用方案」与真正异常） */
export class TransitApiError extends Error {
  readonly code: number

  constructor(message: string, code: number) {
    super(message)
    this.name = 'TransitApiError'
    this.code = code
  }
}

export interface TransitPlanParams {
  origin: LngLat
  destination: LngLat
  city?: string
  strategy?: number
  maxAlternatives?: number
}

function coordParam(point: LngLat): string {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`
}

export const transitApi = {
  async plan(params: TransitPlanParams): Promise<TransitPlanResult> {
    const city = params.city ?? '028'
    const strategy = params.strategy ?? 0
    const maxAlternatives = params.maxAlternatives ?? 3
    const query = [
      `origin=${coordParam(params.origin)}`,
      `destination=${coordParam(params.destination)}`,
      `city=${city}`,
      `strategy=${strategy}`,
      `max_alternatives=${maxAlternatives}`,
    ].join('&')

    const body = await request<ApiEnvelope<TransitPlanResult>>(`/api/transit/plan?${query}`)
    if (body.code !== 0 || !body.data) {
      throw new TransitApiError(body.message || '路线规划失败', body.code)
    }
    return body.data
  },
}
