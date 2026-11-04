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
import type { MapEngine } from '@/common/types/engine'
import type { MapMode } from '@/common/types/engine'
import { LAYER_IDS } from '@/common/constants/layers'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()
const containerRef = ref<HTMLDivElement>()
const ready = ref(false)

let engine: MapEngine | null = null

async function mountEngine(mode: MapMode): Promise<void> {
  const el = containerRef.value
  if (!el) return
  ready.value = false
  engine?.destroy()

  const next: MapEngine = mode === '2d' ? new Map2DEngine() : new Map2DEngine()
  await next.init(el)
  engine = next

  // 回放当前 store 状态到新引擎
  next.setNetworkMode(store.networkMode)
  for (const id of LAYER_IDS) next.setLayerVisible(id, store.layerVisibility[id])
  next.setSelected(store.selected)
  next.setMeasureMode(store.measureMode === 'none' ? null : store.measureMode)
  // 回放空间分析叠加层
  next.setPickPointMode?.(store.nearbyPickMode)
  next.setRoutePickMode?.(store.routePickTarget !== null)
  next.renderRoutePlan?.(
    store.routePlanResult,
    store.routeSelectedId,
    store.routeOrigin,
    store.routeDestination,
  )
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
  ready.value = true
}

function bindEvents(e: MapEngine): void {
  e.on('select', (sel) => store.select(sel))
  e.on('pointer', (p) => store.setPointer(p))
  e.on('measure', (result) => store.setMeasureResult(result))
  // 附近站点查询：地图选点 → 以该点为中心查询
  e.on('pickPoint', (point) => void store.pickNearbyCenter(point))
  // 路线规划：地图选点 → 起点 / 终点坐标
  e.on('routePickPoint', (point) => void store.pickRoutePoint(point))
}

/* ---------------- 监听 store → 引擎 ---------------- */

watch(
  () => store.mode,
  async (mode, prev) => {
    if (engine && prev) store.saveCamera(prev, engine.getCameraState())
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
  (mode) => engine?.setNetworkMode(mode),
)

watch(
  () => store.selected,
  (sel) => engine?.setSelected(sel),
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
  () => store.routePickTarget,
  (target) => engine?.setRoutePickMode?.(target !== null),
)

watch(
  () => [
    store.routePlanResult,
    store.routeSelectedId,
    store.routeOrigin,
    store.routeDestination,
  ] as const,
  ([result, selectedId, origin, destination]) =>
    engine?.renderRoutePlan?.(result, selectedId, origin, destination),
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
  () => engine?.resetView(),
)

watch(
  () => store.baseMapId,
  (id) => engine?.setBaseMap(id),
)

watch(
  () => store.measureMode,
  (mode) => engine?.setMeasureMode(mode === 'none' ? null : mode),
)

watch(
  () => store.measureClearSeq,
  () => engine?.clearMeasure(),
)

onMounted(() => mountEngine(store.mode))

onBeforeUnmount(() => engine?.destroy())
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
