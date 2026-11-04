<script setup lang="ts">
/**
 * 公共交通路线规划面板
 *
 * 交互流程：
 * 1. 点击「地图选点」→ 地图进入选点模式（十字光标）
 * 2. 点击地图写入起点 / 终点坐标（WGS84）
 * 3. 两端齐备后自动请求后端规划；也可调整策略后手动规划
 * 4. 方案列表切换选中项，地图同步高亮并缩放到路线范围
 */

import { computed } from 'vue'

import { useMapStore } from '@/stores/mapStore'
import { TRANSIT_STRATEGIES, type TransitSegment } from '@/common/types/transit'

const store = useMapStore()

function fmtCoord(point: [number, number] | null): string {
  return point ? `${point[0].toFixed(6)}, ${point[1].toFixed(6)}` : '未选择'
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`
  const minutes = Math.round(sec / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`
}

const selectedAlt = computed(() => {
  const result = store.routePlanResult
  if (!result) return null
  return result.alternatives.find((a) => a.id === store.routeSelectedId) ?? result.alternatives[0] ?? null
})

function segmentLabel(seg: TransitSegment): string {
  if (seg.type === 'walk') return '步行'
  return seg.lineName || (seg.type === 'metro' ? '地铁' : '公交')
}

function segmentMeta(seg: TransitSegment): string {
  if (seg.type === 'walk') {
    return `${fmtDistance(seg.distanceM)} · ${fmtDuration(seg.durationSec)}`
  }
  const from = seg.departureStop?.name || '上车点'
  const to = seg.arrivalStop?.name || '下车点'
  const stations = seg.stops.length > 2 ? ` · 共 ${seg.stops.length} 站` : ''
  return `${from} → ${to}${stations} · ${fmtDuration(seg.durationSec)}`
}

const pickingHint = computed(() => {
  if (store.routePickTarget === 'origin') return '正在选择起点：请在地图上点击'
  if (store.routePickTarget === 'destination') return '正在选择终点：请在地图上点击'
  return ''
})
</script>

