import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { stationBuffer } = vi.hoisted(() => ({ stationBuffer: vi.fn() }))
vi.mock('@/common/services/analysis', () => ({ analysisApi: { stationBuffer } }))

import { useMapStore } from '../mapStore'
import type { StationBufferResult } from '@/common/types/analysis'

const STOP = { kind: 'metro' as const, id: 'S1', name: '天府广场' }

function bufferResult(name: string, radiusM: number): StationBufferResult {
  const empty = { type: 'FeatureCollection' as const, features: [] }
  return {
    station: { kind: 'metro', id: 'S1', name },
    radiusM,
    buffer: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[104.06, 30.66], [104.07, 30.66], [104.07, 30.67], [104.06, 30.66]]],
          },
          properties: { id: 'S1', name },
        },
      ],
    },
    metroStops: empty,
    busStops: empty,
    metroLines: empty,
    busLines: empty,
    counts: { metroStops: 0, busStops: 0, metroLines: 0, busLines: 0 },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  stationBuffer.mockReset()
})

describe('station buffer state isolation between 2D and 3D', () => {
  it('keeps 2D buffer state out of 3D and restores it when switching back', async () => {
    const store = useMapStore()
    const result2D = bufferResult('天府广场', 800)
    stationBuffer.mockResolvedValue(result2D)

    store.setStationBufferRadius(800)
    await store.runStationBuffer(STOP)
    expect(stationBuffer).toHaveBeenCalledWith('metro', 'S1', 800)
    expect(store.stationBufferResult).toEqual(result2D)
    expect(store.stationBufferRadius).toBe(800)

    // 切到 3D：半径参数 / 结果 / 加载态均为 3D 自己的初始值
    store.setMode('3d')
    expect(store.stationBufferRadius).toBe(500)
    expect(store.stationBufferResult).toBeNull()
    expect(store.stationBufferLoading).toBe(false)
    expect(store.stationBufferError).toBeNull()

    // 切回 2D：完整恢复 2D 的分析结果与参数
    store.setMode('2d')
    expect(store.stationBufferRadius).toBe(800)
    expect(store.stationBufferResult).toEqual(result2D)
  })

  it('runs an independent 3D analysis with its own radius without polluting 2D', async () => {
    const store = useMapStore()
    const result2D = bufferResult('天府广场', 800)
    stationBuffer.mockResolvedValue(result2D)
    store.setStationBufferRadius(800)
    await store.runStationBuffer(STOP)

    store.setMode('3d')
    const result3D = bufferResult('春熙路', 300)
    stationBuffer.mockResolvedValue(result3D)
    store.setStationBufferRadius(300)
    await store.runStationBuffer({ kind: 'metro', id: 'S2', name: '春熙路' })

    expect(stationBuffer).toHaveBeenLastCalledWith('metro', 'S2', 300)
    expect(store.stationBufferResult).toEqual(result3D)
    expect(store.stationBufferRadius).toBe(300)

    // 2D 切片不受 3D 分析影响
    store.setMode('2d')
    expect(store.stationBufferResult).toEqual(result2D)
    expect(store.stationBufferRadius).toBe(800)
  })

  it('writes an in-flight response back to the mode that issued the request', async () => {
    const store = useMapStore()
    let resolveRequest!: (value: StationBufferResult) => void
    stationBuffer.mockReturnValue(new Promise<StationBufferResult>((resolve) => { resolveRequest = resolve }))

    const pending = store.runStationBuffer(STOP)
    expect(store.stationBufferLoading).toBe(true)

    // 请求在途期间切到 3D：3D 不进入加载态，响应也不会写入 3D
    store.setMode('3d')
    expect(store.stationBufferLoading).toBe(false)
    const result2D = bufferResult('天府广场', 500)
    resolveRequest(result2D)
    await pending

    expect(store.stationBufferResult).toBeNull()
    store.setMode('2d')
    expect(store.stationBufferResult).toEqual(result2D)
    expect(store.stationBufferLoading).toBe(false)
  })

  it('ignores a stale response when the same mode issues a newer analysis', async () => {
    const store = useMapStore()
    let resolveFirst!: (value: StationBufferResult) => void
    const stale = bufferResult('旧结果', 500)
    const fresh = bufferResult('新结果', 500)
    stationBuffer
      .mockReturnValueOnce(new Promise<StationBufferResult>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(fresh)

    const first = store.runStationBuffer(STOP)
    await store.runStationBuffer({ kind: 'metro', id: 'S2', name: '春熙路' })
    resolveFirst(stale)
    await first

    expect(store.stationBufferResult).toEqual(fresh)
    expect(store.stationBufferLoading).toBe(false)
  })

  it('clears only the current mode and discards its in-flight response', async () => {
    const store = useMapStore()
    const result2D = bufferResult('天府广场', 500)
    stationBuffer.mockResolvedValue(result2D)
    await store.runStationBuffer(STOP)

    store.setMode('3d')
    let resolveLate!: (value: StationBufferResult) => void
    stationBuffer.mockReturnValue(new Promise<StationBufferResult>((resolve) => { resolveLate = resolve }))
    const pending = store.runStationBuffer({ kind: 'metro', id: 'S2', name: '春熙路' })
    store.clearStationBuffer()
    expect(store.stationBufferLoading).toBe(false)
    resolveLate(bufferResult('春熙路', 500))
    await pending
    expect(store.stationBufferResult).toBeNull()

    // 2D 结果不受 3D 清除影响
    store.setMode('2d')
    expect(store.stationBufferResult).toEqual(result2D)
  })

  it('surfaces analysis errors in the issuing mode only', async () => {
    const store = useMapStore()
    stationBuffer.mockRejectedValue(new Error('service unavailable'))
    await store.runStationBuffer(STOP)
    expect(store.stationBufferError).toBe('service unavailable')
    expect(store.stationBufferResult).toBeNull()

    store.setMode('3d')
    expect(store.stationBufferError).toBeNull()
  })
})
