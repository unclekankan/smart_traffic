<script setup lang="ts">
/**
 * 公交线路列表面板（仅公交网络 + 工作台视角显示）
 *
 * 职责：
 * - 加载后端轻量线路列表（3048 条，无几何）
 * - 点击某条线路 → store.selectBusRoute(id) → 引擎加载 GeoJSON 矢量 + flyTo
 *
 * 搜索统一放在顶部 TopBar 输入框（与地铁搜索共用），本面板不再单独提供搜索框。
 * 与图层面板等浮动面板互斥（railView !== 'workbench' 时隐藏），避免 UI 互相遮挡。
 */

import { computed, onMounted, ref, watch } from 'vue'

import { useMapStore } from '@/stores/mapStore'
import { ensureBusRoutesLoaded } from '@/common/data/busRepository'
import type { BusRouteSummary } from '@/common/types/bus'

const store = useMapStore()

/** 首屏渲染条数（3048 条全量渲染会拖慢首帧，按需展开） */
const PAGE_SIZE = 200

const loading = ref(false)
const routes = ref<BusRouteSummary[]>([])
const expanded = ref(false)

const visibleRoutes = computed<BusRouteSummary[]>(() =>
  routes.value.slice(0, expanded.value ? routes.value.length : PAGE_SIZE),
)

async function load(): Promise<void> {
  if (routes.value.length || loading.value) return
  loading.value = true
  try {
    routes.value = await ensureBusRoutesLoaded()
  } finally {
    loading.value = false
  }
}

function toggle(id: number): void {
  if (store.selectedBusRoute === id) {
    store.selectBusRoute(null)
  } else {
    store.selectBusRoute(id)
  }
}

onMounted(load)

// 切到公交模式时自动拉列表
watch(
  () => store.networkMode,
  (mode) => {
    if (mode === 'bus') void load()
  },
)
</script>

<template>
  <aside
    v-if="store.networkMode === 'bus' && store.railView === 'workbench'"
    class="bus-route-list"
  >
    <header class="list-header">
      <span class="title">公交线路</span>
      <span class="count" v-if="routes.length">共 {{ routes.length }} 条</span>
    </header>

    <div v-if="loading" class="state">加载公交线路中…</div>
    <ul v-else class="route-ul">
      <li
        v-for="r in visibleRoutes"
        :key="r.id"
        class="route-item"
        :class="{ active: store.selectedBusRoute === r.id }"
        @click="toggle(r.id)"
      >
        <span class="route-cn">{{ r.route_cn }}</span>
        <span class="route-meta">
          {{ r.total_stop ?? '—' }} 站
          <span v-if="r.loop === '1'"> · 环线</span>
        </span>
      </li>
    </ul>

    <footer v-if="routes.length > PAGE_SIZE" class="list-footer">
      <button class="toggle-btn" @click="expanded = !expanded">
        {{ expanded ? '收起' : `展开全部 ${routes.length} 条` }}
      </button>
    </footer>
    <p class="list-tip">也可在顶部搜索框按线路名 / 起终点站查找</p>
  </aside>
</template>

<style scoped>
/* 顶部对齐地图上沿，底部预留图例空间（图例约 130px，避免互相遮挡） */
.bus-route-list {
  position: absolute;
  top: 14px;
  left: 16px;
  width: 258px;
  max-height: calc(100% - 180px);
  z-index: 12;
  display: flex;
  flex-direction: column;
  background: rgba(14, 22, 37, 0.94);
  border: 1px solid #22334f;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  overflow: hidden;
  /* 切换到公交网络时的出现动画 */
  animation: bus-list-in 0.22s ease;
}

@keyframes bus-list-in {
  from { opacity: 0; transform: translateX(-10px); }
  to { opacity: 1; transform: none; }
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid #22334f;
}
.list-header .title {
  font-size: 13px;
  font-weight: 600;
  color: #e5eefc;
}
.list-header .count {
  font-size: 11px;
  color: #7a94bb;
}

.state {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: #7a94bb;
}

.route-ul {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.route-item {
  padding: 6px 10px;
  margin: 2px 0;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 0.12s;
}
.route-item:hover { background: rgba(53, 200, 232, 0.08); }
.route-item.active {
  background: rgba(53, 200, 232, 0.16);
  border: 1px solid rgba(53, 200, 232, 0.4);
  padding: 5px 9px;
}
.route-cn {
  font-size: 12px;
  color: #e5eefc;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.route-meta {
  font-size: 10px;
  color: #7a94bb;
}

.list-footer {
  padding: 6px 10px;
  border-top: 1px solid #22334f;
  text-align: center;
}
.toggle-btn {
  background: transparent;
  border: 1px solid #22334f;
  color: #7a94bb;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.toggle-btn:hover { color: #e5eefc; border-color: #35c8e8; }

.list-tip {
  margin: 0;
  padding: 6px 12px 8px;
  font-size: 10px;
  color: #5e7697;
  border-top: 1px solid #1a2a42;
}
</style>
