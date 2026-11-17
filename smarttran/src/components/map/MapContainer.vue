<script setup lang="ts">
/**
 * 地图容器组件
 *
 * 职责：
 * - 挂载 / 卸载当前模式的 MapEngine 实例
 * - 桥接引擎事件 → Pinia store（select / pointer）
 * - 响应 store 状态变更 → 引擎指令（图层可见、选中、缓冲区、底图）
 *
 * 业务组件与 store 不直接持有引擎实例，保持「业务层零引擎知识」。
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { Map2DEngine } from '@/map2d'
import { Map3DEngine } from '@/map3d'
import { DEFAULT_3D_BASEMAP_FALLBACK, DEFAULT_3D_BASEMAP_ID } from '@/map3d/config/basemaps'
import type { MapEngine, MetroSimulationEngine } from '@/common/types/engine'
import type { MapMode } from '@/common/types/engine'
import type { MetroSimulationState } from '@/common/types/simulation'
import { getRoutePath } from '@/common/data/metroRepository'
import { LAYER_IDS } from '@/common/constants/layers'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()
const containerRef = ref<HTMLDivElement>()
const ready = ref(false)
const createEngine = (mode: MapMode): MapEngine => mode === '2d'
  ? new Map2DEngine()
  : new Map3DEngine((id) => store.setBaseMap(id))

let engine: MapEngine | null = null
let engineGeneration = 0
let simulationUnsubscribe: (() => void) | null = null
let lastSimulationStart = 0

function simulationEngine(target: MapEngine | null): (MapEngine & MetroSimulationEngine) | null {
  if (!target || target.mode !== '3d') return null
  const candidate = target as MapEngine & MetroSimulationEngine
  return typeof candidate.startMetroSimulation === 'function' ? candidate : null
}

function bindSimulationState(target: MapEngine, generation: number): void {
  simulationUnsubscribe?.()
  simulationUnsubscribe = simulationEngine(target)?.onMetroSimulationStateChange?.((state) => {
    if (engineGeneration !== generation || engine !== target || target.mode !== '3d') return
    store.applyMetroSimulationState(lastSimulationStart, { ...state, session: lastSimulationStart })
  }) ?? null
}

async function startSimulation(target: MapEngine, generation: number, session: number, routeId: string, routeName: string): Promise<void> {
  const simEngine = simulationEngine(target)
  if (!simEngine?.startMetroSimulation || generation !== engineGeneration || target !== engine) return
  lastSimulationStart = session
  const initial: MetroSimulationState = { ...store.simulation3d, phase: 'preparing' }
  store.applyMetroSimulationState(session, initial)
  simEngine.setMetroSimulationTilesEnabled?.(store.simulation3d.tilesEnabled)
  try {
    const path = getRoutePath(routeId)
    if (!path?.length) throw new Error(`未找到线路 ${routeId} 的有效几何`)
    await simEngine.startMetroSimulation(routeId, routeName, path)
    if (generation === engineGeneration && target === engine && store.simulation3d.session === session) {
      simEngine.setMetroSimulationOtherRoutesVisible?.(false)
    }
  } catch (error) {
    store.applyMetroSimulationState(session, {
      ...store.simulation3d,
      phase: 'error',
      error: error instanceof Error ? error.message : '线路模拟启动失败',
    })
  }
}

async function mountEngine(mode: MapMode): Promise<void> {
  const el = containerRef.value
  if (!el) return
  ready.value = false
  const generation = ++engineGeneration
  simulationUnsubscribe?.()
  simulationUnsubscribe = null
  engine?.destroy()
  engine = null

  const next = createEngine(mode)
  await next.init(el)
  if (generation !== engineGeneration) {
    next.destroy()
    return
  }
  engine = next
  if (mode === '3d') {
    ;(next as Map3DEngine).setBaseMapWithFallback(
      DEFAULT_3D_BASEMAP_ID,
      DEFAULT_3D_BASEMAP_FALLBACK,
    )
  } else {
    next.setBaseMap(store.baseMapId)
  }

  // 回放当前 store 状态到新引擎
  next.setNetworkMode(store.networkMode)
  for (const id of LAYER_IDS) next.setLayerVisible(id, store.layerVisibility[id])
  next.setContextRoad?.(store.contextMetroRoute)
  next.setSelected(store.selectedByMode[mode])
  next.setMeasureMode(store.measureMode === 'none' ? null : store.measureMode)
  // 回放当前模式的测量标注（切换模式时已清空，不会携带另一模式的图形）
  next.renderMeasureAnnotations?.(store.measureAnnotations, store.selectedMeasureId)
  next.setMeasureEditing?.(store.measureEditingId)
  // 回放空间分析叠加层
  next.setPickPointMode?.(store.nearbyPickMode)
  const route = store.routeByMode[mode]
  next.setRoutePickMode?.(route.pickTarget !== null)
  next.renderRoutePlan?.(route.result, route.selectedId, route.origin, route.destination)
  next.renderNearbyStops?.(store.nearbyResult)
  next.renderStationBuffer?.(store.stationBufferResult)
  next.renderCoverage?.(store.coverageResult, store.coverageOpacity)
  // 选中公交路线叠加层（异步，不阻塞 mount）
  void next.selectBusRoute?.(store.selectedBusRoute)
  next.setBusRouteStopsVisible?.(store.busRouteStopsVisible)
  next.setBusRouteNamesVisible?.(store.busRouteNamesVisible)

  const saved = store.lastCamera[mode]
  if (saved) next.applyCameraState(saved)

  bindEvents(next)
  bindSimulationState(next, generation)
  ready.value = true
}

function bindEvents(e: MapEngine): void {
  e.on('select', (sel) => {
    if (sel?.kind === 'station' && store.selected?.kind === 'road' && store.networkMode === 'metro') {
      store.setStationReturnCamera(e.getCameraState())
    }
    store.selectForMode(e.mode, sel)
  })
  e.on('pointer', (p) => store.setPointer(p))
  e.on('measure', (result) => store.setMeasureDraft(e.mode, result))
  e.on('measureComplete', (annotation) => store.addMeasureAnnotation(e.mode, annotation))
  e.on('measureUpdate', (annotation) => store.updateMeasureAnnotation(e.mode, annotation))
  // 附近站点查询：地图选点 → 以该点为中心查询
  e.on('pickPoint', (point) => void store.pickNearbyCenter(point))
  // 路线规划：地图选点 → 起点 / 终点坐标
  e.on('routePickPoint', ({ point, mode }) => void store.pickRoutePoint(point, mode))
}

/* ---------------- 监听 store → 引擎 ---------------- */

