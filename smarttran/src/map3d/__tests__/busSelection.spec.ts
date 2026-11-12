import { beforeEach, describe, expect, it, vi } from 'vitest'

const { screenSpaceEventType, busClickHandler } = vi.hoisted(() => ({
  screenSpaceEventType: { LEFT_CLICK: 'LEFT_CLICK', MOUSE_MOVE: 'MOUSE_MOVE' },
  busClickHandler: { current: null as ((event: any) => void) | null },
}))

vi.mock('cesium', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cesium')>()
  return {
    ...actual,
    ScreenSpaceEventType: screenSpaceEventType,
    ScreenSpaceEventHandler: class {
      setInputAction(callback: (event: any) => void, type: string) {
        if (type === screenSpaceEventType.LEFT_CLICK) busClickHandler.current = callback
      }
    },
  }
})

const { getRouteDetail, pickRoute } = vi.hoisted(() => ({ getRouteDetail: vi.fn(), pickRoute: vi.fn() }))
vi.mock('@/common/data/busRepository', () => ({ getRouteDetail }))
vi.mock('@/common/services/bus', () => ({ busApi: { pickRoute } }))

import * as Cesium from 'cesium'
import { Map3DEngine } from '../Map3DEngine'
import { createBusRouteEntities, removeBusRouteEntities } from '../entities/roads'
import { DEFAULT_LAYER_VISIBILITY } from '@/common/constants/layers'

const routeFeature = (id: number, geometry: any = {
  type: 'MultiLineString',
  coordinates: [[[104.06, 30.67], [104.07, 30.68]], [[104.08, 30.69], [104.09, 30.70]]],
}) => ({
  type: 'Feature' as const,
  geometry,
  properties: { id, route_cn: `Bus ${id}` },
})

const routeStops = (coordinates: [number, number][], idPrefix = 'S') => ({
  type: 'FeatureCollection' as const,
  features: coordinates.map(([lon, lat], index) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [lon, lat] as [number, number] },
    properties: { frac: index / coordinates.length, stop_cn: `Stop ${index}`, stop_id: `${idPrefix}${index}` },
  })),
})

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
  const imageryLayers: any[] = []
  const imageryCollection = {
    get length() { return imageryLayers.length },
    add(layer: any, index?: number) {
      if (index === undefined) imageryLayers.push(layer)
      else imageryLayers.splice(index, 0, layer)
      return layer
    },
    remove(layer: any) {
      const index = imageryLayers.indexOf(layer)
      if (index >= 0) imageryLayers.splice(index, 1)
      return index >= 0
    },
    get(index: number) { return imageryLayers[index] },
    values: imageryLayers,
    removeAll() { imageryLayers.splice(0) },
  }
  const engine = Object.create(Map3DEngine.prototype) as Map3DEngine
  Object.assign(engine, {
    viewer: { entities, imageryLayers: imageryCollection },
    selectedBusRouteId: null,
    busRouteRequestGeneration: 0,
    selectedBusEntities: [],
    selectedBusStopMarkers: [],
    selectedBusStopLabels: [],
    busRouteStopsVisible: true,
    busRouteNamesVisible: true,
    busPickRequestGeneration: 0,
    networkMode: 'metro',
    roadsVisible: true,
    layerVisibility: { ...DEFAULT_LAYER_VISIBILITY },
    busImageryLayers: {},
    basemapImageryLayers: [],
    basemapErrorRemovers: [],
  })
  return { engine, entities, imageryCollection }
}

beforeEach(() => {
  getRouteDetail.mockReset()
  pickRoute.mockReset()
})

describe('3D bus WMS network visibility', () => {
  it('switches between metro entities and independently toggled bus WMS layers', () => {
    const { engine, entities } = engineFixture()
    const metroRoad = entities.add({ id: 'road:M1', polyline: {} })
    const metroStation = entities.add({ id: 'station:S1', point: {} })
    const metroLabel = entities.add({ id: 'station:S1:label', label: {} })
    const model = entities.add({ id: 'station:S2:model', model: {} })
    const layers = {
      busRoutes: { show: false },
      busStops: { show: false },
      busStopNames: { show: false },
    }
    Object.assign(engine, { busImageryLayers: layers })

    engine.setNetworkMode('bus')
    expect([metroRoad.show, metroStation.show, metroLabel.show, model.show]).toEqual([false, false, false, false])
    expect(Object.values(layers).map((layer) => layer.show)).toEqual([true, true, true])

    engine.setLayerVisible('busStops', false)
    engine.setBusRouteNamesVisible(false)
    engine.setNetworkMode('metro')
    expect([metroRoad.show, metroStation.show, metroLabel.show, model.show]).toEqual([true, true, true, true])
    expect(Object.values(layers).map((layer) => layer.show)).toEqual([false, false, false])

    engine.setNetworkMode('bus')
    // popup 的站点/名称开关只管选中线路矢量叠加层，不再影响全量 WMS
    expect(Object.values(layers).map((layer) => layer.show)).toEqual([true, false, true])
  })

  it('keeps bus imagery when replacing only the basemap layers', () => {
    const { engine, imageryCollection } = engineFixture()
    const busLayer = { show: true }
    const oldBasemap = { show: true }
    Object.assign(engine, { busImageryLayers: { busRoutes: busLayer }, basemapImageryLayers: [oldBasemap] })
    imageryCollection.add(oldBasemap)
    imageryCollection.add(busLayer)
    Object.assign(engine, {
      detachBasemapErrorListeners() {},
    })

    ;(engine as any).swapImageryLayers('osm')

    expect(imageryCollection.values).toContain(busLayer)
    expect(imageryCollection.values).not.toContain(oldBasemap)
  })
})

