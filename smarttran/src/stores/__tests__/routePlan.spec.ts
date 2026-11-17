import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { plan } = vi.hoisted(() => ({ plan: vi.fn() }))
vi.mock('@/common/services/transit', () => ({ transitApi: { plan }, TransitApiError: class TransitApiError extends Error {} }))

import { useMapStore } from '../mapStore'
import type { TransitPlanResult } from '@/common/types/transit'

function result(id: string): TransitPlanResult {
  return {
    origin: [104, 30], destination: [105, 31], city: '成都', strategy: 0,
    alternatives: [{
      id, totalDurationSec: 600, totalDistanceM: 5000, totalCost: null,
      transfers: 0, walkingDistanceM: 500, tags: [], segments: [],
    }],
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  plan.mockReset()
})

describe('route planning state isolation between 2D and 3D', () => {
  it('keeps endpoints, strategy, selection and results independent across mode switches', async () => {
    const store = useMapStore()
    store.routeByMode['2d'].origin = [104, 30]
    store.routeByMode['2d'].destination = [105, 31]
    store.setRouteStrategy(4)
    plan.mockResolvedValueOnce(result('2d-plan'))
    await store.loadRoutePlan(store.mode)

    store.setMode('3d')
    expect(store.routeOrigin).toBeNull()
    expect(store.routeDestination).toBeNull()
    expect(store.routePlanResult).toBeNull()
    store.routeByMode['3d'].origin = [106, 32]
    store.routeByMode['3d'].destination = [107, 33]
    plan.mockResolvedValueOnce(result('3d-plan'))
    await store.loadRoutePlan(store.mode)
    store.selectRouteAlternative('3d-plan')

    store.setMode('2d')
    expect(store.routeOrigin).toEqual([104, 30])
    expect(store.routeStrategy).toBe(4)
    expect(store.routePlanResult?.alternatives[0]?.id).toBe('2d-plan')

    store.setMode('3d')
    expect(store.routeOrigin).toEqual([106, 32])
    expect(store.routePlanResult?.alternatives[0]?.id).toBe('3d-plan')
    expect(store.routeSelectedId).toBe('3d-plan')
  })

  it('writes each in-flight planning response only to its issuing mode', async () => {
    const store = useMapStore()
    let resolve2D!: (value: TransitPlanResult) => void
    store.routeByMode['2d'].origin = [104, 30]
    store.routeByMode['2d'].destination = [105, 31]
    plan.mockReturnValueOnce(new Promise<TransitPlanResult>((resolve) => { resolve2D = resolve }))
    const pending2D = store.loadRoutePlan('2d')

    store.setMode('3d')
    store.routeByMode['3d'].origin = [106, 32]
    store.routeByMode['3d'].destination = [107, 33]
    plan.mockResolvedValueOnce(result('3d-plan'))
    await store.loadRoutePlan(store.mode)
    resolve2D(result('2d-plan'))
    await pending2D

    expect(store.routePlanResult?.alternatives[0]?.id).toBe('3d-plan')
    store.setMode('2d')
    expect(store.routePlanResult?.alternatives[0]?.id).toBe('2d-plan')
  })

  it('ignores a delayed map pick from a mode that is no longer active', async () => {
    const store = useMapStore()
    store.startRoutePick('origin')
    store.setMode('3d')
    store.startRoutePick('destination')
    await store.pickRoutePoint([104, 30], '2d')
    expect(store.routeByMode['2d'].origin).toEqual([104, 30])
    expect(store.routeByMode['3d'].destination).toBeNull()
    expect(store.routePickTarget).toBe('destination')
  })
})
