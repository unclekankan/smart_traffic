import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Map3DEngine } from '../Map3DEngine'
import { createNearbyEntities, removeNearbyEntities } from '../entities/analysis'
import type { NearbyStopsResult } from '@/common/types/analysis'

function entityCollection() {
  const values: any[] = []
  return {
    values,
    add(options: any) {
      const entity = { ...options, show: true }
      values.push(entity)
      return entity
    },
    remove(entity: any) {
      const index = values.indexOf(entity)
      if (index >= 0) values.splice(index, 1)
      return index >= 0
    },
  }
}

function engineFixture() {
  const entities = entityCollection()
  const engine = Object.create(Map3DEngine.prototype) as Map3DEngine
  Object.assign(engine, {
    viewer: { entities },
    nearbyEntities: [],
  })
  return { engine, entities }
}

function nearbyResult(center: [number, number], radiusM: number, count: number): NearbyStopsResult {
  return {
    center,
    radiusM,
    truncated: false,
    stops: Array.from({ length: count }, (_, i) => ({
      kind: i % 2 === 0 ? ('metro' as const) : ('bus' as const),
      id: `${i}`,
      name: `Stop ${i}`,
      lon: center[0] + i * 0.0005,
      lat: center[1] + i * 0.0005,
      distanceM: (i + 1) * 10,
    })),
  }
}

const nearbyIds = (entities: ReturnType<typeof entityCollection>) =>
  entities.values.map((entity) => String(entity.id)).filter((id) => id.startsWith('nearby:'))

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('3D nearby entities', () => {
  it('creates radius circle, center point and stop markers from the query result', () => {
    const { engine, entities } = engineFixture()
    const metro = entities.add({ id: 'road:R1' })
    const result = nearbyResult([104.06, 30.67], 1000, 3)

    engine.renderNearbyStops(result)

    const ids = nearbyIds(entities)
    expect(ids).toHaveLength(6)
    expect(ids.slice(0, 3)).toEqual(['nearby:radius-fill', 'nearby:radius-outline', 'nearby:center'])
    // 站点标记保持后端的距离升序
    expect(ids.slice(3)).toEqual(['nearby:stop:metro:0', 'nearby:stop:bus:1', 'nearby:stop:metro:2'])

    const fill = entities.values.find((entity) => entity.id === 'nearby:radius-fill')
    const outline = entities.values.find((entity) => entity.id === 'nearby:radius-outline')
    const center = entities.values.find((entity) => entity.id === 'nearby:center')
    expect(fill.polygon).toBeDefined()
    expect(outline.polyline).toBeDefined()
    expect(center.point).toBeDefined()
    // 非附近分析的既有实体不受影响
    expect(entities.values).toContain(metro)
  })

  it('removes every nearby entity on null without touching other entities', () => {
    const { engine, entities } = engineFixture()
    const metro = entities.add({ id: 'station:S1' })
    engine.renderNearbyStops(nearbyResult([104.06, 30.67], 1000, 2))
    expect(nearbyIds(entities)).not.toHaveLength(0)

    engine.renderNearbyStops(null)

    expect(nearbyIds(entities)).toHaveLength(0)
    expect(entities.values).toEqual([metro])
  })

  it('replaces a previous render without residue when results change', () => {
    const { engine, entities } = engineFixture()
    engine.renderNearbyStops(nearbyResult([104.06, 30.67], 1000, 2))
    engine.renderNearbyStops(nearbyResult([104.2, 30.8], 500, 1))

    const ids = nearbyIds(entities)
    expect(ids).toHaveLength(4)
    expect(ids).toContain('nearby:stop:metro:0')
    expect(ids).not.toContain('nearby:stop:bus:1')
  })

  it('renders and clears 1000 stops without leaking entities (performance sanity)', () => {
    const { engine, entities } = engineFixture()
    const result = nearbyResult([104.06, 30.67], 2000, 1000)

    const start = performance.now()
    engine.renderNearbyStops(result)
    engine.renderNearbyStops(null)
    engine.renderNearbyStops(result)
    const elapsed = performance.now() - start

    expect(nearbyIds(entities)).toHaveLength(1003)
    expect(elapsed).toBeLessThan(1000)

    engine.renderNearbyStops(null)
    expect(nearbyIds(entities)).toHaveLength(0)
  })

  it('createNearbyEntities / removeNearbyEntities are symmetric', () => {
    const entities = entityCollection()
    const created = createNearbyEntities(entities as any, nearbyResult([104.06, 30.67], 800, 4))
    expect(created).toHaveLength(7)
    removeNearbyEntities(entities as any)
    expect(entities.values).toHaveLength(0)
  })
})

describe('3D nearby pick interaction', () => {
  it('emits pickPoint instead of selecting when pick mode is active', () => {
    const { engine } = engineFixture()
    let clickHandler!: (event: any) => void
    const viewer: any = {
      screenSpaceEventHandler: { removeInputAction: vi.fn() },
      scene: {
        canvas: document.createElement('canvas'),
        drillPick: vi.fn(() => []),
        pick: vi.fn(() => undefined),
      },
    }
    Object.assign(engine, {
      viewer,
      handler: {
        setInputAction: (handler: (event: any) => void) => { if (!clickHandler) clickHandler = handler },
      },
      busPickRequestGeneration: 0,
      routePickMode: false,
      pickPointMode: false,
      emit: vi.fn(),
      screenToLngLat: vi.fn(() => [104.06, 30.67]),
    })
    ;(engine as any).bindPicking(viewer)
    engine.setPickPointMode(true)

    clickHandler({ position: { x: 10, y: 10 } })

    expect(engine['emit']).toHaveBeenCalledWith('pickPoint', [104.06, 30.67])
    expect(engine['emit']).not.toHaveBeenCalledWith('select', expect.anything())
    expect(viewer.scene.drillPick).not.toHaveBeenCalled()

    // 关闭选点后恢复对象点选
    engine.setPickPointMode(false)
    ;(engine['emit'] as any).mockClear()
    clickHandler({ position: { x: 10, y: 10 } })
    expect(engine['emit']).toHaveBeenCalledWith('select', null)
  })

  it('clears nearby entities on destroy so no residue survives mode switches', () => {
    const entities = entityCollection()
    const engine = Object.create(Map3DEngine.prototype) as Map3DEngine
    Object.assign(engine, {
      viewer: {
        entities,
        destroy: vi.fn(),
        scene: { canvas: document.createElement('canvas') },
        screenSpaceEventHandler: { removeInputAction() {} },
        camera: { cancelFlight() {} },
      },
      handler: { destroy() {} },
      listeners: new Map(),
      selectedRoadId: null,
      contextRoadId: null,
      highlightedRoad: [],
      selectedStationEntities: [],
      basemapErrorRemovers: [],
      basemapFallbackQueue: [],
      basemapErrorCount: 0,
      busImageryLayers: {},
      basemapImageryLayers: [],
      clampCallback: null,
      pickPointMode: false,
      routePickMode: false,
      entityIndex: new Map(),
      selectedBusRouteId: null,
      busRouteRequestGeneration: 0,
      busPickRequestGeneration: 0,
      selectedBusEntities: [],
      selectedBusStopMarkers: [],
      selectedBusStopLabels: [],
      nearbyEntities: [],
    })

    engine.renderNearbyStops(nearbyResult([104.06, 30.67], 1000, 2))
    expect(nearbyIds(entities)).not.toHaveLength(0)

    engine.destroy()

    expect(nearbyIds(entities)).toHaveLength(0)
    expect((engine as unknown as { nearbyEntities: unknown[] }).nearbyEntities).toHaveLength(0)
  })
})
