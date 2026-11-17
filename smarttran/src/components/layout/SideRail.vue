<script setup lang="ts">
/**
 * 左侧功能图标栏
 *
 * 点击切换 store.railView，工作台右侧（属性面板位）显示对应功能面板：
 * - workbench  工作台（默认属性面板）
 * - layers     图层（底图切换 + 图层开关，面板悬浮于地图左上）
 * - route      路线规划（地图选点 + 公交 / 地铁方案）
 * - analysis   空间分析（页面框架）
 * - measure    测量（测距 / 测面积，OpenLayers 原生交互）
 * - weather    天气（成都 + 各区县实时天气）
 */

import { useMapStore, type RailView } from '@/stores/mapStore'

interface NavItem { key: RailView; label: string; icon: string }

const items: NavItem[] = [
  { key: 'workbench', label: '工作台', icon: '🗂' },
  { key: 'layers', label: '图层', icon: '🗺' },
  { key: 'route', label: '路线', icon: '🧭' },
  { key: 'analysis', label: '空间分析', icon: '📊' },
  { key: 'measure', label: '测距', icon: '📏' },
  { key: 'weather', label: '天气', icon: '🌦' },
]

const simulationItem: NavItem = { key: 'simulation', label: '线路模拟', icon: '▶' }
const store = useMapStore()

function onClick(item: NavItem): void {
  // 再点一次当前项 → 回到工作台
  store.setRailView(store.railView === item.key ? 'workbench' : item.key)
}
</script>

<template>
  <nav class="side-rail">
    <button
      v-if="store.mode === '3d' && store.networkMode === 'metro'"
      class="rail-btn" :class="{ active: store.railView === simulationItem.key }"
      :title="simulationItem.label"
      @click="onClick(simulationItem)"
    >
      <span class="ico">{{ simulationItem.icon }}</span>
      <span class="lbl">{{ simulationItem.label }}</span>
    </button>
    <button
      v-for="it in items" :key="it.key"
      class="rail-btn" :class="{ active: store.railView === it.key }"
      :title="it.label"
      @click="onClick(it)"
    >
      <span class="ico">{{ it.icon }}</span>
      <span class="lbl">{{ it.label }}</span>
    </button>
    <div class="spacer" />
    <button class="rail-btn" title="设置">⚙</button>
  </nav>
</template>

<style scoped>
.side-rail {
  width: 48px;
  background: #0a101c;
  border-right: 1px solid #1b2a41;
  display: flex;
  flex-direction: column;
  padding: 10px 0;
}
.rail-btn {
  width: 48px;
  padding: 8px 0;
  background: transparent;
  border: none;
  color: #6d85a6;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  transition: all .15s;
}
.rail-btn:hover { color: #c5d4e8; }
.rail-btn.active {
  color: #35c8e8;
  background: linear-gradient(90deg, rgba(53,200,232,.18), transparent);
  border-left: 2px solid #35c8e8;
}
.rail-btn:disabled { opacity: .45; cursor: not-allowed; }
.rail-btn .ico { font-size: 16px; }
.spacer { flex: 1; }
</style>
