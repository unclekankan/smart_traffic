<script setup lang="ts">
/**
 * 空间分析面板（页面框架）
 *
 * 当前仅搭结构：分析类型列表 + 说明区。
 * 「缓冲区分析」已可用（选中车站后执行），其余类型为占位入口，功能后续接入。
 */

import { useMapStore } from '@/stores/mapStore'

interface AnalysisType {
  key: string
  name: string
  desc: string
  icon: string
  /** 是否已接入 */
  ready?: boolean
}

const types: AnalysisType[] = [
  { key: 'buffer', name: '缓冲区分析', desc: '以车站为圆心按半径检索周边路网与站点', icon: '⭕', ready: true },
  { key: 'overlay', name: '叠加分析', desc: '多图层空间叠加，提取交集 / 并集区域', icon: '🧩' },
  { key: 'path', name: '路径分析', desc: '起终点间最优路径与通达性评估', icon: '🔀' },
  { key: 'coverage', name: '覆盖分析', desc: '地铁站点服务半径覆盖率统计', icon: '📡' },
]

const store = useMapStore()

function onPick(t: AnalysisType): void {
  if (t.key === 'buffer') {
    // 已有能力：提示用户先选中车站
    store.setRailView('workbench')
  }
}
</script>

<template>
  <div class="analysis-home">
    <div class="panel-head">
      <span class="title">空间分析</span>
    </div>
    <div class="type-list">
      <button
        v-for="t in types" :key="t.key"
        class="type-card"
        :class="{ ready: t.ready }"
        @click="onPick(t)"
      >
        <span class="t-icon">{{ t.icon }}</span>
        <div class="t-info">
          <div class="t-name">
            {{ t.name }}
            <span v-if="t.ready" class="t-badge">可用</span>
            <span v-else class="t-badge soon">规划中</span>
          </div>
          <div class="t-desc">{{ t.desc }}</div>
        </div>
      </button>
    </div>
    <div class="foot-hint">「缓冲区分析」：回到工作台选中车站后，在右侧属性面板执行</div>
  </div>
</template>

<style scoped>
.analysis-home {
  position: absolute;
  top: 14px;
  left: 60px;
  width: 264px;
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
.type-card:hover { border-color: rgba(53, 200, 232, .5); }
.type-card.ready { border-color: rgba(61, 220, 151, .3); }
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
.foot-hint {
  margin-top: 12px;
  font-size: 11px;
  color: #5a7192;
  border-top: 1px solid #1b2a41;
  padding-top: 10px;
  line-height: 1.6;
}
</style>
