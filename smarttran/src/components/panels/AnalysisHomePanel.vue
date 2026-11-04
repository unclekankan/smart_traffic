<script setup lang="ts">
/**
 * 空间分析面板
 *
 * 首页提供分析类型入口，进入后分两条工作流：
 *  - 附近站点查询：选择搜索半径 → 地图选点 → 后端 PostGIS 按距离排序返回站点列表
 *  - 缓冲区覆盖分析：选择服务半径与站点范围 → 后端计算覆盖 / 重叠 → 地图渲染
 */

import { computed, ref } from 'vue'

import { useMapStore } from '@/stores/mapStore'
import type { CoverageKind } from '@/common/types/analysis'

type View = 'home' | 'nearby' | 'coverage' | 'networkCoverage'
const BUFFER_RADII = [300, 500, 800, 1000, 1500]

const NEARBY_RADII = [500, 1000, 2000]
const COVERAGE_RADII = [300, 500, 800]
const COVERAGE_KINDS: { key: CoverageKind; label: string }[] = [
  { key: 'metro', label: '地铁站' },
  { key: 'bus', label: '公交站' },
  { key: 'all', label: '全部' },
]

const store = useMapStore()
const view = ref<View>('home')

function openNearby(): void {
  view.value = 'nearby'
  // 尚无结果时直接进入选点状态
  if (!store.nearbyResult) store.startNearbyPick()
}

function openCoverage(): void {
  view.value = 'coverage'
}

function openNetworkCoverage(): void {
  view.value = 'networkCoverage'
}

function back(): void {
  store.cancelNearbyPick()
  view.value = 'home'
}

/** 附近站点结果摘要（地铁 / 公交分项计数） */
const nearbySummary = computed(() => {
  const r = store.nearbyResult
  if (!r) return ''
  const metro = r.stops.filter((s) => s.kind === 'metro').length
  return `半径 ${r.radiusM} m · 地铁 ${metro} 座 · 公交 ${r.stops.length - metro} 座`
})

/** 覆盖分析结果的简要指标（完整统计见底部面板） */
const selectedNearbyStop = computed(() => {
  const selected = store.selected
  if (!selected || (selected.kind !== 'station' && selected.kind !== 'busStop')) return null
  return selected
})

const analysisStop = computed(() => selectedNearbyStop.value?.name ?? '')

const bufferFeatures = computed(() => {
  const result = store.stationBufferResult
  if (!result) return []
  return [
    ...result.metroStops.features.map((f) => ({ ...f.properties, type: '地铁站' })),
    ...result.busStops.features.map((f) => ({ ...f.properties, type: '公交站' })),
    ...result.metroLines.features.map((f) => ({ ...f.properties, type: '地铁线路' })),
    ...result.busLines.features.map((f) => ({ ...f.properties, type: '公交线路' })),
  ]
})

const coverageSummary = computed(() => {
  const r = store.coverageResult
  if (!r) return null
  return {
    covered: r.stats.coveredAreaKm2.toFixed(2),
    overlap: r.stats.overlapAreaKm2.toFixed(2),
    count: r.stats.stationCount,
    stations: r.stats.overlapStationCount,
  }
})
</script>