watch(
  () => store.mode,
  async (mode, prev) => {
    if (engine && prev) store.saveCamera(prev, engine.getCameraState())
    if (mode !== '3d') {
      simulationEngine(engine)?.stopMetroSimulation?.()
      store.stopMetroSimulation?.()
    }
    await mountEngine(mode)
  },
)

watch(
  () => ({ ...store.layerVisibility }),
  (visibility) => {
    for (const id of LAYER_IDS) engine?.setLayerVisible(id, visibility[id])
  },
  { deep: true },
)

watch(
  () => store.networkMode,
  (mode) => {
    engine?.setNetworkMode(mode)
    if (mode === 'bus') {
      simulationEngine(engine)?.stopMetroSimulation?.()
      store.stopMetroSimulation?.()
    }
  },
)

watch(
  () => store.selectedByMode[store.mode],
  (sel) => engine?.setSelected(sel),
)

watch(
  () => store.contextMetroRoute,
  (route) => engine?.setContextRoad?.(route),
)

watch(
  () => store.stationReturnSeq,
  async () => {
    const camera = store.stationReturnCamera
    if (!camera) return
    engine?.setSelected(store.selectedByMode[store.mode])
    await Promise.resolve()
    engine?.applyCameraState(camera)
    store.setStationReturnCamera(null)
  },
)

watch(
  () => store.selectedBusRoute,
  (id) => void engine?.selectBusRoute?.(id),
)

