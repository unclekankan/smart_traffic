<script setup lang="ts">
/**
 * 左下角地图图例
 *
 * 按当前交通网络切换图形语义：
 * - 地铁：普通站、换乘站、选中对象，线路按编号配色
 * - 公交：GeoServer WMS 渲染的线路与站点（配色由服务端样式决定）
 */

import { PALETTE } from '@/common/constants/colors'
import { routeColor } from '@/map2d/layers/roads'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()

/** 地铁线路配色示例（取前若干条线路的实际配色） */
const lineSwatches = [1, 2, 3, 4, 5].map((n) => routeColor(n))

/** 公交 WMS 线路的示例色带（服务端样式为多色，这里仅示意） */
const BUS_SWATCHES = ['#c96ee6', '#7b5cff', '#2fb7c9', '#e05c8a', '#6cc05a']
</script>

<template>
  <div class="legend-card">
    <template v-if="store.networkMode === 'bus'">
      <div class="legend-title">公交图例</div>
      <div class="legend-list">
        <div class="legend-item">
          <span class="line-swatches">
            <i v-for="(c, i) in BUS_SWATCHES" :key="i" :style="{ background: c }" />
          </span>
          <span class="label">公交线路</span>
          <span class="note">服务端配色</span>
        </div>
        <div class="legend-item">
          <span class="dot-bus" />
          <span class="label">公交站点</span>
          <span class="note">蓝色圆点</span>
        </div>
        <div class="legend-item legend-source">数据来源：GeoServer WMS</div>
      </div>
    </template>
    <template v-else>
      <div class="legend-title">地铁图例</div>
      <div class="legend-list">
        <div class="legend-item">
          <span class="swatch" :style="{ background: PALETTE.accent }" />
          <span class="label">普通站</span>
          <span class="note">单线车站</span>
        </div>
        <div class="legend-item">
          <span class="dot-transfer" />
          <span class="label">换乘站</span>
          <span class="note">2 条及以上线路</span>
        </div>
        <div class="legend-item">
          <span class="swatch" :style="{ background: PALETTE.accentLight }" />
          <span class="label">选中对象</span>
          <span class="note">青色高亮</span>
        </div>
        <div class="legend-item">
          <span class="line-swatches">
            <i v-for="(c, i) in lineSwatches" :key="i" :style="{ background: c }" />
          </span>
          <span class="label">线路</span>
          <span class="note">按线路编号配色</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.legend-card {
  position: absolute;
  left: 14px;
  bottom: 14px;
  width: 200px;
  padding: 12px 14px;
  background: rgba(14, 22, 38, 0.92);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  z-index: 15;
}
.legend-title { font-size: 12px; color: #e8f1fb; font-weight: 600; margin-bottom: 8px; }
.legend-list { display: flex; flex-direction: column; gap: 6px; }
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.swatch { width: 22px; height: 4px; border-radius: 2px; }
.dot-transfer { width: 10px; height: 10px; border-radius: 50%; background: #35c8e8; }
.dot-bus {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4a9eff;
  border: 1px solid #cfe6ff;
}
.legend-source { font-size: 10px; color: #5a7192; margin-top: 2px; }
.line-swatches { display: flex; gap: 2px; width: 22px; }
.line-swatches i { flex: 1; height: 4px; border-radius: 1px; }
.label { color: #c5d4e8; min-width: 56px; }
.note { color: #6d85a6; font-size: 11px; }
</style>
