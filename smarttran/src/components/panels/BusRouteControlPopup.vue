<script setup lang="ts">
/**
 * 选中公交线路的浮动控制弹窗（右下角）
 *
 * 功能：
 * - 控制选中公交线路的**站点符号**（蓝圆白底）显隐
 * - 控制选中公交线路的**站点名称注记**显隐
 * - 可点"取消选中"快速清掉线路
 *
 * 与全局 LayerPanel 的公交 WMS 开关独立：此处只管**选中线路**的矢量叠加层，
 * LayerPanel 控制的是全量公交 WMS（覆盖 3048 条 + 13817 个站）。
 */

import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()
</script>

<template>
  <aside
    v-if="store.networkMode === 'bus' && store.selectedBusRoute !== null"
    class="bus-control-popup"
  >
    <header class="popup-header">
      <span class="title">选中线路控制</span>
    </header>
    <label class="popup-row">
      <input
        type="checkbox"
        :checked="store.busRouteStopsVisible"
        @change="store.setBusRouteStopsVisible(($event.target as HTMLInputElement).checked)"
      />
      <span>站点符号</span>
    </label>
    <label class="popup-row">
      <input
        type="checkbox"
        :checked="store.busRouteNamesVisible"
        @change="store.setBusRouteNamesVisible(($event.target as HTMLInputElement).checked)"
      />
      <span>站点名称</span>
    </label>
    <button class="popup-cancel" @click="store.selectBusRoute(null)">
      取消选中
    </button>
  </aside>
</template>

<style scoped>
.bus-control-popup {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 16;
  width: 200px;
  background: rgba(14, 22, 37, 0.96);
  border: 1px solid #22334f;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  overflow: hidden;
  /* 选中线路时的出现动画 */
  animation: bus-popup-in 0.2s ease;
}

@keyframes bus-popup-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

.popup-header {
  padding: 6px 12px;
  border-bottom: 1px solid #22334f;
  background: #0f1a2d;
}
.popup-header .title {
  font-size: 11px;
  color: #c5d5ed;
  font-weight: 600;
}

.popup-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: #e5eefc;
  cursor: pointer;
  user-select: none;
}
.popup-row:hover { background: rgba(53, 200, 232, 0.08); }
.popup-row input {
  accent-color: #35c8e8;
  cursor: pointer;
}

.popup-cancel {
  display: block;
  width: 100%;
  padding: 5px 12px;
  background: transparent;
  border: none;
  border-top: 1px solid #22334f;
  font-size: 11px;
  color: #7a94bb;
  cursor: pointer;
  text-align: left;
}
.popup-cancel:hover { background: rgba(255, 92, 92, 0.12); color: #ff8585; }
</style>