<template>
  <div class="route-panel">
    <div class="panel-head">
      <span class="title">路线规划</span>
      <button
        v-if="store.routeOrigin || store.routeDestination || store.routePlanResult"
        class="clear"
        title="清空起终点与规划结果"
        @click="store.clearRoutePlan()"
      >清空</button>
    </div>

    <!-- 起终点 -->
    <div class="endpoints">
      <div class="endpoint-row">
        <span class="dot origin" />
        <div class="endpoint-info">
          <span class="ep-label">起点</span>
          <span class="ep-coord">{{ fmtCoord(store.routeOrigin) }}</span>
        </div>
        <button
          class="pick-btn"
          :class="{ active: store.routePickTarget === 'origin' }"
          @click="store.startRoutePick('origin')"
        >地图选点</button>
      </div>
      <div class="endpoint-row">
        <span class="dot destination" />
        <div class="endpoint-info">
          <span class="ep-label">终点</span>
          <span class="ep-coord">{{ fmtCoord(store.routeDestination) }}</span>
        </div>
        <button
          class="pick-btn"
          :class="{ active: store.routePickTarget === 'destination' }"
          @click="store.startRoutePick('destination')"
        >地图选点</button>
      </div>
      <button
        class="swap"
        :disabled="!store.routeOrigin && !store.routeDestination"
        title="交换起点与终点"
        @click="store.swapRouteEndpoints()"
      >⇅ 交换起终点</button>
    </div>

    <div v-if="pickingHint" class="pick-hint">{{ pickingHint }}</div>

    <!-- 出行策略 -->
    <div class="field">
      <span class="field-label">出行策略</span>
      <div class="chips">
        <button
          v-for="s in TRANSIT_STRATEGIES" :key="s.value"
          class="chip" :class="{ active: store.routeStrategy === s.value }"
          @click="store.setRouteStrategy(s.value)"
        >{{ s.label }}</button>
      </div>
    </div>

    <button
      class="primary"
      :disabled="!store.routeOrigin || !store.routeDestination || store.routePlanLoading"
      @click="store.loadRoutePlan()"
    >
      {{ store.routePlanLoading ? '规划中…' : '开始规划' }}
    </button>

    <div v-if="store.routePlanError" class="state err">{{ store.routePlanError }}</div>
    <div v-else-if="store.routePlanNotice" class="state notice">{{ store.routePlanNotice }}</div>

    <!-- 方案列表 -->
    <template v-if="store.routePlanResult">
      <div class="section-label">
        可选方案
        <span class="count">{{ store.routePlanResult.alternatives.length }}</span>
      </div>
      <div class="alternatives">
        <button
          v-for="alt in store.routePlanResult.alternatives" :key="alt.id"
          class="alt-card" :class="{ active: alt.id === selectedAlt?.id }"
          @click="store.selectRouteAlternative(alt.id)"
        >
          <div class="alt-main">
            <span class="alt-duration">{{ fmtDuration(alt.totalDurationSec) }}</span>
            <span v-if="alt.totalCost != null" class="alt-cost">¥{{ alt.totalCost.toFixed(2) }}</span>
          </div>
          <div class="alt-meta">
            <span>{{ fmtDistance(alt.totalDistanceM) }}</span>
            <span>换乘 {{ alt.transfers }} 次</span>
            <span>步行 {{ fmtDistance(alt.walkingDistanceM) }}</span>
          </div>
          <div class="alt-tags">
            <span v-for="tag in alt.tags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </button>
      </div>
    </template>

    <!-- 选中方案的分段详情 -->
    <template v-if="selectedAlt">
      <div class="section-label">行程详情</div>
      <div class="segments">
        <div v-for="(seg, index) in selectedAlt.segments" :key="index" class="segment">
          <span class="seg-icon" :class="seg.type">
            {{ seg.type === 'walk' ? '🚶' : seg.type === 'metro' ? '🚇' : '🚌' }}
          </span>
          <div class="seg-info">
            <div class="seg-name" :class="seg.type">{{ segmentLabel(seg) }}</div>
            <div class="seg-meta">{{ segmentMeta(seg) }}</div>
            <div v-if="seg.type !== 'walk' && seg.direction" class="seg-dir">{{ seg.direction }}</div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="!store.routePlanResult && !store.routePlanLoading && !store.routePlanError && !store.routePlanNotice" class="foot-hint">
      先点击两个「地图选点」按钮分别选取起点和终点；两端坐标齐备后自动规划最短出行方案。
    </div>
  </div>
</template>

