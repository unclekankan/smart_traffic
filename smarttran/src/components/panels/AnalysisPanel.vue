<script setup lang="ts">
/**
 * 底部空间分析结果面板
 *
 * - 空态：尚未执行分析
 * - 有结果：缓冲区分组、命中对象表、导出 CSV
 */

import { computed } from 'vue'
import { useMapStore } from '@/stores/mapStore'
import { downloadCsv } from '@/tools'

const store = useMapStore()

const r = computed(() => store.bufferResult)

function exportCsv(): void {
  const res = r.value
  if (!res) return
  const header = ['对象 ID', '名称', '类型', '距离(米)', '空间关系', '业务状态']
  const rows = res.hits.map((h) => [h.id, h.name, h.typeText, h.distanceM, h.relation, h.status])
  downloadCsv(`${res.batchId}_分析结果.csv`, header, rows)
}

function clear(): void {
  store.clearBuffer()
}
</script>

<template>
  <div class="analysis-panel" :class="{ 'has-result': !!r }">
    <div class="analysis-head">
      <template v-if="r">
        <div class="head-left">
          <span class="dot ok" />
          空间分析结果
          <span class="badge ok">完成</span>
          <span class="batch">{{ r.batchId }}</span>
          <span class="meta">{{ r.radiusM }} m · 命中 {{ r.hits.length }} 个对象</span>
        </div>
        <div class="head-actions">
          <button class="a-btn" @click="exportCsv">⬇ 导出 CSV</button>
          <button class="a-btn" @click="clear">✕ 清除</button>
        </div>
      </template>
      <template v-else>
        <div class="head-left empty">
          <span class="dot" />
          空间分析结果
          <span class="muted">尚未执行分析</span>
        </div>
        <div class="head-actions">
          <span class="hint">选中车站后点击「缓冲区分析」</span>
        </div>
      </template>
    </div>

    <div class="analysis-body" v-if="r">
      <div class="summary">
        <div class="sum-item"><span class="l">分析范围</span><span class="v">{{ r.areaKm2 }} km²</span></div>
        <div class="sum-item"><span class="l">命中道路</span><span class="v">{{ r.hits.filter(h => h.kind === 'road').length }} 条</span></div>
        <div class="sum-item"><span class="l">命中车站</span><span class="v">{{ r.hits.filter(h => h.kind === 'station').length }} 座</span></div>
      </div>
      <table class="hit-table">
        <thead>
          <tr><th>ID</th><th>名称</th><th>类型</th><th>距离</th><th>关系</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="h in r.hits" :key="h.id">
            <td>{{ h.id }}</td>
            <td>{{ h.name }}</td>
            <td>{{ h.typeText }}</td>
            <td>{{ h.distanceM }} m</td>
            <td>{{ h.relation }}</td>
            <td>{{ h.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.analysis-panel {
  position: absolute;
  left: 230px;
  right: 294px;
  bottom: 28px;
  background: rgba(14, 22, 38, 0.95);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  overflow: hidden;
  z-index: 15;
}
.analysis-panel.empty { /* placeholder */ }
.analysis-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 14px; background: #0d1424; border-bottom: 1px solid #1b2a41;
}
.head-left { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #c5d4e8; }
.head-left .dot { width: 7px; height: 7px; border-radius: 50%; background: #5a7192; }
.head-left .dot.ok { background: #3ddc97; }
.badge { font-size: 11px; padding: 1px 8px; border-radius: 8px; }
.badge.ok { background: rgba(61, 220, 151, .15); color: #3ddc97; }
.batch { color: #35c8e8; font-size: 12px; }
.meta { color: #6d85a6; font-size: 12px; }
.muted { color: #6d85a6; font-size: 12px; }
.head-actions { display: flex; align-items: center; gap: 8px; }
.a-btn { font-size: 12px; padding: 4px 10px; background: #111c30; border: 1px solid #1b2a41; border-radius: 4px; color: #8aa0be; cursor: pointer; }
.a-btn:hover { color: #35c8e8; border-color: #35c8e8; }
.hint { font-size: 11px; color: #5a7192; }

.analysis-body { padding: 12px 14px; }
.summary { display: flex; gap: 18px; margin-bottom: 10px; }
.sum-item .l { font-size: 11px; color: #6d85a6; margin-right: 6px; }
.sum-item .v { font-size: 13px; color: #e8f1fb; font-weight: 600; }

.hit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.hit-table th, .hit-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #1b2a41; }
.hit-table th { color: #6d85a6; font-weight: 500; background: #0d1424; }
.hit-table td { color: #c5d4e8; }
</style>
