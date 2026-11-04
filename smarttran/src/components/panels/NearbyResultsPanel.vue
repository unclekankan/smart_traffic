<script setup lang="ts">
import { computed } from 'vue'
import { useMapStore } from '@/stores/mapStore'
import type { StationKind } from '@/common/types/analysis'

const store = useMapStore()
const result = computed(() => store.nearbyResult)
const bufferResult = computed(() => store.stationBufferResult)
const bufferFeatures = computed(() => {
  const result = bufferResult.value
  if (!result) return []
  return [
    ...result.metroStops.features.map((feature) => ({ ...feature.properties, type: '地铁站', kind: 'metro' as const, geometry: feature.geometry })),
    ...result.busStops.features.map((feature) => ({ ...feature.properties, type: '公交站', kind: 'bus' as const, geometry: feature.geometry })),
    ...result.metroLines.features.map((feature) => ({ ...feature.properties, type: '地铁线路', geometry: feature.geometry })),
    ...result.busLines.features.map((feature) => ({ ...feature.properties, type: '公交线路', geometry: feature.geometry })),
  ]
})

function focusBufferStop(feature: (typeof bufferFeatures.value)[number]): void {
  if (!('kind' in feature) || feature.geometry.type !== 'Point') return
  store.setNetworkMode(feature.kind === 'bus' ? 'bus' : 'metro')
  const [lon, lat] = feature.geometry.coordinates
  store.focusNearbyStop({
    kind: feature.kind as StationKind,
    id: String(feature.id),
    name: feature.name,
    lon,
    lat,
    distanceM: 0,
  })
}

function focusBufferFeature(feature: (typeof bufferFeatures.value)[number]): void {
  if ('kind' in feature) {
    focusBufferStop(feature)
    return
  }
  if (feature.type === '地铁线路') {
    store.setNetworkMode('metro')
    store.focus({ kind: 'road', id: String(feature.id), name: feature.name })
  } else if (feature.type === '公交线路') {
    store.setNetworkMode('bus')
    store.selectBusRoute(Number(feature.id))
  }
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}
</script>

<template>
  <aside v-if="result || bufferResult" class="nearby-results" :aria-label="bufferResult ? '单站缓冲区分析结果' : '附近站点查询结果'">
    <header class="panel-head">
      <div>
        <div class="title">{{ bufferResult ? '缓冲区分析结果' : '附近站点' }}</div>
        <div class="summary" v-if="bufferResult">
          {{ bufferResult.station.name }} · 半径 {{ bufferResult.radiusM }} m · {{ bufferFeatures.length }} 个要素
        </div>
        <div class="summary" v-else>半径 {{ result!.radiusM }} m · {{ result!.stops.length }} 个结果</div>
      </div>
      <button
        class="icon-btn"
        :title="bufferResult ? '清除缓冲区结果' : '清除查询结果'"
        :aria-label="bufferResult ? '清除缓冲区结果' : '清除查询结果'"
        @click="bufferResult ? store.clearStationBuffer() : store.clearNearby()"
      >×</button>
    </header>
    <template v-if="bufferResult">
      <div class="buffer-stats">
        <span><i>地铁站</i><b>{{ bufferResult.counts.metroStops }}</b></span>
        <span><i>公交站</i><b>{{ bufferResult.counts.busStops }}</b></span>
        <span><i>地铁线</i><b>{{ bufferResult.counts.metroLines }}</b></span>
        <span><i>公交线</i><b>{{ bufferResult.counts.busLines }}</b></span>
      </div>
      <div v-if="!bufferFeatures.length" class="empty">该缓冲范围内没有交通要素</div>
      <div v-else class="stop-list">
        <component
          :is="'kind' in feature ? 'button' : 'div'"
          v-for="(feature, index) in bufferFeatures"
          :key="`${feature.type}-${feature.id}-${index}`"
          class="stop-row"
          :class="{ clickable: true }"
          @click="focusBufferFeature(feature)"
        >
          <span class="kind-badge">{{ feature.type }}</span>
          <span class="stop-name">{{ feature.name }}</span>
        </component>
      </div>
    </template>
    <template v-else-if="result">
      <div v-if="result.truncated" class="notice">结果数量较多，列表仅显示前 1000 个站点</div>
      <div v-if="!result.stops.length" class="empty">该范围内没有站点</div>
      <div v-else class="stop-list">
        <button
          v-for="s in result.stops" :key="`${s.kind}-${s.id}`"
          class="stop-row" @click="store.focusNearbyStop(s)"
        >
          <span class="kind-badge">{{ s.kind === 'metro' ? '地铁' : '公交' }}</span>
          <span class="stop-name">{{ s.name }}</span>
          <span class="stop-dist">{{ formatDistance(s.distanceM) }}</span>
        </button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.nearby-results {
  position: absolute;
  top: 10%;
  right: 14px;
  bottom: 108px;
  height: min(50%, 320px);
  min-height: 150px;
  display: flex;
  flex-direction: column;
  width: min(300px, calc(100% - 92px));
  background: rgba(14, 22, 38, .96);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  z-index: 16;
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: #0d1424;
  border-bottom: 1px solid #1b2a41;
}
.title { color: #e8f1fb; font-size: 16px; font-weight: 700; line-height: 1.25; }
.summary { color: #8298b5; font-size: 12px; margin-top: 4px; line-height: 1.4; }
.icon-btn {
  width: 28px;
  height: 28px;
  flex: none;
  color: #8aa0be;
  background: #111c30;
  border: 1px solid #1b2a41;
  border-radius: 4px;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.icon-btn:hover { color: #ff7a7a; border-color: #ff7a7a; }
.notice { padding: 8px 12px; color: #f2a65a; font-size: 11px; border-bottom: 1px solid #1b2a41; }
.stop-list { min-height: 0; overflow-y: auto; }
.stop-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  color: #c5d4e8;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(27, 42, 65, .7);
  cursor: default;
  font: inherit;
}
.stop-row.clickable { cursor: pointer; }
.stop-row:hover, .stop-row.clickable:hover { background: rgba(53, 200, 232, .08); }
.buffer-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  padding: 9px 12px;
  color: #8aa0be;
  background: rgba(13, 20, 36, .72);
  border-bottom: 1px solid rgba(27, 42, 65, .7);
  font-size: 11px;
}
.buffer-stats span { display: flex; justify-content: space-between; gap: 8px; }
.buffer-stats i { color: #8aa0be; font-style: normal; }
.buffer-stats b { color: #e8f1fb; font-size: 12px; font-weight: 600; }
.kind-badge { flex: none; color: #b8a83a; background: rgba(255, 227, 77, .12); padding: 2px 5px; border-radius: 3px; font-size: 10px; }
.stop-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.stop-dist { flex: none; color: #6d85a6; font-size: 11px; }
.empty { padding: 24px 12px; color: #8aa0be; font-size: 12px; text-align: center; }
</style>
