import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from '../mapStore'

vi.mock('@/common/data/metroRepository', () => ({
  getRoute: (id: string) => id === '1' ? { id: 1, name: '地铁1号线' } : undefined,
}))
import type { MetroSimulationState } from '@/common/types/simulation'

beforeEach(() => setActivePinia(createPinia()))

function state(session: number, routeId: string): MetroSimulationState {
  return {
    session,
    phase: 'running',
    routeId,
    routeName: '测试线路',
    tilesEnabled: false,
    otherRoutesVisible: false,
    speedMultiplier: 1,
    model: { phase: 'ready', progress: 1, error: null },
    tilesStatus: 'idle',
    error: null,
  }
}

describe('3D metro simulation store', () => {
  it('starts only in 3D metro mode with a valid route and does not start on selection', () => {
    const store = useMapStore()
    const route = '1'
    store.setCurrentSelection({ kind: 'road', id: route, name: '测试线路' })
    expect(store.simulation3d.phase).toBe('idle')
    expect(store.startMetroSimulation(route, '测试线路')).toBeNull()

    store.setMode('3d')
    expect(store.startMetroSimulation('missing-route', '无效线路')).toBeNull()
    const session = store.startMetroSimulation(route, '测试线路')
    expect(session).toBe(1)
    expect(store.simulation3d.phase).toBe('preparing')
  })

  it('rejects stale state and invalidates the session when leaving 3D or switching to bus', () => {
    const store = useMapStore()
    store.setMode('3d')
    const session = store.startMetroSimulation('1', '测试线路')
    expect(session).not.toBeNull()
    store.applyMetroSimulationState(session!, state(session!, '1'))
    expect(store.simulation3d.phase).toBe('running')
    store.stopMetroSimulation()
    store.applyMetroSimulationState(session!, state(session!, '1'))
    expect(store.simulation3d.phase).toBe('idle')

    const next = store.startMetroSimulation('1', '测试线路')!
    store.setNetworkMode('bus')
    expect(store.simulation3d.phase).toBe('idle')
    expect(store.simulation3d.session).toBeGreaterThan(next)
    store.applyMetroSimulationState(next, state(next, '1'))
    expect(store.simulation3d.phase).toBe('idle')
  })

  it('tracks pause and option actions for the active session', () => {
    const store = useMapStore()
    store.setMode('3d')
    const session = store.startMetroSimulation('1', '测试线路')!
    store.applyMetroSimulationState(session, state(session, '1'))
    store.setMetroSimulationPaused(true)
    store.setMetroSimulationTilesEnabled(true)
    store.setMetroSimulationOtherRoutesVisible(true)
    store.setMetroSimulationSpeedMultiplier(2.5)
    expect(store.simulation3d.phase).toBe('paused')
    expect(store.simulation3d.tilesEnabled).toBe(true)
    expect(store.simulation3d.otherRoutesVisible).toBe(true)
    expect(store.simulation3d.speedMultiplier).toBe(2.5)
    store.setMetroSimulationSpeedMultiplier(8)
    expect(store.simulation3d.speedMultiplier).toBe(4)
    store.setMetroSimulationSpeedMultiplier(0)
    expect(store.simulation3d.speedMultiplier).toBe(0.25)
    store.setMetroSimulationPaused(false)
    expect(store.simulation3d.phase).toBe('running')
  })
})
