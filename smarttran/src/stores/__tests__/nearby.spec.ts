import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { nearbyStops } = vi.hoisted(() => ({ nearbyStops: vi.fn() }))
vi.mock('@/common/services/analysis', () => ({ analysisApi: { nearbyStops } }))

import { useMapStore } from '../mapStore'
import type { NearbyStopsResult } from '@/common/types/analysis'

function nearbyResult(center: [number, number], radiusM: number, count = 2): NearbyStopsResult {
  return {
    center,
    radiusM,
    truncated: false,
    stops: Array.from({ length: count }, (_, i) => ({
      kind: i % 2 === 0 ? ('metro' as const) : ('bus' as const),
      id: `${i}`,
      name: `Stop ${i}`,
      lon: center[0] + i * 0.001,
      lat: center[1] + i * 0.001,
      distanceM: (i + 1) * 10,
    })),
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  nearbyStops.mockReset()
})

describe('nearby query state isolation between 2D and 3D', () => {
  it('keeps 2D query state out of 3D and restores it when switching back', async () => {
    const store = useMapStore()
    const result2D = nearbyResult([104.06, 30.67], 2000, 3)
    nearbyStops.mockResolvedValue(result2D)

    store.setNearbyRadius(2000)
    await store.pickNearbyCenter([104.06, 30.67])
    expect(store.nearbyResult).toEqual(result2D)
    expect(nearbyStops).toHaveBeenCalledWith(104.06, 30.67, 2000)

    // 切到 3D：查询参数 / 结果缓存 / 选点状态均为初始值，不携带 2D 数据
    store.setMode('3d')
    expect(store.nearbyRadius).toBe(1000)
    expect(store.nearbyCenter).toBeNull()
    expect(store.nearbyResult).toBeNull()
    expect(store.nearbyPickMode).toBe(false)
    expect(store.nearbyLoading).toBe(false)
    expect(store.nearbyError).toBeNull()

    // 切回 2D：完整恢复 2D 自己的查询状态
    store.setMode('2d')
    expect(store.nearbyRadius).toBe(2000)
    expect(store.nearbyCenter).toEqual(result2D.center)
    expect(store.nearbyResult).toEqual(result2D)
  })

  it('runs an independent 3D query without polluting 2D state', async () => {
    const store = useMapStore()
    const result2D = nearbyResult([104.06, 30.67], 2000)
    nearbyStops.mockResolvedValue(result2D)
    store.setNearbyRadius(2000)
    await store.pickNearbyCenter([104.06, 30.67])

    store.setMode('3d')
    const result3D = nearbyResult([104.1, 30.7], 500)
    nearbyStops.mockResolvedValue(result3D)
    store.setNearbyRadius(500)
    store.startNearbyPick()
    expect(store.nearbyPickMode).toBe(true)
    await store.pickNearbyCenter([104.1, 30.7])

    expect(nearbyStops).toHaveBeenLastCalledWith(104.1, 30.7, 500)
    expect(store.nearbyResult).toEqual(result3D)
    expect(store.nearbyRadius).toBe(500)
    expect(store.nearbyPickMode).toBe(false)

    // 2D 切片不受 3D 查询影响
    store.setMode('2d')
    expect(store.nearbyResult).toEqual(result2D)
    expect(store.nearbyRadius).toBe(2000)
  })

  it('writes an in-flight response back to the mode that issued the request', async () => {
    const store = useMapStore()
    let resolveRequest!: (value: NearbyStopsResult) => void
    nearbyStops.mockReturnValue(new Promise<NearbyStopsResult>((resolve) => { resolveRequest = resolve }))

    const pending = store.pickNearbyCenter([104.06, 30.67])
    expect(store.nearbyLoading).toBe(true)

    // 请求在途期间切到 3D：3D 不进入加载态，响应也不会写入 3D
    store.setMode('3d')
    expect(store.nearbyLoading).toBe(false)
    const result2D = nearbyResult([104.06, 30.67], 1000)
    resolveRequest(result2D)
    await pending
    expect(store.nearbyResult).toBeNull()

    store.setMode('2d')
    expect(store.nearbyResult).toEqual(result2D)
    expect(store.nearbyLoading).toBe(false)
  })

  it('ignores a stale response when the same mode issues a newer query', async () => {
    const store = useMapStore()
    let resolveFirst!: (value: NearbyStopsResult) => void
    const stale = nearbyResult([104.06, 30.67], 1000)
    const fresh = nearbyResult([104.2, 30.8], 1000)
    nearbyStops
      .mockReturnValueOnce(new Promise<NearbyStopsResult>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(fresh)

    const first = store.pickNearbyCenter([104.06, 30.67])
    await store.pickNearbyCenter([104.2, 30.8])
    resolveFirst(stale)
    await first

    expect(store.nearbyResult).toEqual(fresh)
    expect(store.nearbyCenter).toEqual(fresh.center)
    expect(store.nearbyLoading).toBe(false)
  })

  it('clears only the current mode and discards its in-flight response', async () => {
    const store = useMapStore()
    const result2D = nearbyResult([104.06, 30.67], 1000)
    nearbyStops.mockResolvedValue(result2D)
    await store.pickNearbyCenter([104.06, 30.67])
    store.setMode('3d')
    const result3D = nearbyResult([104.1, 30.7], 1000)
    nearbyStops.mockResolvedValue(result3D)
    await store.pickNearbyCenter([104.1, 30.7])

    // 3D 清除后重新发起一个在途请求，清除操作应作废其响应
    let resolveLate!: (value: NearbyStopsResult) => void
    nearbyStops.mockReturnValue(new Promise<NearbyStopsResult>((resolve) => { resolveLate = resolve }))
    const pending = store.pickNearbyCenter([104.2, 30.8])
    store.clearNearby()
    expect(store.nearbyLoading).toBe(false)
    resolveLate(nearbyResult([104.2, 30.8], 1000))
    await pending
    expect(store.nearbyResult).toBeNull()
    expect(store.nearbyCenter).toBeNull()

    // 2D 结果不受 3D 清除影响
    store.setMode('2d')
    expect(store.nearbyResult).toEqual(result2D)
  })

  it('keeps pick mode independent per mode and mutually exclusive with route pick', () => {
    const store = useMapStore()
    store.setRailView('analysis')
    store.startNearbyPick()
    expect(store.nearbyPickMode).toBe(true)

    // 切到 3D：2D 的选点状态不跟随，3D 默认关闭
    store.setMode('3d')
    expect(store.nearbyPickMode).toBe(false)
    // 切回 2D：恢复 2D 自己的选点状态
    store.setMode('2d')
    expect(store.nearbyPickMode).toBe(true)

    // 路线规划选点与附近选点在当前模式内互斥
    store.startRoutePick('origin')
    expect(store.nearbyPickMode).toBe(false)
    expect(store.routePickTarget).toBe('origin')
  })

  it('focuses a nearby stop into the current mode selection only', () => {
    const store = useMapStore()
    store.setMode('3d')
    const stop = {
      kind: 'metro' as const,
      id: 'S1',
      name: '天府广场',
      lon: 104.06,
      lat: 30.67,
      distanceM: 120,
    }
    store.focusNearbyStop(stop)

    expect(store.selectedByMode['3d']).toEqual({ kind: 'station', id: 'S1', name: '天府广场' })
    expect(store.selected).toEqual({ kind: 'station', id: 'S1', name: '天府广场' })
    expect(store.selectedByMode['2d']).toBeNull()
    expect(store.focusPoint).toEqual([104.06, 30.67])
    expect(store.focusPointSeq).toBe(1)
  })

  it('surfaces query errors in the issuing mode only', async () => {
    const store = useMapStore()
    nearbyStops.mockRejectedValue(new Error('service unavailable'))
    await store.pickNearbyCenter([104.06, 30.67])
    expect(store.nearbyError).toBe('service unavailable')
    expect(store.nearbyResult).toBeNull()

    store.setMode('3d')
    expect(store.nearbyError).toBeNull()
  })
})
