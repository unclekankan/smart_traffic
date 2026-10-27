<script setup lang="ts">
/**
 * 底部状态栏：坐标系、鼠标坐标、数据版本
 */

import { computed } from 'vue'
import { formatLngLat } from '@/tools'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()
const coordText = computed(() => store.pointer ? formatLngLat(store.pointer) : '—')
</script>

<template>
  <footer class="status-bar">
    <div class="left">
      <span>坐标系 WGS 84 / EPSG:4326</span>
      <span class="sep">|</span>
      <span>投影 EPSG:4326</span>
      <span class="sep">|</span>
      <span>经度 {{ coordText }}</span>
      <span class="sep">|</span>
      <span>比例尺 1:6,000</span>
    </div>
    <div class="right">
      <span>示例数据版本 2026.10</span>
      <span class="sep">|</span>
      <span>非运行中 GIS 服务</span>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  height: 26px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 14px;
  background: #0a101c;
  border-top: 1px solid #1b2a41;
  font-size: 11px;
  color: #6d85a6;
}
.left, .right { display: flex; align-items: center; gap: 10px; }
.sep { color: #2a3a55; }
</style>
