<script setup lang="ts">
/**
 * 右侧对象属性面板
 *
 * 三态：
 *  - 未选中：介绍卡片
 *  - 地铁线路：基本信息 / 运营信息 / 途经站点（按需向后端请求）
 *  - 地铁站：基本信息 / 所属区县 / 途经线路（随站点数据一并返回）
 */

import { computed, ref, watch } from 'vue'

import {
  allRouteFeatures,
  getRoute,
  getStop,
  getStopsOfRoute,
} from '@/common/data/metroRepository'
import { getRouteDetail, getRouteSummary } from '@/common/data/busRepository'
import { busApi } from '@/common/services/bus'
import type { BusRouteDetail } from '@/common/types/bus'
import { baseLineName, shortLineName } from '@/common/utils/lineName'
import { useMapStore } from '@/stores/mapStore'
import type { MetroRouteProps, MetroStopProps } from '@/common/types/metro'

const store = useMapStore()

/** 面板根节点（切换对象时回到顶部，避免"看起来没反应"） */
const asideRef = ref<HTMLElement>()

/** 当前是否公交网络（决定待机页文案与介绍卡片） */
const isBus = computed(() => store.networkMode === 'bus')

type RoutePanelData = MetroRouteProps & {
  name: string
  stops: Array<{ stop_id: string; stop_cn: string }>
}

/** 当前线路的途经站点 */
const routeStops = ref<Array<{ stop_id: string; stop_cn: string }>>([])
const loadingStops = ref(false)

interface RouteStopItem {
  stopId: string
  name: string
  /** 是否为换乘站（站内存在其他线路） */
  transfer: boolean
  /** 换乘线路短名，如「2号线」「18号线」 */
  transferLines: string[]
}

/** 当前线路的基础名（去掉方向与分期后缀） */
const routeBaseName = computed(() =>
  baseLineName(store.selected?.kind === 'road' ? store.selected.name : ''),
)

/** 线路途经站点 + 换乘信息（换乘线路来自站点数据） */
const routeStopItems = computed<RouteStopItem[]>(() =>
  routeStops.value.map((st) => {
    const info = getStop(st.stop_id)
    if (!info) {
      return { stopId: st.stop_id, name: st.stop_cn, transfer: false, transferLines: [] }
    }
    const transferLines = info.lines
      .filter((line) => baseLineName(line.name) !== routeBaseName.value)
      .map((line) => shortLineName(line.name))
    return {
      stopId: st.stop_id,
      name: st.stop_cn,
      transfer: transferLines.length > 0,
      transferLines,
    }
  }),
)

const transferCount = computed(() => routeStopItems.value.filter((item) => item.transfer).length)

/** 换乘线路压缩显示：['2号线','18号线'] → '2/18号线' */
function compactTransfer(lines: string[]): string {
  return `${lines.map((line) => line.replace(/号线$/, '')).join('/')}号线`
}

const route = computed<RoutePanelData | null>(() => {
  const selected = store.selected
  if (selected?.kind !== 'road') return null
  const detail = getRoute(selected.id)
  return detail ? { ...detail, stops: routeStops.value } : null
})

const station = computed<(MetroStopProps & { name: string }) | null>(() => {
  const selected = store.selected
  if (selected?.kind !== 'station') return null
  return getStop(selected.id) ?? null
})

/** 站点详情「返回线路」的目标线路：优先最近一次选中，其次按途经线路名匹配 */
const stationBackRoute = computed<{ id: string; name: string } | null>(() => {
  const last = store.lastMetroRouteId
  if (last) {
    const route = getRoute(last)
    if (route) return { id: String(route.id), name: route.name }
  }
  const firstLine = station.value?.lines[0]
  if (!firstLine) return null
  const matched = allRouteFeatures().features.find(
    (f) => baseLineName(f.properties.route_cn) === firstLine.name,
  )
  if (!matched) return null
  return {
    id: String(matched.properties.id),
    name: matched.properties.route_cn ?? firstLine.name,
  }
})

