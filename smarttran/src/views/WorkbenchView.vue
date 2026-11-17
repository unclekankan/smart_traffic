/**
 * 工作台视图：组装顶栏 / 左栏 / 地图舞台 / 右属性 / 底栏
 *
 * 地图舞台上的浮动面板由左侧功能栏（SideRail → store.railView）驱动：
 * layers → 图层面板，analysis → 空间分析框架，
 * route → 路线规划，measure → 测距占位，weather → 天气面板。
 */

<script setup lang="ts">
import TopBar from '@/components/layout/TopBar.vue'
import SideRail from '@/components/layout/SideRail.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import MapContainer from '@/components/map/MapContainer.vue'
import MapToolbar from '@/components/map/MapToolbar.vue'
import MapLegend from '@/components/map/MapLegend.vue'
import LayerPanel from '@/components/panels/LayerPanel.vue'
import PropertyPanel from '@/components/panels/PropertyPanel.vue'
import AnalysisPanel from '@/components/panels/AnalysisPanel.vue'
import AnalysisHomePanel from '@/components/panels/AnalysisHomePanel.vue'
import NearbyResultsPanel from '@/components/panels/NearbyResultsPanel.vue'
import RoutePlanPanel from '@/components/panels/RoutePlanPanel.vue'
import MeasurePanel from '@/components/panels/MeasurePanel.vue'
import WeatherPanel from '@/components/panels/WeatherPanel.vue'
import BusRouteList from '@/components/panels/BusRouteList.vue'
import BusRouteControlPopup from '@/components/panels/BusRouteControlPopup.vue'
import MetroSimulationPanel from '@/components/panels/MetroSimulationPanel.vue'
import { useMapStore } from '@/stores/mapStore'

const store = useMapStore()
</script>

<template>
  <div class="workbench">
    <TopBar />
    <div class="workbench-body">
      <SideRail />
      <main class="map-stage">
        <MapContainer />
        <MapToolbar />
        <MetroSimulationPanel />
        <!-- 左侧功能面板：切换时淡入淡出 + 轻微下滑 -->
        <Transition name="float-panel">
          <LayerPanel v-if="store.railView === 'layers'" key="layers" />
          <RoutePlanPanel v-else-if="store.railView === 'route'" key="route" />
          <AnalysisHomePanel v-else-if="store.railView === 'analysis'" key="analysis" />
          <MeasurePanel v-else-if="store.railView === 'measure'" key="measure" />
          <WeatherPanel v-else-if="store.railView === 'weather'" key="weather" />
        </Transition>
        <!-- 覆盖分析结果面板自带色带图例，此时隐藏左下角基础图例避免遮挡 -->
        <MapLegend v-if="!store.coverageResult" />
        <AnalysisPanel />
        <NearbyResultsPanel v-if="store.railView === 'analysis' && (store.nearbyResult || store.stationBufferResult)" />
        <!-- 公交线路：线路列表 + 选中线路控制弹窗 -->
        <BusRouteList />
        <BusRouteControlPopup />
      </main>
      <!-- 右侧属性面板：地铁与公交（线路 / 站点）统一使用同一套详情 UI -->
      <PropertyPanel />
    </div>
    <StatusBar />
  </div>
</template>

<style scoped>
.workbench {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0a101c;
}
.workbench-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.map-stage {
  flex: 1;
  position: relative;
  min-width: 0;
  overflow: hidden;
}

/* 左侧浮动面板切换过渡（子组件根元素带父级 scope，可直接命中） */
.float-panel-enter-active,
.float-panel-leave-active {
  transition: opacity .2s ease, transform .2s ease;
}
.float-panel-enter-from,
.float-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(.98);
}
</style>