describe('3D bus WMS picking', () => {
  it('uses coordinates to select a bus route only for unpicked bus-mode clicks', async () => {
    const { engine } = engineFixture()
    let clickHandler!: (event: any) => void
    const viewer: any = {
      entities: engine['viewer']!.entities,
      imageryLayers: engine['viewer']!.imageryLayers,
      canvas: { clientHeight: 800 },
      camera: { positionCartographic: { height: 1200 }, pickEllipsoid: vi.fn(() => ({})) },
      screenSpaceEventHandler: { removeInputAction: vi.fn() },
      scene: {
        canvas: { clientWidth: 800, clientHeight: 800 },
        globe: { ellipsoid: { cartesianToCartographic: () => ({ longitude: 1.82, latitude: 0.54 }) } },
        drillPick: vi.fn(() => []),
        pick: vi.fn(() => undefined),
        screenSpaceCameraController: { enableInputs: true }
      },
    }
    Object.assign(engine, {
      viewer,
      handler: { setInputAction: (handler: (event: any) => void) => { if (!clickHandler) clickHandler = handler } },
      networkMode: 'bus',
      layerVisibility: { ...DEFAULT_LAYER_VISIBILITY, busRoutes: true },
      emit: vi.fn(),
      screenToLngLat: vi.fn(() => [104.06, 30.67]),
    })
    ;(engine as any).bindPicking(viewer)
    pickRoute.mockResolvedValueOnce({ id: 19, route_cn: 'Route 19' })
    getRouteDetail.mockResolvedValueOnce({ route: routeFeature(19), stops: routeStops([]) })
    clickHandler({ position: { x: 2, y: 3 } })
    await vi.waitFor(() => expect(pickRoute).toHaveBeenCalledWith(104.06, 30.67, expect.any(Number)))
    await vi.waitFor(() => expect(engine['emit']).toHaveBeenCalledWith('select', { kind: 'busRoute', id: '19', name: 'Route 19' }))

    viewer.scene.drillPick.mockReturnValueOnce([{ id: { id: 'station:S1' } }])
    vi.clearAllMocks()
    clickHandler({ position: { x: 2, y: 3 } })
    expect(pickRoute).not.toHaveBeenCalled()
  })

  it('ignores stale lookup responses after a later click', async () => {
    const { engine } = engineFixture()
    let resolveFirst!: (value: any) => void
    pickRoute.mockImplementation((lon: number) => lon === 104
      ? new Promise((resolve) => { resolveFirst = resolve })
      : Promise.resolve(null))
    Object.assign(engine, { busPickRequestGeneration: 3, networkMode: 'bus', emit: vi.fn() })
    const first = (engine as any).pickBusRouteAt([104, 30], 50, 2)
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'))
    const second = (engine as any).pickBusRouteAt([104.1, 30.1], 50, 3)
    await second
    resolveFirst({ id: 1, route_cn: 'Old' })
    await first
    expect(engine['emit']).toHaveBeenCalledTimes(1)
    expect(engine['emit']).toHaveBeenCalledWith('select', null)
  })
})