/** 从地铁站点详情返回所属线路 */
function backToStationRoute(): void {
  const target = stationBackRoute.value
  if (!target) return
  if (!store.contextMetroRoute) {
    store.contextMetroRoute = { kind: 'road', id: target.id, name: target.name }
  }
  store.backToMetroRoute()
}

/* ---------------- 公交：线路 / 站点详情（复用同一套 UI） ---------------- */

/** 选中公交线路的详情（线路 GeoJSON + 沿线有序站点），按需拉取 */
const busDetail = ref<BusRouteDetail | null>(null)
const loadingBus = ref(false)

/** 当前选中的公交线路数据 */
const busRoute = computed(() => {
  const selected = store.selected
  if (selected?.kind !== 'busRoute') return null
  const summary = getRouteSummary(selected.id)
  const props = busDetail.value?.route.properties
  return {
    id: selected.id,
    name: selected.name || summary?.route_cn || props?.route_cn || '公交线路',
    props,
    stops: busDetail.value?.stops.features ?? [],
  }
})

/** 当前选中的公交站点（从当前线路的沿线站点中查找，取序号与距离） */
const busStopInfo = ref<any>(null)
const busStop = computed(() => {
  const selected = store.selected
  if (selected?.kind !== 'busStop') return null
  const features = busDetail.value?.stops.features ?? []
  const index = features.findIndex((f) => f.properties.stop_id === selected.id)
  const props = index >= 0 ? features[index]?.properties : undefined
  return {
    name: busStopInfo.value?.stop?.stop_cn ?? selected.name,
    stopId: selected.id,
    index: index >= 0 ? index + 1 : null,
    total: features.length || null,
    lineCount: busStopInfo.value?.line_count ?? props?.num ?? null,
    city: busStopInfo.value?.stop?.city_cn ?? props?.city_cn ?? '成都',
    routeNames: busStopInfo.value?.lines?.map((r: any) => r.name) ?? [],
    routeName: busDetail.value?.route.properties.route_cn ?? '',
    status: '数据未提供',
  }
})

watch(
  () => store.selected?.kind === 'busStop' ? store.selected.id : null,
  async (id) => {
    busStopInfo.value = null
    if (!id) return
    try {
      busStopInfo.value = await busApi.getStop(id)
    } catch {
      busStopInfo.value = null
    }
  },
  { immediate: true },
)

/** 当前选中公交线路 id（作为详情拉取的 key，切换线路时重置旧数据） */
const selectedBusRouteId = computed(() =>
  store.selected?.kind === 'busRoute' ? store.selected.id : null,
)

/** 选中公交线路时自动拉取详情（同一线路已缓存则跳过；切换线路先清空旧属性） */
watch(
  selectedBusRouteId,
  async (id) => {
    if (!id) return
    if (busDetail.value && String(busDetail.value.route.properties.id) === id) return
    busDetail.value = null
    loadingBus.value = true
    try {
      busDetail.value = await getRouteDetail(id)
    } catch {
      busDetail.value = null
    } finally {
      loadingBus.value = false
    }
  },
  { immediate: true },
)

/** 点击公交站点 → 右侧切换为站点详情并定位 */
function focusBusStop(stopId: string, name: string): void {
  store.focus({ kind: 'busStop', id: stopId, name })
}

/** 站点详情「返回线路」：回到所属公交线路 */
function backToRoute(): void {
  store.backToBusRoute()
}

/** 取消选中公交线路：引擎监听后销毁已加载的 GeoJSON 叠加层 */
function clearBusRoute(): void {
  store.clearBusRoute()
}

/** 切换选中对象时回到面板顶部（详情内容变化更直观） */
watch(
  () => `${store.selected?.kind ?? 'none'}:${store.selected?.id ?? ''}`,
  () => {
    asideRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  },
)

/** 选中线路时按需拉取其有序站点 */
watch(
  () => store.selected,
  async (selected) => {
    routeStops.value = []
    if (selected?.kind !== 'road') return
    loadingStops.value = true
    try {
      const stops = await getStopsOfRoute(selected.id)
      routeStops.value = stops.map((f) => ({
        stop_id: f.properties.stop_id,
        stop_cn: f.properties.name_cn,
      }))
    } catch {
      routeStops.value = []
    } finally {
      loadingStops.value = false
    }
  },
  { immediate: true },
)

