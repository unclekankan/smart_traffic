<script setup lang="ts">
/**
 * 底部缓冲区覆盖统计面板
 *
 * 展示后端 PostGIS 计算的覆盖统计（覆盖面积 / 缓冲总面积 / 重叠面积 / 重叠站点），
 * 提供缓冲区图层透明度调节、CSV 导出与清除。无结果时不渲染。
 */

import { computed } from 'vue'

import { useMapStore } from '@/stores/mapStore'
import { COVERAGE_RAMP } from '@/common/constants/colors'
import { downloadCsv } from '@/tools'
import type { CoverageKind } from '@/common/types/analysis'

const KIND_LABEL: Record<CoverageKind, string> = {
  metro: '地铁站',
  bus: '公交站',
  all: '全部站点',
}

const store = useMapStore()

const r = computed(() => store.coverageResult)
const kindText = computed(() => (r.value ? KIND_LABEL[r.value.kind] : ''))

function onOpacity(e: Event): void {
  store.setCoverageOpacity(Number((e.target as HTMLInputElement).value))
}

function exportCsv(): void {
  const res = r.value
  if (!res) return
  const stats = res.stats
  downloadCsv('缓冲区覆盖统计.csv', ['指标', '数值'], [
    ['服务半径(米)', res.radiusM],
    ['站点范围', KIND_LABEL[res.kind]],
    ['分析站点数', stats.stationCount],
    ['覆盖面积(km²)', stats.coveredAreaKm2],
    ['缓冲总面积(km²)', stats.bufferAreaKm2],
    ['重叠面积(km²)', stats.overlapAreaKm2],
    ['重叠站点数', stats.overlapStationCount],
  ])
}
</script>

<template>
  <div v-if="r" class="analysis-panel">
    <div class="analysis-head">
      <div class="head-left">
        <span class="dot ok" />
        缓冲区覆盖分析
        <span class="badge ok">完成</span>
        <span class="meta">
          {{ r.radiusM }} m · {{ kindText }} · {{ r.stats.stationCount }} 座站点
        </span>
      </div>
      <div class="head-actions">
        <label class="opacity">
          <span>图层透明度</span>
          <input
            type="range" min="0.05" max="1" step="0.05"
            :value="store.coverageOpacity"
            @input="onOpacity"
          />
          <span class="pct">{{ Math.round(store.coverageOpacity * 100) }}%</span>
        </label>
        <button class="a-btn" @click="exportCsv">⬇ 导出 CSV</button>
        <button class="a-btn" @click="store.clearCoverage()">✕ 清除</button>
      </div>
    </div>

    <div class="analysis-body">
      <div class="summary">
        <div class="sum-item">
          <span class="l">覆盖面积</span>
          <span class="v">{{ r.stats.coveredAreaKm2.toFixed(2) }} km²</span>
        </div>
        <div class="sum-item">
          <span class="l">缓冲总面积</span>
          <span class="v">{{ r.stats.bufferAreaKm2.toFixed(2) }} km²</span>
        </div>
        <div class="sum-item">
          <span class="l">重叠面积</span>
          <span class="v">{{ r.stats.overlapAreaKm2.toFixed(2) }} km²</span>
        </div>
        <div class="sum-item">
          <span class="l">重叠站点</span>
          <span class="v">{{ r.stats.overlapStationCount }} 座</span>
        </div>
      </div>
      <div class="tip">
        按站点服务范围叠加密度分级，连续色带呈现覆盖强弱（网格 {{ r.cellCount }} 个）
      </div>
      <div class="legend">
        <span class="legend-title">覆盖密度</span>
        <span v-for="(c, i) in COVERAGE_RAMP" :key="i" class="legend-item">
          <i :style="{ background: c.fill, borderColor: c.stroke }" />
          {{ i + 1 }}
        </span>
        <span class="legend-note">稀疏 → 密集</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analysis-panel {
  position: absolute;
  /* 铺满地图舞台底部（右侧属性面板在舞台之外，无需再让位） */
  left: 60px;
  right: 24px;
  bottom: 28px;
  background: rgba(14, 22, 38, 0.95);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  overflow: hidden;
  z-index: 15;
}
.analysis-head {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 8px;
  padding: 8px 14px; background: #0d1424; border-bottom: 1px solid #1b2a41;
}
.head-left { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #c5d4e8; }
.head-left .dot { width: 7px; height: 7px; border-radius: 50%; background: #3ddc97; }
.badge { font-size: 11px; padding: 1px 8px; border-radius: 8px; }
.badge.ok { background: rgba(61, 220, 151, .15); color: #3ddc97; }
.meta { color: #6d85a6; font-size: 12px; }
.head-actions { display: flex; align-items: center; gap: 10px; }
.opacity {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #6d85a6;
}
.opacity input { width: 90px; accent-color: #35c8e8; cursor: pointer; }
.pct { width: 30px; text-align: right; color: #8aa0be; }
.a-btn { font-size: 12px; padding: 4px 10px; background: #111c30; border: 1px solid #1b2a41; border-radius: 4px; color: #8aa0be; cursor: pointer; }
.a-btn:hover { color: #35c8e8; border-color: #35c8e8; }

.analysis-body { padding: 12px 14px; }
.summary { display: flex; gap: 26px; margin-bottom: 8px; flex-wrap: wrap; }
.sum-item .l { font-size: 11px; color: #6d85a6; margin-right: 6px; }
.sum-item .v { font-size: 14px; color: #e8f1fb; font-weight: 600; }
.tip { font-size: 11px; color: #5a7192; }
.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 7px;
  font-size: 11px;
  color: #8aa0be;
}
.legend-title { color: #6d85a6; }
.legend-item { display: flex; align-items: center; gap: 4px; }
.legend-item i {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  border: 1px solid transparent;
  display: inline-block;
}
.legend-note { color: #5a7192; }
</style>
