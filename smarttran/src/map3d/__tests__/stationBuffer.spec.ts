import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Map3DEngine } from '../Map3DEngine'
import { createStationBufferEntities, removeStationBufferEntities } from '../entities/stationBuffer'
import type { StationBufferResult } from '@/common/types/analysis'

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
    stationBufferEntities: [],
  })
  return { engine, entities }
}

const RING = [[104.06, 30.66], [104.07, 30.66], [104.07, 30.67], [104.06, 30.67], [104.06, 30.66]]

function bufferResult(stopCount: number, lineCount: number): StationBufferResult {
  const stops = Array.from({ length: stopCount }, (_, i) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [104.06 + i * 0.0005, 30.66] as [number, number] },
    properties: { id: `S${i}`, name: `Stop ${i}` },
  }))
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: [[104.06, 30.66], [104.065, 30.665], [104.07, 30.67]] as Array<[number, number]>,
    },
    properties: { id: `L${i}`, name: `Line ${i}` },
  }))
  const collection = (features: unknown[]) => ({ type: 'FeatureCollection' as const, features })
  return {
    station: { kind: 'metro', id: 'S0', name: '天府广场' },
    radiusM: 800,
    buffer: collection([
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [RING] },
        properties: { id: 'S0', name: '天府广场' },
      },
    ]) as StationBufferResult['buffer'],
    metroStops: collection(stops) as StationBufferResult['metroStops'],
    busStops: collection(stops.slice(0, 1)) as StationBufferResult['busStops'],
    metroLines: collection(lines) as StationBufferResult['metroLines'],
    busLines: collection(lines.slice(0, 1)) as StationBufferResult['busLines'],
    counts: {
      metroStops: stopCount,
      busStops: Math.min(stopCount, 1),
      metroLines: lineCount,
      busLines: Math.min(lineCount, 1),
    },
  }
}

const bufferIds = (entities: ReturnType<typeof entityCollection>) =>
  entities.values.map((entity) => String(entity.id)).filter((id) => id.startsWith('station-buffer:'))

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('3D station buffer entities', () => {
  it('creates buffer area, outline, covered stops and lines', () => {
    const { engine, entities } = engineFixture()
    const existing = entities.add({ id: 'station:S1' })

    engine.renderStationBuffer(bufferResult(2, 1))

    const ids = bufferIds(entities)
    // 1 个缓冲面（填充 + 边界）+ 地铁站 2 + 公交站 1 + 地铁线 1 + 公交线 1
    expect(ids).toHaveLength(7)
    expect(ids.slice(0, 2)).toEqual(['station-buffer:area:0:0', 'station-buffer:outline:0:0'])
    expect(ids).toContain('station-buffer:stop:metro:S0:0')
    expect(ids).toContain('station-buffer:stop:bus:S0:0')
    expect(ids).toContain('station-buffer:line:metro:L0:0:0')
    expect(ids).toContain('station-buffer:line:bus:L0:0:0')

    const area = entities.values.find((entity) => entity.id === 'station-buffer:area:0:0')
    const outline = entities.values.find((entity) => entity.id === 'station-buffer:outline:0:0')
    expect(area.polygon).toBeDefined()
    expect(outline.polyline.clampToGround).toBe(true)
    // 业务实体不受影响
    expect(entities.values).toContain(existing)
  })

  it('removes every buffer entity on null without touching business entities', () => {
    const { engine, entities } = engineFixture()
    const existing = entities.add({ id: 'road:R1' })
    engine.renderStationBuffer(bufferResult(2, 1))
    expect(bufferIds(entities)).not.toHaveLength(0)

    engine.renderStationBuffer(null)

    expect(bufferIds(entities)).toHaveLength(0)
    expect(entities.values).toEqual([existing])
  })

  it('replaces a previous result without residue', () => {
    const { engine, entities } = engineFixture()
    engine.renderStationBuffer(bufferResult(3, 2))
    engine.renderStationBuffer(bufferResult(1, 0))

    const ids = bufferIds(entities)
    expect(ids).toHaveLength(4)
    expect(ids).toContain('station-buffer:stop:metro:S0:0')
    expect(ids).not.toContain('station-buffer:stop:metro:S2:2')
    expect(ids.some((id) => id.startsWith('station-buffer:line:'))).toBe(false)
  })

  it('clears buffer entities together with the engine instance', () => {
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
      stationBufferEntities: [],
    })

    engine.renderStationBuffer(bufferResult(2, 1))
    expect(bufferIds(entities)).not.toHaveLength(0)

    engine.destroy()

    expect(bufferIds(entities)).toHaveLength(0)
    expect((engine as unknown as { stationBufferEntities: unknown[] }).stationBufferEntities).toHaveLength(0)
  })

  it('renders 1000 covered stops within the 3D scene budget', () => {
    const { engine, entities } = engineFixture()
    const result = bufferResult(1000, 100)

    const start = performance.now()
    engine.renderStationBuffer(result)
    engine.renderStationBuffer(null)
    engine.renderStationBuffer(result)
    const elapsed = performance.now() - start

    expect(bufferIds(entities).length).toBeGreaterThan(1000)
    expect(elapsed).toBeLessThan(1500)

    engine.renderStationBuffer(null)
    expect(bufferIds(entities)).toHaveLength(0)
  })

  it('createStationBufferEntities / removeStationBufferEntities are symmetric', () => {
    const entities = entityCollection()
    const created = createStationBufferEntities(entities as any, bufferResult(2, 1))
    expect(created).toHaveLength(7)
    removeStationBufferEntities(entities as any)
    expect(entities.values).toHaveLength(0)
  })
})