/** HHMM -> HH:MM */
function fmtTime(t: string | null): string {
  if (!t) return '—'
  const m = t.match(/^(\d{2})(\d{2})$/)
  return m ? `${m[1]}:${m[2]}` : t
}

function statusLabel(status: string | number | null): string {
  const n = Number(status)
  if (n === 1) return '运营中'
  if (n === 3) return '规划中'
  return status ? String(status) : '—'
}

function focusStation(id: string): void {
  const stop = getStop(id)
  if (stop) store.focus({ kind: 'station', id, name: stop.name })
}

function locate(): void {
  if (store.selected) store.focus(store.selected)
}
</script>

<template>
  <aside ref="asideRef" class="property-panel">
    <Transition name="panel-swap" mode="out-in">
    <!-- 待机页：地铁 / 公交各自一套引导文案 -->
    <div v-if="!store.selected" key="empty" class="panel-body">
      <h3 class="panel-title">对象属性</h3>
      <p class="subtitle">
        {{ isBus ? '在场景中选择公交线路或站点后查看详细信息' : '在场景中选择对象后查看详细信息' }}
      </p>
      <div class="empty-state">
        <div class="empty-icon">{{ isBus ? '🚌' : '📍' }}</div>
        <div class="empty-title">{{ isBus ? '尚未选择公交线路' : '尚未选择对象' }}</div>
        <div class="empty-desc">
          {{ isBus
            ? '点击地图上的公交线路，或从左侧线路列表 / 顶部搜索框选择线路，在此查看线路与沿线站点详情。'
            : '选择地图上的地铁线路或站点，在此查看对应业务属性与可用操作。' }}
        </div>
      </div>
      <div class="intro-cards">
        <template v-if="isBus">
          <div class="intro-card"><span class="dot bus" />公交线路 <small>查看起终点、里程、票价与沿线站点</small></div>
          <div class="intro-card"><span class="dot busstop" />公交站点 <small>查看所属线路与沿线序号</small></div>
        </template>
        <template v-else>
          <div class="intro-card"><span class="dot road" />地铁线路 <small>查看线路信息、运营时刻与途经站点</small></div>
          <div class="intro-card"><span class="dot station" />地铁站 <small>查看区县归属、途经线路与换乘情况</small></div>
        </template>
      </div>
    </div>

    <!-- 地铁线路详情 -->
    <div v-else-if="route" key="metro-route" class="panel-body">
      <h3 class="panel-title">线路详情</h3>
      <div class="detail-head">
        <div>
          <div class="detail-name">{{ route.name }}</div>
          <div class="detail-sub">线路 ID：{{ route.id }}</div>
        </div>
        <span class="state-tag" :class="{ normal: Number(route.status) === 1 }">
          {{ statusLabel(route.status) }}
        </span>
      </div>

      <div class="kv-grid">
        <div class="kv"><span class="k">起点站</span><span class="v">{{ route.s_stop_cn ?? '—' }}</span></div>
        <div class="kv"><span class="k">终点站</span><span class="v">{{ route.e_stop_cn ?? '—' }}</span></div>
        <div class="kv"><span class="k">线路里程</span><span class="v">{{ route.distance ?? route.length ?? '—' }} km</span></div>
        <div class="kv"><span class="k">站点总数</span><span class="v">{{ route.total_stop ?? '—' }} 座</span></div>
        <div class="kv"><span class="k">首班车</span><span class="v">{{ fmtTime(route.start_time) }}</span></div>
        <div class="kv"><span class="k">末班车</span><span class="v">{{ fmtTime(route.end_time) }}</span></div>
        <div class="kv"><span class="k">起步票价</span><span class="v">{{ route.basic_prc ?? '—' }} 元</span></div>
        <div class="kv"><span class="k">全程票价</span><span class="v">{{ route.total_prc ?? '—' }} 元</span></div>
        <div class="kv"><span class="k">线路类型</span><span class="v">{{ route.route_type ?? '—' }}</span></div>
        <div class="kv"><span class="k">运营公司</span><span class="v">{{ route.company_cn ?? '—' }}</span></div>
      </div>

      <div class="section">
        <div class="section-title">
          途经站点（{{ route.stops.length }} 座<template v-if="transferCount"> · 换乘 {{ transferCount }}</template>）
        </div>
        <p v-if="loadingStops" class="hint">加载中…</p>
        <div v-else-if="routeStopItems.length" class="stop-strip">
          <div class="stop-track">
            <template v-for="(st, i) in routeStopItems" :key="st.stopId">
              <button
                class="stop-node"
                :class="{ transfer: st.transfer }"
                :title="st.transfer ? `换乘 ${st.transferLines.join(' / ')}` : st.name"
                @click="focusStation(st.stopId)"
              >
                <span class="stop-lines">
                  <span v-if="st.transfer" class="transfer-line">{{ compactTransfer(st.transferLines) }}</span>
                </span>
                <span class="stop-dot" />
                <span class="stop-name">{{ st.name }}</span>
              </button>
              <span v-if="i < routeStopItems.length - 1" class="stop-link" />
            </template>
          </div>
        </div>
        <p v-else class="hint">暂无站点数据</p>
        <div v-if="transferCount" class="strip-legend">
          <span class="legend-dot" />换乘站 <span class="legend-note">绿色标注并显示可换乘线路</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          站点列表<span class="title-note">{{ routeStopItems.length }} 座 · 换乘 {{ transferCount }}</span>
        </div>
        <div v-if="routeStopItems.length" class="stop-menu">
          <button
            v-for="(st, i) in routeStopItems"
            :key="st.stopId"
            class="menu-row"
            :title="st.transfer ? `换乘 ${st.transferLines.join(' / ')}` : st.name"
            @click="focusStation(st.stopId)"
          >
            <span class="row-index">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="row-dot" :class="{ transfer: st.transfer }" />
            <span class="row-name">{{ st.name }}</span>
            <span v-if="st.transfer" class="row-transfer">{{ compactTransfer(st.transferLines) }}</span>
            <span v-if="i === 0" class="row-tag start">起点</span>
            <span v-else-if="i === routeStopItems.length - 1" class="row-tag end">终点</span>
            <span class="row-arrow">›</span>
          </button>
        </div>
        <p v-else class="hint">暂无站点数据</p>
      </div>

      <div class="action-row">
        <button class="btn primary" @click="locate">📍 定位线路</button>
      </div>
    </div>

    <!-- 地铁站详情 -->
    <div v-else-if="station" key="metro-station" class="panel-body">
      <h3 class="panel-title">站点详情</h3>
      <div class="detail-head">
        <div>
          <div class="detail-name">{{ station.name }}</div>
          <div class="detail-sub">{{ station.stop_id }}</div>
        </div>
        <span class="state-tag normal" v-if="station.line_count >= 2">换乘站</span>
        <span class="state-tag" v-else>普通站</span>
      </div>

      <div class="kv-grid">
        <div class="kv"><span class="k">所属区县</span><span class="v">{{ station.district ?? '市域外' }}</span></div>
        <div class="kv"><span class="k">途经线路数</span><span class="v">{{ station.line_count }} 条</span></div>
        <div class="kv"><span class="k">所属城市</span><span class="v">{{ station.city_cn ?? '成都' }}</span></div>
        <div class="kv"><span class="k">站点 ID</span><span class="v">{{ station.stop_id }}</span></div>
      </div>

      <div class="section">
        <div class="section-title">途经线路（{{ station.line_count }} 条）</div>
        <div v-if="station.lines.length" class="line-tags">
          <span
            v-for="line in station.lines" :key="line.name" class="line-tag"
            :title="line.directions.join(' / ')"
          >{{ line.name }}</span>
        </div>
        <p v-else class="hint">暂无线路数据</p>
      </div>

      <p class="hint" v-if="station.line_count >= 2">该站为换乘站，可在 3D 场景查看体块示意。</p>

      <div class="action-row">
        <button class="btn primary" @click="locate">📍 定位站点</button>
        <button
          class="btn ghost"
          :disabled="!stationBackRoute"
          @click="backToStationRoute"
        >← 返回线路</button>
      </div>
    </div>

    <!-- 公交线路详情（复用地铁线路详情 UI） -->
    <div v-else-if="busRoute" key="bus-route" class="panel-body">
      <h3 class="panel-title">线路详情</h3>
      <div class="detail-head">
        <div>
          <div class="detail-name">{{ busRoute.name }}</div>
          <div class="detail-sub">线路 ID：{{ busRoute.id }}</div>
        </div>
        <span v-if="busRoute.props?.loop === '1'" class="state-tag normal">环线</span>
        <span v-else class="state-tag">公交</span>
      </div>

      <p v-if="loadingBus && !busRoute.props" class="hint">线路详情加载中…</p>
      <div v-else class="kv-grid">
        <div class="kv"><span class="k">起点站</span><span class="v">{{ busRoute.props?.s_stop_cn ?? '—' }}</span></div>
        <div class="kv"><span class="k">终点站</span><span class="v">{{ busRoute.props?.e_stop_cn ?? '—' }}</span></div>
        <div class="kv"><span class="k">线路里程</span><span class="v">{{ busRoute.props?.length ?? busRoute.props?.distance ?? '—' }} km</span></div>
        <div class="kv"><span class="k">站点总数</span><span class="v">{{ busRoute.stops.length }} 座</span></div>
        <div class="kv"><span class="k">首班车</span><span class="v">{{ fmtTime(busRoute.props?.start_time ?? null) }}</span></div>
        <div class="kv"><span class="k">末班车</span><span class="v">{{ fmtTime(busRoute.props?.end_time ?? null) }}</span></div>
        <div class="kv"><span class="k">起步票价</span><span class="v">{{ busRoute.props?.basic_prc ?? '—' }} 元</span></div>
        <div class="kv"><span class="k">线路类型</span><span class="v">{{ busRoute.props?.route_type ?? '—' }}</span></div>
        <div class="kv"><span class="k">运营公司</span><span class="v">{{ busRoute.props?.company_cn ?? '—' }}</span></div>
      </div>

      <div class="section">
        <div class="section-title">
          途经站点（{{ busRoute.stops.length }} 座<template v-if="loadingBus"> · 加载中…</template>）
        </div>
        <p v-if="loadingBus" class="hint">加载中…</p>
        <div v-else-if="busRoute.stops.length" class="stop-strip">
          <div class="stop-track">
            <template v-for="(st, i) in busRoute.stops" :key="st.properties.stop_id ?? i">
              <button
                class="stop-node"
                :title="st.properties.stop_cn ?? ''"
                @click="focusBusStop(st.properties.stop_id ?? '', st.properties.stop_cn ?? '')"
              >
                <span class="stop-dot" />
                <span class="stop-name">{{ st.properties.stop_cn }}</span>
              </button>
              <span v-if="i < busRoute.stops.length - 1" class="stop-link" />
            </template>
          </div>
        </div>
        <p v-else class="hint">暂无站点数据</p>
      </div>

      <div class="section">
        <div class="section-title">
          站点列表<span class="title-note">{{ busRoute.stops.length }} 座 · 沿线 100m 空间匹配</span>
        </div>
        <div v-if="busRoute.stops.length" class="stop-menu">
          <button
            v-for="(st, i) in busRoute.stops"
            :key="st.properties.stop_id ?? i"
            class="menu-row"
            :title="st.properties.stop_cn ?? ''"
            @click="focusBusStop(st.properties.stop_id ?? '', st.properties.stop_cn ?? '')"
          >
            <span class="row-index">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="row-dot" />
            <span class="row-name">{{ st.properties.stop_cn }}</span>
            <span v-if="i === 0" class="row-tag start">起点</span>
            <span v-else-if="i === busRoute.stops.length - 1" class="row-tag end">终点</span>
            <span class="row-arrow">›</span>
          </button>
        </div>
        <p v-else class="hint">暂无站点数据</p>
      </div>

      <div class="action-row">
        <button class="btn primary" @click="locate">📍 定位线路</button>
        <button class="btn ghost" @click="clearBusRoute">✕ 取消选中</button>
      </div>
    </div>

    <!-- 公交站点详情（复用地铁站点详情 UI） -->
    <div v-else-if="busStop" key="bus-stop" class="panel-body">
      <h3 class="panel-title">站点详情</h3>
      <div class="detail-head">
        <div>
          <div class="detail-name">{{ busStop.name }}</div>
          <div class="detail-sub">{{ busStop.stopId }}</div>
        </div>
        <span class="state-tag">公交站</span>
      </div>

      <div class="kv-grid">
        <div class="kv"><span class="k">所属城市</span><span class="v">{{ busStop.city }}</span></div>
        <div class="kv"><span class="k">途经线路数</span><span class="v">{{ busStop.lineCount ?? '—' }} 条</span></div>
        <div class="kv"><span class="k">所属线路</span><span class="v">{{ busStop.routeNames.join('、') || busStop.routeName || '—' }}</span></div>
        <div class="kv"><span class="k">运营状态</span><span class="v">{{ busStop.status }}</span></div>
      </div>

      <div class="section">
        <div class="section-title">所属线路（1 条）</div>
        <div v-if="busStop.routeName" class="line-tags">
          <span class="line-tag">{{ busStop.routeName }}</span>
        </div>
        <p v-else class="hint">未选中线路</p>
      </div>

      <p class="hint">公交站点无独立线路关联表，站点由所选线路沿线 100m 空间匹配得到。</p>

      <div class="action-row">
        <button class="btn primary" @click="locate">📍 定位站点</button>
        <button
          class="btn ghost"
          :disabled="store.selectedBusRoute === null && store.lastBusRouteId === null"
          @click="backToRoute"
        >← 返回线路</button>
      </div>
    </div>
    </Transition>
  </aside>
