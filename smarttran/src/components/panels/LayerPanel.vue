<script setup lang="ts">
/**
 * 图层管理面板（左侧功能栏「图层」激活时显示）
 *
 * - 在线底图切换（OSM / 高德 / 天地图预留，见 map2d/config/basemaps）
 * - 业务图层可见性开关（2D/3D 同一套图层 id）
 *   地铁网络：线路 / 站点符号 / 站点名称 / 三维模型
 *   公交网络：公交线路 / 公交站点（GeoServer WMS）
 * - 路网明度滑块（控制整体亮度滤镜）
 */

import { computed } from 'vue'
import { layerRegistryFor, type LayerId } from '@/common/constants/layers'
import { BASEMAP_REGISTRY, isBasemapAvailable, TIANDITU_KEY } from '@/map2d/config/basemaps'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()

/** 当前网络对应的图层注册表 */
const registry = computed(() => layerRegistryFor(store.networkMode))

/** 图层数量摘要（地铁来自后端实际数据，公交为 WMS 服务） */
const summaryById = computed<Record<LayerId, string>>(() => ({
  roads: `${store.sceneStats.routes} 条线路`,
  stations: `${store.sceneStats.stops} 座站点`,
  stationLabels: `${store.sceneStats.stops} 个注记`,
  models3d: '换乘站体块',
  busRoutes: 'WMS 服务',
  busStops: 'WMS 服务',
  busStopNames: 'WMS 服务',
}))
</script>

<template>
  <div class="layer-panel">
    <div class="panel-head">
      <span class="title">图层管理</span>
    </div>

    <div class="section-label">在线底图</div>
    <div class="basemap-list">
      <label
        v-for="bm in BASEMAP_REGISTRY"
        :key="bm.id"
        class="basemap-row"
        :class="{ disabled: !isBasemapAvailable(bm) }"
        :title="bm.requiresKey && !TIANDITU_KEY ? '需配置天地图 API Key（map2d/config/basemaps.ts）' : bm.label"
      >
        <input
          type="radio"
          name="basemap"
          :checked="store.baseMapId === bm.id"
          :disabled="!isBasemapAvailable(bm)"
          @change="store.setBaseMap(bm.id)"
        />
        <span class="layer-label">{{ bm.label }}</span>
        <span v-if="bm.requiresKey && !TIANDITU_KEY" class="key-tag">需 Key</span>
      </label>
    </div>

    <div class="section-label">
      业务图层
      <span class="net-tag">{{ store.networkMode === 'bus' ? '公交 WMS' : '地铁' }}</span>
    </div>
    <div class="layer-list">
      <label
        v-for="layer in registry"
        :key="layer.id"
        class="layer-row"
        :title="layer.hint ?? layer.label"
      >
        <input
          type="checkbox"
          :checked="store.layerVisibility[layer.id]"
          @change="store.toggleLayer(layer.id)"
        />
        <span class="layer-label">{{ layer.label }}</span>
        <span class="layer-count">{{ summaryById[layer.id] }}</span>
      </label>
    </div>
    <p v-if="store.networkMode === 'metro'" class="layer-tip">站点符号与站点名称可分别开关：取消「站点名称」即可只保留站点圆点。</p>
    <p v-else class="layer-tip">公交线路、站点与站点名称均来自 GeoServer WMS（工作区 smart_triffic），可分别开关。</p>
    <div class="brightness">
      <div class="bri-row">
        <span>路网明度</span>
        <span class="val">{{ store.brightness }}%</span>
      </div>
      <input
        type="range" min="20" max="120" :value="store.brightness"
        @input="store.setBrightness(Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </div>
</template>

<style scoped>
.layer-panel {
  position: absolute;
  top: 14px;
  left: 60px;
  width: 210px;
  background: rgba(14, 22, 38, 0.92);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  padding: 14px;
  z-index: 15;
}
.panel-head { margin-bottom: 10px; }
.title { font-size: 13px; font-weight: 600; color: #e8f1fb; }
.section-label { font-size: 11px; color: #5a7192; margin: 10px 0 6px; display: flex; align-items: center; gap: 6px; }
.net-tag {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 8px;
  background: rgba(53, 200, 232, 0.14);
  color: #35c8e8;
}
.basemap-list { display: flex; flex-direction: column; gap: 7px; }
.basemap-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #c5d4e8;
  cursor: pointer;
}
.basemap-row.disabled { opacity: .45; cursor: not-allowed; }
.basemap-row input { accent-color: #35c8e8; }
.key-tag {
  font-size: 10px;
  color: #d9a13c;
  border: 1px solid rgba(217, 161, 60, .4);
  border-radius: 8px;
  padding: 0 6px;
}
.layer-list { display: flex; flex-direction: column; gap: 8px; }
.layer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #c5d4e8;
  cursor: pointer;
}
.layer-row input { accent-color: #35c8e8; }
.layer-label { flex: 1; }
.layer-count { font-size: 11px; color: #6d85a6; }
.layer-tip { font-size: 10px; color: #5a7192; line-height: 1.6; margin: 10px 0 0; }
.brightness { margin-top: 14px; border-top: 1px solid #1b2a41; padding-top: 12px; }
.bri-row { display: flex; justify-content: space-between; font-size: 12px; color: #8aa0be; margin-bottom: 6px; }
.val { color: #35c8e8; }
.brightness input[type=range] { width: 100%; accent-color: #35c8e8; }
</style>
