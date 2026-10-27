<script setup lang="ts">
/**
 * 地图右上工具条：地铁 / 公交网络切换、2D / 3D 切换、视角复位、全屏
 *
 * 网络切换与图层管理面板联动：切到「公交」后，图层面板展示
 * 公交线路 / 公交站点两个 GeoServer WMS 图层开关。
 * 3D 暂未实现时按钮置灰（保留接口位）。
 */

import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()

function toggleFullscreen(): void {
  const el = document.querySelector('.map-stage') as HTMLElement | null
  if (!el) return
  if (!document.fullscreenElement) el.requestFullscreen?.()
  else document.exitFullscreen?.()
}
</script>

<template>
  <div class="map-toolbar">
    <div class="mode-switch">
      <button
        class="mode-btn"
        :class="{ active: store.networkMode === 'metro' }"
        title="显示地铁线路与站点"
        @click="store.setNetworkMode('metro')"
      >地铁</button>
      <button
        class="mode-btn"
        :class="{ active: store.networkMode === 'bus' }"
        title="显示公交线路与站点（GeoServer WMS）"
        @click="store.setNetworkMode('bus')"
      >公交</button>
    </div>
    <div class="mode-switch">
      <button
        class="mode-btn"
        :class="{ active: store.mode === '2d' }"
        @click="store.setMode('2d')"
      >2D</button>
      <button class="mode-btn" :class="{ active: store.mode === '3d' }" disabled>
        3D
        <span class="tag">即将上线</span>
      </button>
    </div>
    <div class="tool-actions">
      <button class="tool-btn" @click="store.requestResetView()" title="视角复位">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>
      </button>
      <button class="tool-btn" @click="toggleFullscreen" title="全屏">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.map-toolbar {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 20;
}
.mode-switch {
  display: flex;
  background: rgba(14, 22, 38, 0.92);
  border: 1px solid #1b2a41;
  border-radius: 6px;
  overflow: hidden;
}
.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 16px;
  background: transparent;
  border: none;
  color: #8aa0be;
  font-size: 13px;
  cursor: pointer;
  transition: all .2s;
}
.mode-btn.active {
  background: #35c8e8;
  color: #0a101c;
  font-weight: 600;
}
.mode-btn:disabled {
  opacity: .5;
  cursor: not-allowed;
}
.tag {
  font-size: 10px;
  background: rgba(255,255,255,.12);
  padding: 1px 6px;
  border-radius: 8px;
}
.tool-actions {
  display: flex;
  gap: 6px;
}
.tool-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: rgba(14, 22, 38, 0.92);
  border: 1px solid #1b2a41;
  border-radius: 6px;
  color: #8aa0be;
  cursor: pointer;
  transition: all .2s;
}
.tool-btn:hover { color: #35c8e8; border-color: #35c8e8; }
</style>
