<script setup lang="ts">
import { computed, ref } from 'vue'
import { allRouteFeatures, getRoute } from '@/common/data/metroRepository'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()
const query = ref('')
const exiting = ref(false)
const routes = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  return allRouteFeatures().features
    .map((feature) => ({ id: String(feature.properties.id), name: feature.properties.route_cn ?? getRoute(String(feature.properties.id))?.name ?? '地铁线路' }))
    .filter((route) => !normalized || route.name.toLowerCase().includes(normalized) || route.id.includes(normalized))
})
const active = computed(() => store.simulation3d.phase !== 'idle')
const selectedRoute = computed(() => store.selected?.kind === 'road' ? store.selected : null)
const phaseLabel = computed(() => ({
  idle: '待机', preparing: '准备中', running: '运行中', paused: '已暂停', completed: '已到达终点', error: '模拟失败',
}[store.simulation3d.phase]))

function selectRoute(id: string, name: string): void {
  store.setCurrentSelection({ kind: 'road', id, name })
}

function startSelected(): void {
  if (store.simulation3d.phase !== 'idle' || !selectedRoute.value) return
  store.startMetroSimulation(selectedRoute.value.id, selectedRoute.value.name)
}

function restartSelected(): void {
  if (store.simulation3d.phase !== 'completed' && store.simulation3d.phase !== 'error') return
  const { routeId, routeName } = store.simulation3d
  if (!routeId || !routeName) return
  store.stopMetroSimulation()
  store.startMetroSimulation(routeId, routeName)
}

function exitSimulation(): void {
  if (exiting.value || store.simulation3d.phase === 'idle') return
  exiting.value = true
  store.stopMetroSimulation()
  requestAnimationFrame(() => { exiting.value = false })
}
</script>

