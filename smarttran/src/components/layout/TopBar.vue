<script setup lang="ts">
/**
 * 顶部导航栏：品牌、搜索、用户区
 *
 * 搜索框为地铁 / 公交**共用**的一个输入，按当前网络模式切换数据源：
 * - 地铁模式：车站 / 线路模糊搜索（站名、拼音、区县、线路编号）
 * - 公交模式：公交线路模糊搜索（线路名、起终点站）
 *
 * 选中结果后：地铁走 store.focus 定位；公交走 store.selectBusRoute 加载叠加层，
 * 右侧属性面板统一展示详情。
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { ensureMetroLoaded } from '@/common/data/metroRepository'
import { ensureBusRoutesLoaded } from '@/common/data/busRepository'
import { searchMetro, type SearchHit } from '@/common/search/metroSearch'
import { searchBus, type BusSearchHit } from '@/common/search/busSearch'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()

const wrapRef = ref<HTMLDivElement>()
const query = ref('')
const open = ref(false)
const loaded = ref(false)
const busLoaded = ref(false)
const activeIndex = ref(-1)

/** 当前是否为公交网络（决定搜索数据源与分组标题） */
const isBus = computed(() => store.networkMode === 'bus')

/** 统一的地铁 / 公交命中项（kind 用于分组与选择动作） */
type UiHit = SearchHit | BusSearchHit

/** 搜索结果：地铁模式下检索站点与线路，公交模式下检索线路 */
const hits = computed<UiHit[]>(() => {
  if (!query.value.trim()) return []
  return isBus.value ? (busLoaded.value ? searchBus(query.value) : []) : searchMetro(query.value)
})
const busRoutes = computed(() =>
  hits.value.filter((hit): hit is BusSearchHit => hit.kind === 'busRoute'),
)
const roads = computed(() => hits.value.filter((hit): hit is SearchHit => hit.kind === 'road'))
const stations = computed(() => hits.value.filter((hit): hit is SearchHit => hit.kind === 'station'))
/** 键盘导航用的扁平列表 */
const flat = computed<UiHit[]>(() => [...busRoutes.value, ...roads.value, ...stations.value])

const showPanel = computed(() => open.value && query.value.trim().length > 0)
/** 当前模式的数据是否就绪 */
const ready = computed(() => (isBus.value ? busLoaded.value : loaded.value))

watch(query, () => {
  activeIndex.value = -1
  open.value = true
})

// 切换到公交模式时按需加载线路列表（供搜索与左侧列表共用）
watch(
  () => store.networkMode,
  (mode) => {
    if (mode === 'bus' && !busLoaded.value) {
      ensureBusRoutesLoaded()
        .then(() => {
          busLoaded.value = true
        })
        .catch(() => {
          busLoaded.value = false
        })
    }
  },
  { immediate: true },
)

