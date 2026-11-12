import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  store: null as any,
  engines: [] as any[],
  delay2DInit: false,
  resolve2DInit: null as null | (() => void),
}))

vi.mock('@/stores/mapStore', () => ({ useMapStore: () => harness.store }))
vi.mock('@/map2d', () => ({ Map2DEngine: class MockMap2DEngine {
  readonly mode = '2d'
  calls: Array<[string, ...unknown[]]> = []
  listeners = new Map<string, (value: any) => void>()
  constructor() { harness.engines.push(this) }
  async init() {
    this.calls.push(['init'])
    if (harness.delay2DInit) {
      await new Promise<void>((resolve) => { harness.resolve2DInit = resolve })
    }
  }
  destroy() { this.calls.push(['destroy']) }
  on(name: string, callback: (value: any) => void) { this.listeners.set(name, callback) }
  setBaseMap(...args: unknown[]) { this.calls.push(['setBaseMap', ...args]) }
  setNetworkMode(...args: unknown[]) { this.calls.push(['setNetworkMode', ...args]) }
  setLayerVisible(...args: unknown[]) { this.calls.push(['setLayerVisible', ...args]) }
  setContextRoad(...args: unknown[]) { this.calls.push(['setContextRoad', ...args]) }
  setSelected(...args: unknown[]) { this.calls.push(['setSelected', ...args]) }
  setMeasureMode(...args: unknown[]) { this.calls.push(['setMeasureMode', ...args]) }
  renderMeasureAnnotations(...args: unknown[]) { this.calls.push(['renderMeasureAnnotations', ...args]) }
  setMeasureEditing(...args: unknown[]) { this.calls.push(['setMeasureEditing', ...args]) }
  clearMeasure(...args: unknown[]) { this.calls.push(['clearMeasure', ...args]) }
  setPickPointMode(...args: unknown[]) { this.calls.push(['setPickPointMode', ...args]) }
  setRoutePickMode(...args: unknown[]) { this.calls.push(['setRoutePickMode', ...args]) }
  renderRoutePlan(...args: unknown[]) { this.calls.push(['renderRoutePlan', ...args]) }
  renderNearbyStops(...args: unknown[]) { this.calls.push(['renderNearbyStops', ...args]) }
  renderStationBuffer(...args: unknown[]) { this.calls.push(['renderStationBuffer', ...args]) }
  renderCoverage(...args: unknown[]) { this.calls.push(['renderCoverage', ...args]) }
  selectBusRoute(...args: unknown[]) { this.calls.push(['selectBusRoute', ...args]) }
  setBusRouteStopsVisible(...args: unknown[]) { this.calls.push(['setBusRouteStopsVisible', ...args]) }
  setBusRouteNamesVisible(...args: unknown[]) { this.calls.push(['setBusRouteNamesVisible', ...args]) }
  applyCameraState(...args: unknown[]) { this.calls.push(['applyCameraState', ...args]) }
  getCameraState() { return {} }
} }))
vi.mock('@/map3d', () => ({ Map3DEngine: class MockMap3DEngine {
  readonly mode = '3d'
  calls: Array<[string, ...unknown[]]> = []
  listeners = new Map<string, (value: any) => void>()
  constructor() { harness.engines.push(this) }
  async init() { this.calls.push(['init']) }
  destroy() { this.calls.push(['destroy']) }
  on(name: string, callback: (value: any) => void) { this.listeners.set(name, callback) }
  setBaseMap(...args: unknown[]) { this.calls.push(['setBaseMap', ...args]) }
  setBaseMapWithFallback(...args: unknown[]) { this.calls.push(['setBaseMapWithFallback', ...args]) }
  setNetworkMode(...args: unknown[]) { this.calls.push(['setNetworkMode', ...args]) }
  setLayerVisible(...args: unknown[]) { this.calls.push(['setLayerVisible', ...args]) }
  setContextRoad(...args: unknown[]) { this.calls.push(['setContextRoad', ...args]) }
  setSelected(...args: unknown[]) { this.calls.push(['setSelected', ...args]) }
  setMeasureMode(...args: unknown[]) { this.calls.push(['setMeasureMode', ...args]) }
  renderMeasureAnnotations(...args: unknown[]) { this.calls.push(['renderMeasureAnnotations', ...args]) }
  setMeasureEditing(...args: unknown[]) { this.calls.push(['setMeasureEditing', ...args]) }
  clearMeasure(...args: unknown[]) { this.calls.push(['clearMeasure', ...args]) }
  setPickPointMode(...args: unknown[]) { this.calls.push(['setPickPointMode', ...args]) }
  setRoutePickMode(...args: unknown[]) { this.calls.push(['setRoutePickMode', ...args]) }
  renderRoutePlan(...args: unknown[]) { this.calls.push(['renderRoutePlan', ...args]) }
  renderNearbyStops(...args: unknown[]) { this.calls.push(['renderNearbyStops', ...args]) }
  renderStationBuffer(...args: unknown[]) { this.calls.push(['renderStationBuffer', ...args]) }
  renderCoverage(...args: unknown[]) { this.calls.push(['renderCoverage', ...args]) }
  selectBusRoute(...args: unknown[]) { this.calls.push(['selectBusRoute', ...args]) }
  setBusRouteStopsVisible(...args: unknown[]) { this.calls.push(['setBusRouteStopsVisible', ...args]) }
  setBusRouteNamesVisible(...args: unknown[]) { this.calls.push(['setBusRouteNamesVisible', ...args]) }
  applyCameraState(...args: unknown[]) { this.calls.push(['applyCameraState', ...args]) }
  getCameraState() { return {} }
} }))