<template>
  <div class="analysis-home">
    <!-- 首页：分析类型 -->
    <template v-if="view === 'home'">
      <div class="panel-head">
        <span class="title">空间分析</span>
      </div>
      <div class="type-list">
        <button class="type-card ready" @click="openNearby">
          <span class="t-icon">📍</span>
          <div class="t-info">
            <div class="t-name">附近站点查询<span class="t-badge">可用</span></div>
            <div class="t-desc">点击地图任意位置，按距离检索周边公交站与地铁站</div>
          </div>
        </button>
        <button class="type-card ready" @click="openCoverage">
          <span class="t-icon">📡</span>
          <div class="t-info">
            <div class="t-name">单站缓冲区分析<span class="t-badge">可用</span></div>
            <div class="t-desc">统计目标站点半径内的站点与线路</div>
          </div>
        </button>
        <button class="type-card ready" @click="openNetworkCoverage">
          <span class="t-icon">◉</span>
          <div class="t-info">
            <div class="t-name">全网服务范围<span class="t-badge">可用</span></div>
            <div class="t-desc">按站点类型统计服务区覆盖与重叠情况</div>
          </div>
        </button>
        <button class="type-card" disabled>
          <span class="t-icon">🧩</span>
          <div class="t-info">
            <div class="t-name">叠加分析<span class="t-badge soon">规划中</span></div>
            <div class="t-desc">多图层空间叠加，提取交集 / 并集区域</div>
          </div>
        </button>
        <button class="type-card ready" @click="store.setRailView('route')">
          <span class="t-icon">🔀</span>
          <div class="t-info">
            <div class="t-name">路径分析<span class="t-badge">可用</span></div>
            <div class="t-desc">地图选点后规划起终点间最短公交 / 地铁出行方案</div>
          </div>
        </button>
      </div>
    </template>

    <!-- 附近站点查询 -->
    <template v-else-if="view === 'nearby'">
      <div class="sub-head">
        <button class="back" title="返回" @click="back">←</button>
        <span class="title">附近站点查询</span>
      </div>

      <div class="field">
        <span class="field-label">搜索半径</span>
        <div class="chips">
          <button
            v-for="r in NEARBY_RADII" :key="r"
            class="chip" :class="{ active: store.nearbyRadius === r }"
            @click="store.setNearbyRadius(r)"
          >
            {{ r }} m
          </button>
        </div>
      </div>

      <button
        class="primary" :class="{ picking: store.nearbyPickMode }"
        :disabled="store.nearbyLoading"
        @click="store.startNearbyPick()"
      >
        {{ store.nearbyPickMode ? '请在地图上点击选取中心点' : (store.nearbyResult ? '重新选点' : '在地图上选点') }}
      </button>

      <div v-if="store.nearbyLoading" class="state">查询中…</div>
      <div v-else-if="store.nearbyError" class="state err">{{ store.nearbyError }}</div>

      <div v-else-if="store.nearbyResult" class="result-summary">
        {{ nearbySummary }}
        <span v-if="store.nearbyResult.truncated" class="warn">（结果已截断）</span>
        <div class="foot-hint">站点结果已显示在地图右侧面板</div>
      </div>
      <div v-else class="foot-hint">点击「在地图上选点」后，在地图上任意位置单击即可查询</div>
    </template>

    <!-- 单站缓冲区分析 -->
    <template v-else-if="view === 'coverage'">
      <div class="sub-head">
        <button class="back" title="返回" @click="back">←</button>
        <span class="title">单站缓冲区分析</span>
      </div>

      <div class="field">
        <span class="field-label">缓冲半径</span>
        <div class="chips">
          <button
            v-for="r in BUFFER_RADII" :key="r"
            class="chip" :class="{ active: store.stationBufferRadius === r }"
            @click="store.setStationBufferRadius(r)"
          >{{ r }} m</button>
        </div>
      </div>

      <button class="primary" :disabled="store.stationBufferLoading" @click="selectedNearbyStop && store.runStationBuffer({ kind: selectedNearbyStop.kind === 'station' ? 'metro' : 'bus', id: selectedNearbyStop.id, name: selectedNearbyStop.name })" v-if="selectedNearbyStop">
        {{ store.stationBufferLoading ? '分析中…' : `分析 ${analysisStop}` }}
      </button>
      <div v-else class="foot-hint">先在「附近站点查询」结果中点击目标站点，再返回此处执行分析</div>
      <div v-if="store.stationBufferError" class="state err">{{ store.stationBufferError }}</div>

      <div v-if="store.stationBufferResult" class="foot-hint">
        结果已显示在地图右侧面板：{{ store.stationBufferResult.station.name }} · 半径 {{ store.stationBufferResult.radiusM }} m
      </div>
    </template>

    <!-- 全网服务范围分析 -->
    <template v-else>
      <div class="sub-head">
        <button class="back" title="返回" @click="back">←</button>
        <span class="title">全网服务范围</span>
      </div>
      <div class="field">
        <span class="field-label">站点范围</span>
        <div class="chips">
          <button
            v-for="k in COVERAGE_KINDS" :key="k.key"
            class="chip" :class="{ active: store.coverageKind === k.key }"
            @click="store.setCoverageKind(k.key)"
          >
            {{ k.label }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="field-label">服务半径</span>
        <div class="chips">
          <button
            v-for="r in COVERAGE_RADII" :key="r"
            class="chip" :class="{ active: store.coverageRadius === r }"
            @click="store.setCoverageRadius(r)"
          >
            {{ r }} m
          </button>
        </div>
      </div>

      <button class="primary" :disabled="store.coverageLoading" @click="store.runCoverageAnalysis()">
        {{ store.coverageLoading ? '分析中…' : '生成服务范围并统计' }}
      </button>

      <div v-if="store.coverageError" class="state err">{{ store.coverageError }}</div>

      <template v-if="coverageSummary">
        <div class="stat-grid">
          <div class="stat"><span class="l">覆盖面积</span><span class="v">{{ coverageSummary.covered }} km²</span></div>
          <div class="stat"><span class="l">重叠面积</span><span class="v">{{ coverageSummary.overlap }} km²</span></div>
          <div class="stat"><span class="l">分析站点</span><span class="v">{{ coverageSummary.count }}</span></div>
          <div class="stat"><span class="l">重叠站点</span><span class="v">{{ coverageSummary.stations }}</span></div>
        </div>
        <div class="foot-hint">
          面积与重叠由后端 PostGIS 计算；缓冲区图层透明度、完整统计与导出见底部结果面板
        </div>
        <button class="ghost" @click="store.clearCoverage()">清除图层</button>
      </template>
      <div v-else class="foot-hint">
        逐站生成服务范围后按网格统计叠加密度：地图以连续色带呈现覆盖强弱（稀疏浅、密集深），
        覆盖面积 = 并集面积，重叠面积 = 缓冲区面积之和 − 并集面积
      </div>
    </template>
  </div>
</template>

<style scoped>
.analysis-home {
  position: absolute;
  top: 14px;
  left: 60px;
  width: 288px;
  max-height: calc(100% - 120px);
  overflow-y: auto;
  background: rgba(14, 22, 38, 0.92);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  padding: 14px;
  z-index: 15;
}
.panel-head { margin-bottom: 12px; }
.title { font-size: 13px; font-weight: 600; color: #e8f1fb; }
.type-list { display: flex; flex-direction: column; gap: 8px; }
.type-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
  transition: border-color .15s;
}
.type-card:hover:not(:disabled) { border-color: rgba(53, 200, 232, .5); }
.type-card.ready { border-color: rgba(61, 220, 151, .3); }
.type-card:disabled { cursor: default; opacity: .6; }
.t-icon { font-size: 18px; }
.t-name { font-size: 12px; color: #e8f1fb; display: flex; align-items: center; gap: 6px; }
.t-badge {
  font-size: 10px;
  color: #3ddc97;
  background: rgba(61, 220, 151, .14);
  border-radius: 8px;
  padding: 0 6px;
}
.t-badge.soon { color: #6d85a6; background: rgba(109, 133, 166, .14); }
.t-desc { font-size: 11px; color: #6d85a6; margin-top: 3px; line-height: 1.5; }

/* 二级视图 */
.sub-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.back {
  width: 22px; height: 22px; border-radius: 4px;
  background: #111c30; border: 1px solid #1b2a41;
  color: #8aa0be; cursor: pointer; font-size: 12px; line-height: 1;
}
.back:hover { color: #35c8e8; border-color: #35c8e8; }
.field { margin-bottom: 12px; }
.field-label { display: block; font-size: 11px; color: #6d85a6; margin-bottom: 6px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  flex: 1;
  min-width: 62px;
  padding: 5px 8px;
  font-size: 12px;
  color: #8aa0be;
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 4px;
  cursor: pointer;
}
.chip:hover { border-color: rgba(53, 200, 232, .5); }
.chip.active {
  color: #35c8e8;
  border-color: #35c8e8;
  background: rgba(53, 200, 232, .12);
}
.primary {
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  color: #0a101c;
  background: #35c8e8;
  border: 1px solid #35c8e8;
  border-radius: 5px;
  cursor: pointer;
  transition: opacity .15s;
}
.primary:disabled { opacity: .6; cursor: default; }
.primary.picking {
  color: #35c8e8;
  background: rgba(53, 200, 232, .12);
}
.ghost {
  width: 100%;
  margin-top: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: #8aa0be;
  background: #111c30;
  border: 1px solid #1b2a41;
  border-radius: 5px;
  cursor: pointer;
}
.ghost:hover { color: #35c8e8; border-color: #35c8e8; }
.buffer-list { max-height: 180px; overflow-y: auto; margin-top: 8px; border-top: 1px solid #1b2a41; }
.buffer-row { display: flex; gap: 8px; padding: 5px 2px; border-bottom: 1px solid rgba(27, 42, 65, .55); font-size: 11px; }
.buffer-type { flex: none; color: #35c8e8; }
.buffer-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c5d4e8; }
.state { margin-top: 10px; font-size: 12px; color: #6d85a6; }
.state.err { color: #ff7a7a; }
.result-summary { margin-top: 10px; font-size: 12px; color: #c5d4e8; }
.result-summary .warn { color: #f2a65a; }
.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}
.stat {
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 5px;
  padding: 7px 9px;
}
.stat .l { display: block; font-size: 10px; color: #6d85a6; }
.stat .v { display: block; margin-top: 2px; font-size: 13px; color: #e8f1fb; font-weight: 600; }
.foot-hint {
  margin-top: 12px;
  font-size: 11px;
  color: #5a7192;
  border-top: 1px solid #1b2a41;
  padding-top: 10px;
  line-height: 1.6;
}
</style>