<style scoped>
.route-panel {
  position: absolute;
  top: 14px;
  left: 60px;
  width: 300px;
  max-height: calc(100% - 180px);
  overflow-y: auto;
  background: rgba(14, 22, 38, 0.92);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  padding: 14px;
  z-index: 15;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.title { font-size: 13px; font-weight: 600; color: #e8f1fb; }
.clear {
  padding: 2px 8px;
  font-size: 11px;
  color: #8aa0be;
  background: #111c30;
  border: 1px solid #1b2a41;
  border-radius: 4px;
  cursor: pointer;
}
.clear:hover { color: #35c8e8; border-color: #35c8e8; }

.endpoints {
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 6px;
  padding: 8px;
}
.endpoint-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.origin { background: #3ddc97; }
.dot.destination { background: #ff6b6b; }
.endpoint-info { flex: 1; min-width: 0; }
.ep-label { display: block; font-size: 10px; color: #6d85a6; }
.ep-coord {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #c5d4e8;
  font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-btn {
  flex: none;
  padding: 4px 8px;
  font-size: 11px;
  color: #35c8e8;
  background: rgba(53, 200, 232, 0.1);
  border: 1px solid rgba(53, 200, 232, 0.45);
  border-radius: 4px;
  cursor: pointer;
}
.pick-btn:hover { background: rgba(53, 200, 232, 0.18); }
.pick-btn.active {
  color: #0a101c;
  background: #35c8e8;
  border-color: #35c8e8;
}
.swap {
  width: 100%;
  margin-top: 6px;
  padding: 4px 8px;
  font-size: 11px;
  color: #8aa0be;
  background: transparent;
  border: 1px dashed #1b2a41;
  border-radius: 4px;
  cursor: pointer;
}
.swap:hover:not(:disabled) { color: #35c8e8; border-color: #35c8e8; }
.swap:disabled { opacity: .5; cursor: default; }

.pick-hint {
  margin-top: 8px;
  padding: 6px 9px;
  font-size: 11px;
  color: #35c8e8;
  background: rgba(53, 200, 232, 0.1);
  border: 1px solid rgba(53, 200, 232, 0.3);
  border-radius: 4px;
}

.field { margin-top: 12px; }
.field-label { display: block; font-size: 11px; color: #6d85a6; margin-bottom: 6px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  flex: 0 0 auto;
  padding: 5px 9px;
  font-size: 11px;
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
  margin-top: 12px;
  padding: 7px 10px;
  font-size: 12px;
  color: #0a101c;
  background: #35c8e8;
  border: 1px solid #35c8e8;
  border-radius: 5px;
  cursor: pointer;
}
.primary:disabled { opacity: .5; cursor: default; }

.state { margin-top: 10px; font-size: 12px; color: #6d85a6; }
.state.err { color: #ff7a7a; }
.state.notice {
  padding: 8px 10px;
  color: #f2c46a;
  background: rgba(242, 166, 90, .1);
  border: 1px solid rgba(242, 166, 90, .35);
  border-radius: 4px;
  line-height: 1.6;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 8px;
  font-size: 11px;
  color: #6d85a6;
}
.count {
  padding: 0 6px;
  border-radius: 8px;
  color: #35c8e8;
  background: rgba(53, 200, 232, .12);
}
.alternatives { display: flex; flex-direction: column; gap: 7px; }
.alt-card {
  text-align: left;
  padding: 8px 10px;
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-left: 2px solid transparent;
  border-radius: 5px;
  cursor: pointer;
}
.alt-card:hover { border-color: rgba(53, 200, 232, .45); }
.alt-card.active {
  border-color: #35c8e8;
  border-left-color: #35c8e8;
  background: rgba(53, 200, 232, .08);
}
.alt-main { display: flex; align-items: baseline; justify-content: space-between; }
.alt-duration { font-size: 14px; font-weight: 600; color: #e8f1fb; }
.alt-cost { font-size: 12px; color: #f2a65a; }
.alt-meta {
  display: flex;
  gap: 10px;
  margin-top: 3px;
  font-size: 11px;
  color: #8aa0be;
}
.alt-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.tag {
  padding: 1px 6px;
  font-size: 10px;
  color: #3ddc97;
  background: rgba(61, 220, 151, .12);
  border-radius: 4px;
}

.segments { display: flex; flex-direction: column; gap: 8px; }
.segment {
  display: flex;
  gap: 8px;
  padding: 7px 9px;
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 5px;
}
.seg-icon { flex: none; font-size: 13px; line-height: 1.4; }
.seg-info { min-width: 0; }
.seg-name { font-size: 12px; color: #e8f1fb; }
.seg-name.walk { color: #8aa0be; font-weight: 400; }
.seg-name.metro { color: #b39dff; }
.seg-name.bus { color: #6fa8ff; }
.seg-meta { margin-top: 2px; font-size: 11px; color: #8aa0be; line-height: 1.5; }
.seg-dir { margin-top: 1px; font-size: 10px; color: #5a7192; }

.foot-hint {
  margin-top: 12px;
  font-size: 11px;
  color: #5a7192;
  border-top: 1px solid #1b2a41;
  padding-top: 10px;
  line-height: 1.6;
}
</style>