</template>

<style scoped>
.property-panel {
  width: 280px;
  background: #0e1626;
  border-left: 1px solid #1b2a41;
  padding: 16px;
  overflow-y: auto;
}
.panel-title { font-size: 14px; color: #e8f1fb; margin: 0 0 4px; }
.subtitle { font-size: 11px; color: #6d85a6; margin: 0 0 14px; }

.empty-state { text-align: center; padding: 28px 8px; }
.empty-icon { font-size: 28px; opacity: .4; }
.empty-title { color: #c5d4e8; font-size: 14px; margin-top: 8px; }
.empty-desc { color: #6d85a6; font-size: 12px; margin-top: 6px; line-height: 1.6; }

.intro-cards { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.intro-card {
  display: flex; align-items: center; gap: 8px;
  padding: 10px; background: #111c30; border: 1px solid #1b2a41; border-radius: 6px;
  font-size: 12px; color: #c5d4e8;
}
.intro-card small { color: #6d85a6; font-size: 11px; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.road, .dot.station { background: #35c8e8; }
/* 公交引导卡片：线路用暖橙、站点用绿色，与地铁区分 */
.dot.bus { background: #f0a33c; }
.dot.busstop { background: #3ddc97; }

.detail-head { display: flex; justify-content: space-between; align-items: flex-start; margin: 12px 0 16px; }
.detail-name { font-size: 18px; font-weight: 600; color: #e8f1fb; }
.detail-sub { font-size: 12px; color: #6d85a6; margin-top: 2px; }
.state-tag { font-size: 12px; padding: 3px 10px; border-radius: 10px; border: 1px solid; background: transparent; }
.state-tag.normal { color: #3ddc97; border-color: #3ddc97; }

.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.kv { display: flex; flex-direction: column; }
.kv .k { font-size: 11px; color: #6d85a6; }
.kv .v { font-size: 13px; color: #e8f1fb; margin-top: 2px; }

.section { margin-top: 18px; }
.section-title { font-size: 12px; color: #8aa0be; font-weight: 600; margin-bottom: 10px; }

/* 途经站点：横向滑动条 */
.stop-strip {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 6px;
}
.stop-strip::-webkit-scrollbar { height: 6px; }
.stop-strip::-webkit-scrollbar-track { background: #0d1424; border-radius: 3px; }
.stop-strip::-webkit-scrollbar-thumb { background: #1b2a41; border-radius: 3px; }
.stop-strip::-webkit-scrollbar-thumb:hover { background: #35c8e8; }
.stop-track {
  display: flex;
  align-items: flex-start;
  min-width: max-content;
  padding: 2px 2px 0;
}
.stop-node {
  flex: none;
  width: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.stop-lines {
  height: 14px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.transfer-line {
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 9px;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 2px;
  background: rgba(61, 220, 151, 0.16);
  color: #3ddc97;
  white-space: nowrap;
}
.stop-dot {
  box-sizing: content-box;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #35c8e8;
  border: 2px solid #0e1626;
}
.stop-node.transfer .stop-dot {
  background: #3ddc97;
  box-shadow: 0 0 0 3px rgba(61, 220, 151, 0.22);
}
.stop-name {
  font-size: 11px;
  color: #8aa0be;
  white-space: nowrap;
}
.stop-node:hover .stop-name { color: #35c8e8; }
.stop-link {
  flex: 1 0 14px;
  height: 2px;
  margin-top: 24px;
  background: #2a4566;
}
.strip-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 10px;
  color: #6d85a6;
}
.legend-dot { width: 8px; height: 8px; border-radius: 50%; background: #3ddc97; }
.legend-note { color: #4e6485; }

/* 站点列表：菜单式纵向排列 */
.section-title .title-note {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 400;
  color: #5a7192;
}
.stop-menu {
  max-height: 300px;
  overflow-y: auto;
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 6px;
}
.stop-menu::-webkit-scrollbar { width: 6px; }
.stop-menu::-webkit-scrollbar-track { background: #0d1424; }
.stop-menu::-webkit-scrollbar-thumb { background: #1b2a41; border-radius: 3px; }
.stop-menu::-webkit-scrollbar-thumb:hover { background: #35c8e8; }
.menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: none;
  border-bottom: 1px solid #16233a;
  color: #8aa0be;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.menu-row:last-child { border-bottom: none; }
.menu-row:hover { background: #16233a; color: #e8f1fb; }
.row-index {
  flex: none;
  width: 18px;
  font-size: 10px;
  color: #4e6485;
  font-variant-numeric: tabular-nums;
}
.row-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #35c8e8;
}
.row-dot.transfer {
  background: #3ddc97;
  box-shadow: 0 0 0 2px rgba(61, 220, 151, 0.2);
}
.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.row-transfer {
  flex: none;
  padding: 1px 4px;
  font-size: 9px;
  border-radius: 2px;
  background: rgba(61, 220, 151, 0.16);
  color: #3ddc97;
}
.row-tag {
  flex: none;
  padding: 1px 4px;
  font-size: 9px;
  border-radius: 2px;
  background: #1b2a41;
  color: #8aa0be;
}
.row-tag.start { background: rgba(53, 200, 232, 0.16); color: #35c8e8; }
.row-arrow { flex: none; color: #3a5273; font-size: 13px; }

/* 途经线路标签 */
.line-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.line-tag {
  font-size: 12px; padding: 4px 10px; border-radius: 12px;
  color: #0a101c; background: #35c8e8; font-weight: 600; cursor: default;
}

.hint { font-size: 11px; color: #6d85a6; margin-top: 8px; }

.action-row { display: flex; gap: 8px; margin-top: 20px; }
.btn {
  flex: 1; padding: 9px; font-size: 13px; border-radius: 6px; cursor: pointer; border: 1px solid transparent;
  transition: all .2s;
}
.btn.primary { background: #35c8e8; color: #0a101c; font-weight: 600; }
.btn.primary:hover { background: #7fe6f7; }
.btn.ghost { background: transparent; color: #8aa0be; border-color: #1b2a41; }
.btn.ghost:hover { color: #35c8e8; border-color: #35c8e8; }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.ghost:disabled:hover { color: #8aa0be; border-color: #1b2a41; }

/* 内容切换过渡：详情页之间淡入淡出 + 轻微位移 */
.panel-swap-enter-active,
.panel-swap-leave-active {
  transition: opacity .18s ease, transform .18s ease;
}
.panel-swap-enter-from { opacity: 0; transform: translateY(6px); }
.panel-swap-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