watch(
  () => store.busRouteStopsVisible,
  (v) => engine?.setBusRouteStopsVisible?.(v),
)

watch(
  () => store.busRouteNamesVisible,
  (v) => engine?.setBusRouteNamesVisible?.(v),
)

watch(
  () => store.focusSeq,
  () => {
    if (store.selected) engine?.flyToObject(store.selected)
  },
)

watch(
  () => store.nearbyPickMode,
  (active) => engine?.setPickPointMode?.(active),
)

watch(
  () => store.nearbyResult,
  (result) => engine?.renderNearbyStops?.(result),
)

watch(
  () => store.stationBufferResult,
  (result) => engine?.renderStationBuffer?.(result),
)

watch(
  () => store.routeByMode[store.mode],
  (route) => {
    engine?.setRoutePickMode?.(route.pickTarget !== null)
    engine?.renderRoutePlan?.(route.result, route.selectedId, route.origin, route.destination)
  },
  { deep: true },
)

watch(
  () => store.coverageResult,
  (result) => engine?.renderCoverage?.(result, store.coverageOpacity),
)

watch(
  () => store.coverageOpacity,
  (opacity) => engine?.setCoverageOpacity?.(opacity),
)

watch(
  () => store.focusPointSeq,
  () => {
    if (store.focusPoint) engine?.flyToPoint?.(store.focusPoint, 16)
  },
)

watch(
  () => store.brightness,
  (v) => {
    if (containerRef.value) containerRef.value.style.filter = `brightness(${v}%)`
  },
)

watch(
  () => store.resetSeq,
  () => {
    if (store.simulation3d.phase === 'idle') engine?.resetView()
  },
)

watch(
  () => store.baseMapId,
  (id) => engine?.setBaseMap(id),
  { flush: 'sync' },
)

watch(
  () => store.measureMode,
  (mode) => engine?.setMeasureMode(mode === 'none' ? null : mode),
)

watch(
  () => store.measureClearSeq,
  () => engine?.clearMeasure(),
)

watch(
  () => [store.measureAnnotations, store.selectedMeasureId] as const,
  ([annotations, selectedId]) => engine?.renderMeasureAnnotations?.(annotations, selectedId),
  { deep: true },
)

watch(
  () => store.measureEditingId,
  (id) => engine?.setMeasureEditing?.(id),
)

watch(
  () => store.simulation3d?.session,
  (session, previous) => {
    if (session === undefined || session === previous || !store.simulation3d) return
    if (store.simulation3d.phase === 'preparing' && store.simulation3d.routeId) {
      if (engine?.mode === '3d') void startSimulation(engine, engineGeneration, session, store.simulation3d.routeId, store.simulation3d.routeName ?? '')
    } else {
      simulationEngine(engine)?.stopMetroSimulation?.()
    }
  },
  { immediate: false },
)

watch(
  () => store.simulation3d?.tilesEnabled,
  (enabled) => { if (enabled !== undefined) simulationEngine(engine)?.setMetroSimulationTilesEnabled?.(enabled) },
)

watch(
  () => store.simulation3d?.otherRoutesVisible,
  (visible) => { if (visible !== undefined) simulationEngine(engine)?.setMetroSimulationOtherRoutesVisible?.(visible) },
)

watch(
  () => store.simulation3d?.speedMultiplier,
  (speed) => { if (speed !== undefined) simulationEngine(engine)?.setMetroSimulationSpeedMultiplier?.(speed) },
)

watch(
  () => store.simulation3d?.phase,
  (phase) => { if (phase) simulationEngine(engine)?.setMetroSimulationPaused?.(phase === 'paused') },
)

onMounted(() => mountEngine(store.mode))

onBeforeUnmount(() => {
  engineGeneration++
  simulationUnsubscribe?.()
  simulationUnsubscribe = null
  simulationEngine(engine)?.stopMetroSimulation?.()
  engine?.destroy()
  engine = null
})
</script>

<template>
  <div ref="containerRef" class="map-container" />
</template>

<style scoped>
.map-container {
  position: absolute;
  inset: 0;
  background: #0a101c;
}
</style>