<template>
  <section v-if="store.mode === '3d' && store.networkMode === 'metro' && store.railView === 'simulation'" class="simulation-panel" :class="{ 'selection-panel': !active }">
    <header><strong>线路模拟</strong><span class="phase">{{ phaseLabel }}</span></header>
    <Transition name="simulation-view" mode="out-in">
      <div v-if="!active" key="selection">
        <input v-model="query" type="search" placeholder="搜索地铁线路" aria-label="搜索地铁线路">
        <div class="route-list">
          <button v-for="route in routes" :key="route.id" :class="{ selected: selectedRoute?.id === route.id }" @click="selectRoute(route.id, route.name)">
            <span>{{ route.name }}</span><small>{{ route.id }}</small>
          </button>
          <p v-if="!routes.length" class="hint">没有匹配线路</p>
        </div>
        <button class="primary" :disabled="!selectedRoute" @click="startSelected">开始模拟</button>
      </div>
      <div v-else key="controls">
        <div class="route-name">{{ store.simulation3d.routeName }}</div>
        <label class="speed-control">
          <span>播放速度 <strong>{{ store.simulation3d.speedMultiplier.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') }}x</strong></span>
          <input type="range" min="0.25" max="4" step="0.25" :value="store.simulation3d.speedMultiplier" aria-label="模拟播放速度" @input="store.setMetroSimulationSpeedMultiplier(Number(($event.target as HTMLInputElement).value))">
        </label>
        <div class="status">车辆模型：{{ store.simulation3d.model.phase === 'loading' ? `下载中 ${Math.round(store.simulation3d.model.progress * 100)}%` : store.simulation3d.model.phase === 'ready' ? '已就绪' : store.simulation3d.model.phase === 'error' ? '加载失败' : '准备中' }}</div>
        <progress v-if="store.simulation3d.model.phase === 'loading'" max="1" :value="store.simulation3d.model.progress" />
        <div class="status">3D Tiles：{{ store.simulation3d.tilesStatus === 'loading' ? '加载中' : store.simulation3d.tilesStatus === 'error' ? '加载失败' : store.simulation3d.tilesStatus === 'ready' ? '已就绪' : '关闭' }}</div>
        <p v-if="store.simulation3d.model.error || store.simulation3d.error" class="error">{{ store.simulation3d.model.error || store.simulation3d.error }}</p>
        <label><input type="checkbox" :checked="store.simulation3d.tilesEnabled" @change="store.setMetroSimulationTilesEnabled(($event.target as HTMLInputElement).checked)"> 显示 3D Tiles</label>
        <label><input type="checkbox" :checked="store.simulation3d.otherRoutesVisible" @change="store.setMetroSimulationOtherRoutesVisible(($event.target as HTMLInputElement).checked)"> 显示其他线路</label>
        <div class="actions">
          <button :disabled="store.simulation3d.phase === 'completed' || store.simulation3d.phase === 'error' || store.simulation3d.phase === 'preparing'" @click="store.setMetroSimulationPaused(store.simulation3d.phase === 'running')">{{ store.simulation3d.phase === 'paused' ? '继续' : '暂停' }}</button>
          <button v-if="store.simulation3d.phase === 'completed' || store.simulation3d.phase === 'error'" @click="restartSelected">重新开始</button>
          <button class="danger" :disabled="exiting" @click="exitSimulation">退出模拟</button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.simulation-panel { position: absolute; top: 58px; right: 14px; z-index: 18; width: 288px; max-height: calc(100% - 90px); overflow: auto; padding: 14px; color: #c5d4e8; background: rgba(14,22,38,.96); border: 1px solid #1b2a41; border-radius: 6px; }
.simulation-panel.selection-panel { top: 14px; left: 60px; right: auto; z-index: 15; background: rgba(14,22,38,.92); border-radius: 8px; }
@media (max-width: 900px) {
  .simulation-panel.selection-panel { top: 14px; left: 12px; width: min(288px, calc(100% - 24px)); }
  .simulation-panel.selection-panel .route-list { max-height: 160px; }
}
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: #e8f1fb; font-size: 13px; }
.phase, small, .hint, .status { color: #8298b6; font-size: 11px; }
input[type="search"] { box-sizing: border-box; width: 100%; padding: 8px; color: inherit; background: #0d1424; border: 1px solid #1b2a41; border-radius: 4px; }
.route-list { max-height: 240px; overflow: auto; margin: 8px 0; }
.route-list button { display: flex; justify-content: space-between; width: 100%; padding: 8px; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid #1b2a41; cursor: pointer; }
.route-list button.selected { color: #35c8e8; background: rgba(53,200,232,.1); }
.primary, .actions button { padding: 7px 10px; color: #c5d4e8; background: #111c30; border: 1px solid #29415f; border-radius: 4px; cursor: pointer; }
.primary { width: 100%; color: #0a101c; background: #35c8e8; border-color: #35c8e8; font-weight: 600; }
button:disabled { opacity: .45; cursor: not-allowed; }
.route-name { margin: 8px 0; color: #e8f1fb; font-size: 14px; }
.status { margin: 8px 0; }
progress { width: 100%; height: 5px; accent-color: #35c8e8; }
label { display: block; margin: 9px 0; font-size: 12px; }
.speed-control span { display: flex; justify-content: space-between; margin-bottom: 5px; color: #c5d4e8; }
.speed-control strong { color: #35c8e8; font-weight: 600; }
.speed-control input { width: 100%; accent-color: #35c8e8; }
.actions { display: flex; gap: 7px; margin-top: 12px; }
.actions button { flex: 1; }
.actions .danger { color: #ff9191; }
.error { color: #ff9191; font-size: 11px; }
.hint { text-align: center; }
.simulation-view-enter-active, .simulation-view-leave-active { transition: opacity .16s ease, transform .16s ease; }
.simulation-view-enter-from, .simulation-view-leave-to { opacity: 0; transform: translateY(4px); }
@media (prefers-reduced-motion: reduce) {
  .simulation-view-enter-active, .simulation-view-leave-active { transition: none; }
}
</style>
