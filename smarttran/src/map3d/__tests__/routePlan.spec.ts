import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Map3DEngine } from '../Map3DEngine'
import { createRoutePlanEntities, removeRoutePlanEntities } from '../entities/routePlan'
import type { TransitPlanResult } from '@/common/types/transit'

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

function routeResult(id: string): TransitPlanResult {
  return {
    origin: [104, 30], destination: [105, 31], city: '成都', strategy: 0,
    alternatives: [{
      id, totalDurationSec: 600, totalDistanceM: 5000, totalCost: null,
      transfers: 0, walkingDistanceM: 500, tags: [],
      segments: [{
        type: 'metro', lineId: 'L1', lineName: '地铁1号线', direction: '向南', matched: false,
        localLineId: null,
        departureStop: { id: 'A', name: '起点站', lng: 104, lat: 30, matched: false, localId: null },
        arrivalStop: { id: 'B', name: '终点站', lng: 105, lat: 31, matched: false, localId: null },
        stops: [{ id: 'A', name: '起点站', lng: 104, lat: 30, matched: false, localId: null }],
        polyline: [[104, 30], [104.5, 30.5], [105, 31]], durationSec: 600,
        distanceM: 5000, cost: null, transfer: null,
      }],
    }],
  }
}

const routeIds = (entities: ReturnType<typeof entityCollection>) =>
  entities.values.map((entity) => String(entity.id)).filter((id) => id.startsWith('transit-plan:'))

beforeEach(() => vi.restoreAllMocks())

describe('Cesium route plan entities', () => {
  it('renders selected route, alternatives, stop labels and endpoints in its own collection', () => {
    const entities = entityCollection()
    const businessEntity = entities.add({ id: 'road:R1' })
    const result = routeResult('route-1')

    const created = createRoutePlanEntities(entities as any, result, 'route-1', null, null)

    expect(created.map((entity) => entity.id)).toContain('transit-plan:route:route-1:0')
    expect(created.some((entity) => String(entity.label?.text) === '起点站')).toBe(true)
    expect(created.some((entity) => String(entity.label?.text) === '起')).toBe(true)
    expect(created.find((entity) => entity.id === 'transit-plan:route:route-1:0')?.polyline?.clampToGround).toBe(true)
    expect(entities.values).toContain(businessEntity)
  })

  it('removes only route entities and replaces the prior route render', () => {
    const entities = entityCollection()
    const businessEntity = entities.add({ id: 'station:S1' })
    createRoutePlanEntities(entities as any, routeResult('old'), 'old', null, null)
    createRoutePlanEntities(entities as any, routeResult('new'), 'new', null, null)

    expect(routeIds(entities).some((id) => id.includes(':old:'))).toBe(false)
    expect(routeIds(entities).some((id) => id.includes(':new:'))).toBe(true)
    removeRoutePlanEntities(entities as any)
    expect(routeIds(entities)).toHaveLength(0)
    expect(entities.values).toEqual([businessEntity])
  })

  it('clears the route renderer on engine destruction without touching unrelated entities', () => {
    const entities = entityCollection()
    const businessEntity = entities.add({ id: 'station:S1' })
    createRoutePlanEntities(entities as any, routeResult('route-1'), 'route-1', null, null)
    const engine = Object.create(Map3DEngine.prototype) as Map3DEngine
    Object.assign(engine, {
      viewer: {
        entities,
        destroy: vi.fn(),
        scene: { canvas: document.createElement('canvas') },
        screenSpaceEventHandler: { removeInputAction() {} },
        camera: { cancelFlight() {} },
      },
      handler: { destroy() {} }, listeners: new Map(), selectedRoadId: null, contextRoadId: null,
      highlightedRoad: [], selectedStationEntities: [], basemapErrorRemovers: [], basemapFallbackQueue: [],
      basemapErrorCount: 0, busImageryLayers: {}, basemapImageryLayers: [], clampCallback: null,
      pickPointMode: false, routePickMode: false, entityIndex: new Map(), selectedBusRouteId: null,
      busRouteRequestGeneration: 0, busPickRequestGeneration: 0, selectedBusEntities: [],
      selectedBusStopMarkers: [], selectedBusStopLabels: [], nearbyEntities: [], stationBufferEntities: [],
      coverageEntities: [], routePlanEntities: [], routePlanResult: routeResult('route-1'), routePlanSelectedId: 'route-1',
      measure3d: null,
    })

    engine.destroy()

    expect(routeIds(entities)).toHaveLength(0)
    expect(entities.values).toEqual([businessEntity])
  })
})