import MapContainer from '../map/MapContainer.vue'

const flushWatchers = async () => {
  await Promise.resolve()
  await flushPromises()
}

beforeEach(() => {
  harness.engines = []
  harness.delay2DInit = false
  harness.resolve2DInit = null
  harness.store = reactive({
    mode: '2d',
    selected: { kind: 'road', id: 'R1', name: 'Line 1' },
    selectedByMode: {
      '2d': { kind: 'road', id: 'R2', name: 'Line 2' },
      '3d': { kind: 'road', id: 'R3', name: 'Line 3' },
    },
    contextMetroRoute: { kind: 'road', id: 'R0', name: 'Line 0' },
    networkMode: 'metro',
    layerVisibility: {},
    measureMode: 'none',
    measureAnnotations: [],
    selectedMeasureId: null,
    measureEditingId: null,
    nearbyPickMode: false,
    routePickTarget: null,
    routePlanResult: null,
    routeSelectedId: null,
    routeOrigin: null,
    routeDestination: null,
    nearbyResult: null,
    stationBufferResult: null,
    coverageOpacity: 1,
    selectedBusRoute: null,
    busRouteStopsVisible: false,
    busRouteNamesVisible: false,
    lastCamera: { '2d': null, '3d': null },
    baseMapId: 'default',
    brightness: 100,
    resetSeq: 0,
    focusSeq: 0,
    focusPointSeq: 0,
    stationReturnSeq: 0,
    stationReturnCamera: null,
    measureClearSeq: 0,
    focusPoint: null,
    setBaseMap: vi.fn(),
    selectForMode: vi.fn((mode, selection) => {
      harness.store.selectedByMode[mode] = selection
      harness.store.selected = selection
    }),
    select: vi.fn((selection) => { harness.store.selected = selection }),
    setPointer: vi.fn(),
    setStationReturnCamera: vi.fn(),
    setMeasureDraft: vi.fn(),
    addMeasureAnnotation: vi.fn(),
    updateMeasureAnnotation: vi.fn(),
    pickNearbyCenter: vi.fn(),
    pickRoutePoint: vi.fn(),
    saveCamera: vi.fn(),
    setStationReturnCameraClear: vi.fn(),
  })
})

