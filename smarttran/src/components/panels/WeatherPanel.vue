<script setup lang="ts">
/**
 * 天气面板（左侧功能栏「天气」激活时显示）
 *
 * 数据源：Open-Meteo 免费接口（无需 Key），一次请求成都全市 + 20 区县。
 * 展示：顶部成都市概览，下方各区县网格卡片。
 */

import { onMounted, ref } from 'vue'
import { fetchChengduWeather, type WeatherNow } from '@/common/services/weather'

const list = ref<WeatherNow[]>([])
const loading = ref(false)
const error = ref('')
const updatedAt = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    list.value = await fetchChengduWeather()
    updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '天气加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="weather-panel">
    <div class="panel-head">
      <span class="title">成都天气</span>
      <div class="head-right">
        <span v-if="updatedAt" class="updated">{{ updatedAt }} 更新</span>
        <button class="refresh-btn" :disabled="loading" title="刷新" @click="load">⟳</button>
      </div>
    </div>

    <div v-if="loading && !list.length" class="state">加载中…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>

    <template v-else-if="list.length">
      <!-- 成都市概览 -->
      <div class="city-card">
        <span class="city-icon">{{ list[0]!.icon }}</span>
        <div class="city-main">
          <div class="city-temp">{{ list[0]!.temperatureC.toFixed(1) }}°C</div>
          <div class="city-text">{{ list[0]!.text }}</div>
        </div>
        <div class="city-meta">
          <div>湿度 {{ list[0]!.humidity }}%</div>
          <div>风速 {{ list[0]!.windSpeedKmh.toFixed(0) }} km/h</div>
        </div>
      </div>

      <!-- 区县网格 -->
      <div class="district-grid">
        <div v-for="d in list.slice(1)" :key="d.name" class="district-card">
          <div class="d-name">{{ d.name }}</div>
          <div class="d-row">
            <span class="d-icon">{{ d.icon }}</span>
            <span class="d-temp">{{ d.temperatureC.toFixed(0) }}°</span>
          </div>
          <div class="d-text">{{ d.text }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.weather-panel {
  position: absolute;
  top: 14px;
  left: 60px;
  width: 264px;
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
.head-right { display: flex; align-items: center; gap: 6px; }
.updated { font-size: 10px; color: #5a7192; }
.refresh-btn {
  width: 22px; height: 22px;
  background: #111c30;
  border: 1px solid #1b2a41;
  border-radius: 4px;
  color: #8aa0be;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.refresh-btn:hover:not(:disabled) { color: #35c8e8; border-color: #35c8e8; }
.refresh-btn:disabled { opacity: .4; cursor: not-allowed; }
.state { font-size: 12px; color: #6d85a6; text-align: center; padding: 24px 0; }
.state.error { color: #e9546b; }
.city-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(135deg, rgba(53,200,232,.12), rgba(53,200,232,.04));
  border: 1px solid rgba(53, 200, 232, .3);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.city-icon { font-size: 32px; }
.city-main { flex: 1; }
.city-temp { font-size: 22px; font-weight: 700; color: #e8f1fb; }
.city-text { font-size: 12px; color: #8aa0be; }
.city-meta { font-size: 11px; color: #6d85a6; line-height: 1.7; text-align: right; }
.district-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.district-card {
  background: #0d1424;
  border: 1px solid #1b2a41;
  border-radius: 6px;
  padding: 8px 10px;
}
.d-name { font-size: 11px; color: #8aa0be; margin-bottom: 4px; }
.d-row { display: flex; align-items: center; gap: 6px; }
.d-icon { font-size: 16px; }
.d-temp { font-size: 15px; font-weight: 600; color: #e8f1fb; }
.d-text { font-size: 10px; color: #5a7192; margin-top: 2px; }
</style>
