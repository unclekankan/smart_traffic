<script setup lang="ts">
/**
 * 测量面板（左侧功能栏「测距」激活时显示）
 *
 * 交互由 2D 引擎基于 OpenLayers 原生 API 完成（Draw + ol/sphere），
 * 本组件只负责模式切换、结果展示与清除，不接触任何地图库。
 */

import { computed } from 'vue'

import type { MeasureMode } from '@/common/types/measure'
import { formatArea, formatDistance } from '@/common/utils/measureFormat'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()

const result = computed(() => store.measureResult)

/** 切换模式；再次点击当前模式则退出测量 */
function toggle(mode: MeasureMode): void {
  store.setMeasureMode(store.measureMode === mode ? 'none' : mode)
}
</script>

<template>
  <div class="measure-panel">
    <div class="panel-head">
      <span class="title">测量工具</span>
      <button
        v-if="store.measureMode !== 'none' || result"
        class="clear-btn"
        title="清除测量结果"
        @click="store.clearMeasure()"
      >清除</button>
    </div>

    <div class="mode-row">
      <button
        class="mode-card"
        :class="{ active: store.measureMode === 'distance' }"
        @click="toggle('distance')"
      >
        <span class="ico">📏</span>
        <span class="label">测距</span>
      </button>
      <button
        class="mode-card"
        :class="{ active: store.measureMode === 'area' }"
        @click="toggle('area')"
      >
        <span class="ico">📐</span>
        <span class="label">测面积</span>
      </button>
    </div>

    <p v-if="store.measureMode === 'none'" class="tip">
      选择测距或测面积后，在地图上单击取点、双击结束；再次点击当前模式可退出。
    </p>
    <template v-else>
      <p class="tip">
        {{ store.measureMode === 'distance' ? '单击取点，双击结束折线。' : '单击取点，双击或回到起点闭合面。' }}
        再次点击当前模式可退出。
      </p>

      <div v-if="!result" class="empty">在地图上单击开始取点…</div>

      <div v-else-if="result.mode === 'distance'" class="result">
        <div class="result-main">
          <span class="k">总距离</span>
          <span class="v">{{ formatDistance(result.value) }}</span>
        </div>
        <div class="result-sub">{{ result.segments.length }} 段 · {{ result.vertexCount }} 个取点</div>
        <div class="segment-list">
          <div v-for="(seg, i) in result.segments" :key="i" class="segment-row">
            <span class="seg-label">第 {{ i + 1 }} 段</span>
            <span class="seg-value">{{ formatDistance(seg) }}</span>
          </div>
        </div>
      </div>

      <div v-else class="result">
        <div class="result-main">
          <span class="k">面积</span>
          <span class="v">{{ formatArea(result.value) }}</span>
        </div>
        <div class="result-sub">{{ result.vertexCount }} 个顶点</div>
        <div class="segment-row">
          <span class="seg-label">周长</span>
          <span class="seg-value">{{ formatDistance(result.perimeter) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.measure-panel {
  position: absolute;
  top: 14px;
  left: 60px;
  width: 236px;
  max-height: calc(100% - 120px);
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
.clear-btn {
  background: transparent;
  border: 1px solid #1b2a41;
  border-radius: 4px;
  color: #8aa0be;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.clear-btn:hover { color: #e9546b; border-color: #e9546b; }

.mode-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 6px;
  color: #8aa0be;
  cursor: pointer;
  transition: all .2s;
}
.mode-card:hover { border-color: #35c8e8; color: #c5d4e8; }
.mode-card.active {
  border-color: #35c8e8;
  background: rgba(53, 200, 232, 0.12);
  color: #35c8e8;
}
.mode-card .ico { font-size: 18px; }
.mode-card .label { font-size: 12px; }

.tip { font-size: 11px; color: #6d85a6; line-height: 1.7; margin: 10px 0 0; }
.empty {
  margin-top: 10px;
  padding: 14px 10px;
  text-align: center;
  font-size: 11px;
  color: #5a7192;
  background: #0d1424;
  border: 1px dashed #1b2a41;
  border-radius: 6px;
}

.result {
  margin-top: 10px;
  padding: 10px;
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 6px;
}
.result-main { display: flex; align-items: baseline; justify-content: space-between; }
.result-main .k { font-size: 11px; color: #6d85a6; }
.result-main .v { font-size: 18px; font-weight: 600; color: #35c8e8; }
.result-sub { font-size: 10px; color: #5a7192; margin-top: 2px; }
.segment-list { margin-top: 8px; max-height: 160px; overflow-y: auto; }
.segment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  border-top: 1px solid #16233a;
  font-size: 11px;
}
.seg-label { color: #6d85a6; }
.seg-value { color: #c5d4e8; }
</style>