describe('MapContainer selection bridge', () => {
  it('keeps each view selection isolated across repeated mode switches', async () => {
    const wrapper = mount(MapContainer, { attachTo: document.body })
    await flushWatchers()
    const engine2D = harness.engines[0]

    expect(engine2D.calls).toContainEqual(['setContextRoad', harness.store.contextMetroRoute])
    expect(engine2D.calls).toContainEqual(['setSelected', harness.store.selectedByMode['2d']])

    const selection2D = { kind: 'road', id: 'R20', name: 'Line 20' }
    engine2D.listeners.get('select')?.(selection2D)
    expect(harness.store.selectForMode).toHaveBeenCalledWith('2d', selection2D)
    expect(harness.store.selectedByMode['3d']).toEqual({ kind: 'road', id: 'R3', name: 'Line 3' })

    harness.store.mode = '3d'
    harness.store.selected = harness.store.selectedByMode['3d']
    await flushWatchers()
    const engine3D = harness.engines[1]
    expect(engine3D.calls).toContainEqual(['setSelected', harness.store.selectedByMode['3d']])
    expect(engine3D.calls).not.toContainEqual(['setSelected', selection2D])

    const selection3D = { kind: 'road', id: 'R30', name: 'Line 30' }
    engine3D.listeners.get('select')?.(selection3D)
    expect(harness.store.selectForMode).toHaveBeenCalledWith('3d', selection3D)
    expect(harness.store.selectedByMode['2d']).toEqual(selection2D)

    harness.store.mode = '2d'
    await flushWatchers()
    const restored2D = harness.engines[2]
    expect(restored2D.calls).toContainEqual(['setSelected', selection2D])
    expect(restored2D.calls).toContainEqual(['setContextRoad', harness.store.contextMetroRoute])

    harness.store.mode = '3d'
    await flushWatchers()
    const restored3D = harness.engines[3]
    expect(restored3D.calls).toContainEqual(['setSelected', selection3D])
    expect(restored3D.calls).not.toContainEqual(['setSelected', selection2D])

    wrapper.unmount()
  })

  it('destroys a late engine initialization instead of allowing it to replace the active mode', async () => {
    harness.delay2DInit = true
    const wrapper = mount(MapContainer, { attachTo: document.body })
    await flushWatchers()
    const oldEngine = harness.engines[0]
    harness.store.mode = '3d'
    await flushWatchers()
    const currentEngine = harness.engines[1]

    harness.resolve2DInit?.()
    await flushWatchers()

    expect(oldEngine.calls).toContainEqual(['destroy'])
    expect(currentEngine.calls).toContainEqual(['setSelected', harness.store.selectedByMode['3d']])
    wrapper.unmount()
  })

  it('propagates layer visibility changes to the active engine in both modes', async () => {
    harness.store.layerVisibility = {
      roads: true, stations: true, stationLabels: true, models3d: true,
      busRoutes: true, busStops: true, busStopNames: true,
    }
    const wrapper = mount(MapContainer, { attachTo: document.body })
    await flushWatchers()
    const engine2D = harness.engines[0]

    harness.store.layerVisibility.roads = false
    await flushWatchers()
    expect(engine2D.calls).toContainEqual(['setLayerVisible', 'roads', false])

    harness.store.mode = '3d'
    await flushWatchers()
    const engine3D = harness.engines[1]
    harness.store.layerVisibility.stations = false
    await flushWatchers()
    expect(engine3D.calls).toContainEqual(['setLayerVisible', 'stations', false])
    expect(engine2D.calls).not.toContainEqual(['setLayerVisible', 'stations', false])
    wrapper.unmount()
  })

  it('replays only the active mode nearby state to a freshly mounted engine', async () => {
    const wrapper = mount(MapContainer, { attachTo: document.body })
    await flushWatchers()
    const engine2D = harness.engines[0]
    expect(engine2D.calls).toContainEqual(['setPickPointMode', false])
    expect(engine2D.calls).toContainEqual(['renderNearbyStops', null])

    // 2D 查询完成后，store 暴露 2D 的附近状态并同步给 2D 引擎
    const result2D = { center: [104.06, 30.67], radiusM: 1000, stops: [], truncated: false }
    harness.store.nearbyResult = result2D
    harness.store.nearbyPickMode = true
    await flushWatchers()
    expect(engine2D.calls).toContainEqual(['renderNearbyStops', result2D])
    expect(engine2D.calls).toContainEqual(['setPickPointMode', true])

    // 切到 3D：store 暴露 3D 自己的（空）附近状态，3D 引擎不回放 2D 结果
    harness.store.mode = '3d'
    harness.store.nearbyResult = null
    harness.store.nearbyPickMode = false
    await flushWatchers()
    const engine3D = harness.engines[1]
    expect(engine3D.calls).toContainEqual(['renderNearbyStops', null])
    expect(engine3D.calls).toContainEqual(['setPickPointMode', false])
    expect(engine3D.calls).not.toContainEqual(['renderNearbyStops', result2D])

    // 3D 内的查询结果只发给 3D 引擎，已销毁的 2D 引擎不再接收
    const result3D = { center: [104.1, 30.7], radiusM: 500, stops: [], truncated: false }
    harness.store.nearbyResult = result3D
    await flushWatchers()
    expect(engine3D.calls).toContainEqual(['renderNearbyStops', result3D])
    expect(engine2D.calls).not.toContainEqual(['renderNearbyStops', result3D])
    wrapper.unmount()
  })

  it('replays only the active mode station buffer result to a freshly mounted engine', async () => {
    const wrapper = mount(MapContainer, { attachTo: document.body })
    await flushWatchers()
    const engine2D = harness.engines[0]
    expect(engine2D.calls).toContainEqual(['renderStationBuffer', null])

    // 2D 分析结果只同步给 2D 引擎
    const result2D = { station: { kind: 'metro', id: 'S1', name: '天府广场' }, radiusM: 800 }
    harness.store.stationBufferResult = result2D
    await flushWatchers()
    expect(engine2D.calls).toContainEqual(['renderStationBuffer', result2D])

    // 切到 3D：回放 3D 自己的空结果，不携带 2D 缓冲面
    harness.store.mode = '3d'
    harness.store.stationBufferResult = null
    await flushWatchers()
    const engine3D = harness.engines[1]
    expect(engine3D.calls).toContainEqual(['renderStationBuffer', null])
    expect(engine3D.calls).not.toContainEqual(['renderStationBuffer', result2D])

    // 3D 内的分析结果只发给 3D 引擎，已销毁的 2D 引擎不再接收
    const result3D = { station: { kind: 'metro', id: 'S2', name: '春熙路' }, radiusM: 300 }
    harness.store.stationBufferResult = result3D
    await flushWatchers()
    expect(engine3D.calls).toContainEqual(['renderStationBuffer', result3D])
    expect(engine2D.calls).not.toContainEqual(['renderStationBuffer', result3D])
    wrapper.unmount()
  })

  it('replays only the active mode measurement state and clears on mode switch', async () => {
    const wrapper = mount(MapContainer, { attachTo: document.body })
    await flushWatchers()
    const engine2D = harness.engines[0]
    // 初始回放：工具关闭、无标注、无编辑
    expect(engine2D.calls).toContainEqual(['setMeasureMode', null])
    expect(engine2D.calls).toContainEqual(['renderMeasureAnnotations', [], null])
    expect(engine2D.calls).toContainEqual(['setMeasureEditing', null])

    // 2D 引擎的测量事件带 mode 写回 store
    const draft = { mode: 'distance', value: 120, segments: [120], perimeter: 0, vertexCount: 2, points: [] }
    engine2D.listeners.get('measure')?.(draft)
    expect(harness.store.setMeasureDraft).toHaveBeenCalledWith('2d', draft)

    harness.store.measureMode = 'distance'
    await flushWatchers()
    expect(engine2D.calls).toContainEqual(['setMeasureMode', 'distance'])

    const annotation = {
      id: 'm-1', label: '测距 1', visible: true,
      mode: 'distance', value: 120, segments: [120], perimeter: 0, vertexCount: 2,
      points: [[104.06, 30.66], [104.07, 30.67]],
    }
    engine2D.listeners.get('measureComplete')?.(annotation)
    expect(harness.store.addMeasureAnnotation).toHaveBeenCalledWith('2d', annotation)
    engine2D.listeners.get('measureUpdate')?.(annotation)
    expect(harness.store.updateMeasureAnnotation).toHaveBeenCalledWith('2d', annotation)

    // 标注更新驱动当前引擎重绘
    harness.store.measureAnnotations = [annotation]
    harness.store.selectedMeasureId = 'm-1'
    await flushWatchers()
    expect(engine2D.calls).toContainEqual(['renderMeasureAnnotations', [annotation], 'm-1'])

    // 切到 3D：新引擎拿到 3D 自己的空测量状态，不携带 2D 标注
    harness.store.mode = '3d'
    harness.store.measureMode = 'none'
    harness.store.measureAnnotations = []
    harness.store.selectedMeasureId = null
    await flushWatchers()
    const engine3D = harness.engines[1]
    expect(engine3D.calls).toContainEqual(['setMeasureMode', null])
    expect(engine3D.calls).toContainEqual(['renderMeasureAnnotations', [], null])
    expect(engine3D.calls).not.toContainEqual(['renderMeasureAnnotations', [annotation], 'm-1'])

    // 清除测量序号变化只作用于当前引擎
    harness.store.measureClearSeq += 1
    await flushWatchers()
    expect(engine3D.calls).toContainEqual(['clearMeasure'])
    expect(engine2D.calls).not.toContainEqual(['clearMeasure'])
    wrapper.unmount()
  })
})