describe('selected 3D bus route tube', () => {
  it('creates independent tube segments and removes only bus entities', () => {
    const entities = entityCollection()
    const metro = entities.add({ id: 'road:R1' })
    const created = createBusRouteEntities(entities as any, routeFeature(12) as any)

    expect(created).toHaveLength(2)
    expect(created.every((entity) => entity.polylineVolume)).toBe(true)
    removeBusRouteEntities(entities as any)
    expect(entities.values).toEqual([metro])
  })

  it('ignores null and unsupported geometries', () => {
    const entities = entityCollection()
    expect(createBusRouteEntities(entities as any, routeFeature(1, null) as any)).toEqual([])
    expect(createBusRouteEntities(entities as any, routeFeature(2, {
      type: 'Point', coordinates: [104, 30],
    }) as any)).toEqual([])
    expect(entities.values).toHaveLength(0)
  })

  it('loads the selected route and applies network/layer visibility', async () => {
    const { engine, entities } = engineFixture()
    const flyTo = vi.fn()
    getRouteDetail.mockResolvedValue({
      route: routeFeature(7),
      stops: routeStops([[104.01, 30.61], [104.02, 30.62], [104.03, 30.63]]),
    })
    Object.assign(engine, {
      viewer: {
        ...engine['viewer'],
        camera: { flyTo },
      },
    })
    engine.setNetworkMode('bus')

    await engine.selectBusRoute(7)
    const flyArgs = flyTo.mock.calls[0]![0]
    const destination = Cesium.Cartographic.fromCartesian(flyArgs.destination)
    expect(destination.longitude * 180 / Math.PI).toBeCloseTo(104.02, 5)
    expect(destination.latitude * 180 / Math.PI).toBeCloseTo(30.62, 5)
    expect(flyArgs.duration).toBe(0.6)
    // 2 tube segments + 3 stop markers + 3 name labels
    expect(entities.values).toHaveLength(8)
    expect(entities.values.every((entity) => entity.show)).toBe(true)

    const markers = () => entities.values.filter((entity) => String(entity.id).startsWith('bus-stop:'))
    const labels = () => entities.values.filter((entity) => String(entity.id).startsWith('bus-stop-label:'))
    expect(markers()).toHaveLength(3)
    expect(labels()).toHaveLength(3)

    engine.setBusRouteStopsVisible(false)
    expect(markers().every((entity) => !entity.show)).toBe(true)
    expect(labels().every((entity) => entity.show)).toBe(true)
    engine.setBusRouteStopsVisible(true)
    engine.setBusRouteNamesVisible(false)
    expect(markers().every((entity) => entity.show)).toBe(true)
    expect(labels().every((entity) => !entity.show)).toBe(true)
    engine.setBusRouteNamesVisible(true)

    engine.setNetworkMode('metro')
    expect(entities.values.every((entity) => !entity.show)).toBe(true)
    engine.setNetworkMode('bus')
    engine.setLayerVisible('busRoutes', false)
    expect(entities.values.every((entity) => !entity.show)).toBe(true)
    engine.setLayerVisible('busRoutes', true)
    expect(entities.values.every((entity) => entity.show)).toBe(true)
    engine.setLayerVisible('roads', false)
    expect(entities.values.every((entity) => !entity.show)).toBe(true)
    engine.setLayerVisible('roads', true)
    expect(entities.values.every((entity) => entity.show)).toBe(true)

    await engine.selectBusRoute(null)
    expect(entities.values).toHaveLength(0)
  })

  it('does not create a stale route when an earlier request resolves late', async () => {
    const { engine, entities } = engineFixture()
    let resolveFirst!: (detail: any) => void
    getRouteDetail.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ route: routeFeature(2) })

    const first = engine.selectBusRoute(1)
    await engine.selectBusRoute(2)
    resolveFirst({ route: routeFeature(1) })
    await first

    expect(entities.values).toHaveLength(2)
    expect(entities.values.every((entity) => String(entity.id).includes(':2:'))).toBe(true)
  })

  it('removes the selected overlay synchronously when selection is cancelled', async () => {
    const { engine, entities } = engineFixture()
    getRouteDetail.mockResolvedValue({
      route: routeFeature(7),
      stops: routeStops([[104.01, 30.61], [104.02, 30.62]]),
    })
    await engine.selectBusRoute(7)
    const selectedPrefixes = (entity: any) => ['bus-route:', 'bus-stop:', 'bus-stop-label:']
      .some((prefix) => String(entity.id).startsWith(prefix))
    expect(entities.values.some(selectedPrefixes)).toBe(true)

    engine.selectBusRoute(null)

    expect(entities.values.some(selectedPrefixes)).toBe(false)
  })

  it('leaves no residual overlay when switching between routes', async () => {
    const { engine, entities } = engineFixture()
    getRouteDetail
      .mockResolvedValueOnce({ route: routeFeature(1), stops: routeStops([[104.01, 30.61]], 'A') })
      .mockResolvedValueOnce({ route: routeFeature(2), stops: routeStops([[104.05, 30.65]], 'B') })

    await engine.selectBusRoute(1)
    await engine.selectBusRoute(2)

    const ids = entities.values.map((entity) => String(entity.id))
    expect(ids.some((id) => id.startsWith('bus-route:1:') || id.startsWith('bus-stop:A'))).toBe(false)
    expect(ids.filter((id) => id.startsWith('bus-route:2:'))).toHaveLength(2)
    expect(ids.filter((id) => id.startsWith('bus-stop:B') || id.startsWith('bus-stop-label:B'))).toHaveLength(2)
  })

  it('ignores a response after selection is cleared', async () => {
    const { engine, entities } = engineFixture()
    let resolveRoute!: (detail: any) => void
    getRouteDetail.mockImplementationOnce(() => new Promise((resolve) => { resolveRoute = resolve }))

    const loading = engine.selectBusRoute(9)
    await Promise.resolve()
    await engine.selectBusRoute(null)
    resolveRoute({ route: routeFeature(9) })
    await loading
    expect(entities.values).toHaveLength(0)
  })
})