onMounted(() => {
  ensureMetroLoaded()
    .then(() => {
      loaded.value = true
    })
    .catch(() => {
      loaded.value = false
    })
  document.addEventListener('mousedown', onDocumentMouseDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
})

function onDocumentMouseDown(event: MouseEvent): void {
  if (!wrapRef.value?.contains(event.target as Node)) open.value = false
}

function indexOfHit(hit: UiHit): number {
  return flat.value.indexOf(hit)
}

function isActive(hit: UiHit): boolean {
  return indexOfHit(hit) === activeIndex.value
}

/** ↑ / ↓ 切换高亮项 */
function move(delta: number): void {
  if (!showPanel.value) {
    open.value = true
    return
  }
  const count = flat.value.length
  if (!count) return
  if (activeIndex.value < 0) {
    activeIndex.value = delta > 0 ? 0 : count - 1
    return
  }
  activeIndex.value = (activeIndex.value + delta + count) % count
}

function chooseActive(): void {
  const hit = flat.value[activeIndex.value] ?? flat.value[0]
  if (hit) choose(hit)
}

/** 选中结果：公交线路加载叠加层，地铁对象定位 + 属性面板联动 */
function choose(hit: UiHit): void {
  if (hit.kind === 'busRoute') {
    store.selectBusRoute(Number(hit.id))
  } else {
    store.focus({ kind: hit.kind, id: hit.id, name: hit.name })
  }
  open.value = false
  activeIndex.value = -1
}

function clear(): void {
  query.value = ''
  open.value = false
  activeIndex.value = -1
}

/** 将文本按当前关键词切成「命中 / 未命中」片段，用于高亮 */
function highlight(text: string): Array<{ text: string; hit: boolean }> {
  const keyword = query.value.trim().toLowerCase()
  const index = keyword ? text.toLowerCase().indexOf(keyword) : -1
  if (index < 0) return [{ text, hit: false }]
  const parts: Array<{ text: string; hit: boolean }> = []
  if (index > 0) parts.push({ text: text.slice(0, index), hit: false })
  parts.push({ text: text.slice(index, index + keyword.length), hit: true })
  if (index + keyword.length < text.length) {
    parts.push({ text: text.slice(index + keyword.length), hit: false })
  }
  return parts
}
</script>

<template>
  <header class="top-bar">
    <div class="brand">
      <div class="logo">🚦</div>
      <div class="brand-text">
        <div class="title">智慧交通路网三维可视化与空间分析平台</div>
        <div class="subtitle">交通地理信息工作台</div>
      </div>
    </div>

    <div ref="wrapRef" class="search">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input
        v-model="query"
        :placeholder="
          isBus
            ? '搜索公交线路 / 起终点站（支持模糊匹配）'
            : '搜索车站 / 线路（支持模糊匹配）'
        "
        @focus="open = true"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="chooseActive"
        @keydown.esc="open = false"
      />
      <button v-if="query" class="clear-btn" title="清空" @click="clear">×</button>

      <div v-if="showPanel" class="result-panel">
        <div v-if="!ready" class="panel-hint">
          {{ isBus ? '公交线路加载中…' : '地铁数据加载中…' }}
        </div>
        <div v-else-if="!flat.length" class="panel-hint">
          {{ isBus ? '未找到匹配的公交线路' : '未找到匹配的车站或线路' }}
        </div>
        <template v-else>
          <div v-if="isBus && busRoutes.length" class="group">
            <div class="group-title">公交线路 <span>{{ busRoutes.length }}</span></div>
            <div
              v-for="hit in busRoutes"
              :key="'bus-' + hit.id"
              class="result-item"
              :class="{ active: isActive(hit) }"
              @mousedown.prevent="choose(hit)"
              @mouseenter="activeIndex = indexOfHit(hit)"
            >
              <span class="badge road">线</span>
              <div class="item-main">
                <div class="item-name">
                  <template v-for="(seg, i) in highlight(hit.name)" :key="i">
                    <b v-if="seg.hit" class="match">{{ seg.text }}</b>
                    <span v-else>{{ seg.text }}</span>
                  </template>
                </div>
                <div class="item-meta">{{ hit.meta }}</div>
              </div>
            </div>
          </div>

          <div v-if="roads.length" class="group">
            <div class="group-title">地铁线路 <span>{{ roads.length }}</span></div>
            <div
              v-for="hit in roads"
              :key="'road-' + hit.id"
              class="result-item"
              :class="{ active: isActive(hit) }"
              @mousedown.prevent="choose(hit)"
              @mouseenter="activeIndex = indexOfHit(hit)"
            >
              <span class="badge road">线</span>
              <div class="item-main">
                <div class="item-name">
                  <template v-for="(seg, i) in highlight(hit.name)" :key="i">
                    <b v-if="seg.hit" class="match">{{ seg.text }}</b>
                    <span v-else>{{ seg.text }}</span>
                  </template>
                </div>
                <div class="item-meta">{{ hit.meta }}</div>
              </div>
            </div>
          </div>

          <div v-if="stations.length" class="group">
            <div class="group-title">车站 <span>{{ stations.length }}</span></div>
            <div
              v-for="hit in stations"
              :key="'stop-' + hit.id"
              class="result-item"
              :class="{ active: isActive(hit) }"
              @mousedown.prevent="choose(hit)"
              @mouseenter="activeIndex = indexOfHit(hit)"
            >
              <span class="badge stop">站</span>
              <div class="item-main">
                <div class="item-name">
                  <template v-for="(seg, i) in highlight(hit.name)" :key="i">
                    <b v-if="seg.hit" class="match">{{ seg.text }}</b>
                    <span v-else>{{ seg.text }}</span>
                  </template>
                </div>
                <div class="item-meta">{{ hit.meta }}</div>
                <div v-if="hit.lines.length" class="item-lines">
                  <span
                    v-for="line in hit.lines"
                    :key="line"
                    class="line-chip"
                    :class="{ 'chip-match': line.toLowerCase().includes(query.trim().toLowerCase()) }"
                  >{{ line }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-foot">
            {{ isBus ? '↑↓ 切换 · Enter 加载线路' : '↑↓ 切换 · Enter 定位' }}
          </div>
        </template>
      </div>
    </div>

    <div class="right">
      <span class="demo-badge">● 演示项目</span>
      <button class="icon-btn" title="通知">🔔</button>
      <button class="icon-btn" title="设置">⚙</button>
      <div class="user">
        <div class="avatar">交</div>
        <span>交通管理员</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  position: relative;
  z-index: 40;
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 18px;
  background: #0a101c;
  border-bottom: 1px solid #1b2a41;
  gap: 20px;
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo { font-size: 22px; }
.brand-text .title { font-size: 15px; font-weight: 600; color: #e8f1fb; }
.brand-text .subtitle { font-size: 11px; color: #6d85a6; margin-top: 1px; }

.search {
  position: relative;
  flex: 1;
  max-width: 420px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: #111c30;
  border: 1px solid #1b2a41;
  border-radius: 6px;
  color: #6d85a6;
}
.search input {
  flex: 1; background: transparent; border: none; outline: none;
  color: #c5d4e8; font-size: 13px;
}
.search input::placeholder { color: #5a7192; }
.clear-btn {
  width: 16px; height: 16px; padding: 0;
  display: grid; place-items: center;
  background: #1b2a41; border: none; border-radius: 50%;
  color: #8aa0be; font-size: 12px; line-height: 1; cursor: pointer;
}
.clear-btn:hover { background: #24395a; color: #e8f1fb; }

/* ---------------- 搜索结果面板 ---------------- */
.result-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  max-height: 420px;
  overflow-y: auto;
  background: rgba(14, 22, 38, 0.98);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  z-index: 60;
}
.panel-hint { padding: 16px; font-size: 12px; color: #6d85a6; text-align: center; }
.group + .group { border-top: 1px solid #16233a; }
.group-title {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px 4px;
  font-size: 11px; color: #5a7192;
}
.group-title span { color: #35c8e8; }
.result-item {
  display: flex; gap: 10px;
  padding: 7px 12px;
  cursor: pointer;
}
.result-item.active, .result-item:hover { background: #16233a; }
.badge {
  flex: none;
  width: 20px; height: 20px; margin-top: 1px;
  display: grid; place-items: center;
  border-radius: 4px;
  font-size: 11px;
}
.badge.stop { background: rgba(53, 200, 232, 0.16); color: #35c8e8; }
.badge.road { background: rgba(127, 230, 247, 0.14); color: #7fe6f7; }
.item-main { min-width: 0; flex: 1; }
.item-name { font-size: 13px; color: #e8f1fb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-name .match { color: #35c8e8; font-weight: 600; }
.item-meta { font-size: 11px; color: #6d85a6; margin-top: 1px; }
.item-lines { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.line-chip {
  padding: 1px 6px;
  border-radius: 3px;
  background: #1b2a41;
  color: #8aa0be;
  font-size: 10px;
}
.line-chip.chip-match { background: rgba(53, 200, 232, 0.18); color: #35c8e8; }
.panel-foot {
  padding: 8px 12px;
  border-top: 1px solid #16233a;
  font-size: 10px;
  color: #4e6485;
  text-align: right;
}

.right { display: flex; align-items: center; gap: 14px; }
.demo-badge { font-size: 12px; color: #8aa0be; }
.icon-btn { background: none; border: none; color: #8aa0be; font-size: 16px; cursor: pointer; }
.user { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #c5d4e8; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: #35c8e8; color: #0a101c; font-weight: 600;
  display: grid; place-items: center; font-size: 13px;
}
</style>
