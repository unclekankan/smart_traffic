<script setup lang="ts">
/**
 * 测距 / 测面积面板
 *
 * 交互形态：先选测量模式（测距 / 测面积）→ 主按钮开始测量 → 画布选点。
 * 主按钮在「开始测量 / 取消测量」之间切换，取消时清除当前绘制草稿，
 * 已完成的标注由下方列表管理（重命名、显隐、编辑顶点、删除、清除全部）。
 *
 * 数据全部来自当前模式的测量状态切片（2D / 3D 独立），
 * 地图渲染由当前引擎负责，面板只下发业务指令。
 */

import { computed, ref } from 'vue'

import { useMapStore } from '@/stores/mapStore'
import { formatArea, formatDistance } from '@/common/utils/measureFormat'
import type { MeasureAnnotation, MeasureMode } from '@/common/types/measure'

const store = useMapStore()

const editingNameId = ref<string | null>(null)
const draftName = ref('')

const modeLabel = computed(() => (store.mode === '3d' ? '3D 场景' : '2D 地图'))
const draft = computed(() => store.measureResult)
const annotations = computed(() => store.measureAnnotations)
const editingGeometryId = computed(() => store.measureEditingId)

/** 面板内"待选"的测量模式（未开始测量时的默认值） */
const pendingMode = ref<MeasureMode>('distance')

/** 测量工具是否处于激活态（主按钮控制） */
const measuring = computed(() => store.measureMode !== 'none')

/** 主按钮当前的"业务模式"：激活时取 store 当前值，未激活时取面板待选值 */
const effectiveMode = computed<MeasureMode>(() =>
  measuring.value ? store.measureMode as MeasureMode : pendingMode.value,
)

/** 选择测量模式（未开始测量时可切换，激活时需先取消） */
function selectMode(mode: MeasureMode): void {
  if (measuring.value) {
    // 激活时切换模式 → 先取消再以新模式开始
    store.setMeasureMode('none')
    pendingMode.value = mode
    store.setMeasureMode(mode)
  } else {
    pendingMode.value = mode
  }
}

/** 主按钮：开始测量 / 取消测量 */
function toggleMeasure(): void {
  if (measuring.value) {
    // 取消：清草稿 + 清顶点编辑 + 清选中（保留历史标注）
    store.setMeasureMode('none')
  } else {
    // 开始：以面板当前选的模式激活
    store.setMeasureMode(pendingMode.value)
  }
}

function valueText(item: Pick<MeasureAnnotation, 'mode' | 'value'>): string {
  return item.mode === 'area' ? formatArea(item.value) : formatDistance(item.value)
}

function beginRename(item: MeasureAnnotation): void {
  editingNameId.value = item.id
  draftName.value = item.label
}

function commitRename(): void {
  if (!editingNameId.value) return
  store.renameMeasureAnnotation(editingNameId.value, draftName.value)
  editingNameId.value = null
}

function cancelRename(): void {
  editingNameId.value = null
}

function toggleGeometryEdit(item: MeasureAnnotation): void {
  store.setMeasureEditing(editingGeometryId.value === item.id ? null : item.id)
}

function removeAnnotation(item: MeasureAnnotation): void {
  store.removeMeasureAnnotation(item.id)
}
</script>

<template>
  <section class="measure-panel">
    <header class="panel-head">
      <div>
        <h3>测量</h3>
        <p class="sub">当前视图 · {{ modeLabel }}</p>
      </div>
      <span class="mode-badge" :class="{ 'is-3d': store.mode === '3d' }">{{ store.mode.toUpperCase() }}</span>
    </header>

    <!-- 测量模式选择：测距 / 测面积 -->
    <div class="mode-picker">
      <button
        class="mode-chip"
        :class="{ active: effectiveMode === 'distance', locked: measuring && store.measureMode === 'distance' }"
        @click="selectMode('distance')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4 17 17 4M4 17h5M4 17v-5M20 7h-5M20 7v5" />
        </svg>
        <span>测距</span>
      </button>
      <button
        class="mode-chip"
        :class="{ active: effectiveMode === 'area', locked: measuring && store.measureMode === 'area' }"
        @click="selectMode('area')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4 6 12 3l8 4v9l-8 4-8-4V6Z" />
        </svg>
        <span>测面积</span>
      </button>
    </div>

    <!-- 主按钮：开始测量 / 取消测量 -->
    <button
      class="primary-btn"
      :class="{ cancel: measuring, distance: effectiveMode === 'distance', area: effectiveMode === 'area' }"
      @click="toggleMeasure"
    >
      <template v-if="measuring">
        <span class="btn-icon">✕</span>
        <span>取消测量</span>
      </template>
      <template v-else>
        <span class="btn-icon">▶</span>
        <span>开始测量</span>
      </template>
    </button>

    <p v-if="measuring" class="hint">
      {{ store.mode === '3d' ? '单击取点，双击或右键结束；拖拽顶点可修改' : '单击加点，双击结束；选中标注后可拖拽顶点修改' }}
    </p>
    <p v-else class="hint muted">
      已选 <b>{{ effectiveMode === 'area' ? '测面积' : '测距' }}</b>，点击上方按钮后地图才可选点。
    </p>

    <!-- 实时测量数值（仅激活时出现） -->
    <div v-if="draft" class="live-card">
      <div class="live-top">
        <span class="dot" />
        <span>正在绘制 · {{ draft.mode === 'area' ? '面积' : '距离' }}</span>
      </div>
      <strong>{{ valueText(draft) }}</strong>
      <div class="live-meta">
        <span>{{ draft.vertexCount }} 个顶点</span>
        <span v-if="draft.mode === 'distance' && draft.segments.length">{{ draft.segments.length }} 段</span>
        <span v-if="draft.mode === 'area' && draft.perimeter">周长 {{ formatDistance(draft.perimeter) }}</span>
      </div>
    </div>

    <!-- 历史标注列表 -->
    <div class="list-head">
      <span>测量标注 <b>{{ annotations.length }}</b></span>
      <button v-if="annotations.length" class="clear-btn" @click="store.clearMeasure()">清除全部</button>
    </div>

    <ul v-if="annotations.length" class="annotation-list">
      <li
        v-for="item in annotations"
        :key="item.id"
        class="annotation-item"
        :class="{ selected: store.selectedMeasureId === item.id, editing: editingGeometryId === item.id }"
        @click="store.selectMeasureAnnotation(item.id)"
      >
        <div class="item-main">
          <template v-if="editingNameId === item.id">
            <input
              v-model="draftName"
              class="name-input"
              maxlength="20"
              autofocus
              @click.stop
              @keydown.enter="commitRename"
              @keydown.esc="cancelRename"
              @blur="commitRename"
            />
          </template>
          <template v-else>
            <span class="item-name" @dblclick.stop="beginRename(item)">{{ item.label }}</span>
          </template>
          <span class="item-value">{{ valueText(item) }}</span>
        </div>
        <div class="item-meta">
          <span class="kind">{{ item.mode === 'area' ? '面积' : '距离' }}</span>
          <span>{{ item.vertexCount }} 顶点</span>
          <span v-if="item.mode === 'area'">周长 {{ formatDistance(item.perimeter) }}</span>
        </div>
        <div class="item-actions" @click.stop>
          <button class="icon-btn" title="重命名" @click="beginRename(item)">✎</button>
          <button
            class="icon-btn"
            :class="{ on: editingGeometryId === item.id }"
            :title="editingGeometryId === item.id ? '完成顶点编辑' : '编辑顶点'"
            @click="toggleGeometryEdit(item)"
          >{{ editingGeometryId === item.id ? '✓' : '⠿' }}</button>
          <button class="icon-btn" :class="{ on: item.visible }" :title="item.visible ? '隐藏标注' : '显示标注'" @click="store.toggleMeasureAnnotationVisible(item.id)">
            {{ item.visible ? '👁' : '◌' }}
          </button>
          <button class="icon-btn danger" title="删除" @click="removeAnnotation(item)">✕</button>
        </div>
      </li>
    </ul>

    <p v-else class="empty">暂无测量结果。</p>
  </section>
</template>

<style scoped>
.measure-panel {
  position: absolute;
  top: 14px;
  left: 60px;
  width: 300px;
  max-height: calc(100% - 120px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  color: #c5d4e8;
  background: rgba(14, 22, 38, 0.92);
  border: 1px solid #1b2a41;
  border-radius: 8px;
  z-index: 15;
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.panel-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #e8f1fb;
}
.sub {
  margin: 4px 0 0;
  font-size: 11px;
  color: #6d85a6;
}
.mode-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 999px;
  color: #9fe8f7;
  background: rgba(53, 200, 232, 0.12);
  border: 1px solid rgba(53, 200, 232, 0.35);
}
.mode-badge.is-3d {
  color: #b9a8ff;
  background: rgba(139, 116, 255, 0.14);
  border-color: rgba(139, 116, 255, 0.4);
}

/* 模式选择 chip */
.mode-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.mode-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #1b2a41;
  background: #0d1626;
  color: #8aa4c6;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s ease;
}
.mode-chip:hover {
  border-color: #2a4a6c;
  color: #c5d4e8;
}
.mode-chip.active {
  border-color: rgba(53, 200, 232, 0.6);
  color: #35c8e8;
  background: rgba(53, 200, 232, 0.08);
}
.mode-chip.locked {
  cursor: default;
}

/* 主按钮：开始测量 / 取消测量 */
.primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 14px;
  border-radius: 8px;
  border: 1px solid rgba(53, 200, 232, 0.5);
  background: linear-gradient(160deg, rgba(53, 200, 232, 0.22), rgba(12, 20, 36, 0.9));
  color: #caf5ff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.18s ease;
  box-shadow: 0 0 0 1px rgba(53, 200, 232, 0.15), 0 6px 18px rgba(0, 0, 0, 0.35);
}
.primary-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px rgba(53, 200, 232, 0.3), 0 10px 22px rgba(0, 0, 0, 0.4);
}
.primary-btn.area {
  border-color: rgba(139, 116, 255, 0.55);
  background: linear-gradient(160deg, rgba(139, 116, 255, 0.22), rgba(12, 20, 36, 0.9));
  color: #e0d5ff;
  box-shadow: 0 0 0 1px rgba(139, 116, 255, 0.15), 0 6px 18px rgba(0, 0, 0, 0.35);
}
.primary-btn.cancel {
  border-color: rgba(255, 123, 123, 0.55);
  background: linear-gradient(160deg, rgba(255, 123, 123, 0.2), rgba(12, 20, 36, 0.9));
  color: #ffd5d5;
  box-shadow: 0 0 0 1px rgba(255, 123, 123, 0.15), 0 6px 18px rgba(0, 0, 0, 0.35);
}
.primary-btn.cancel:hover {
  box-shadow: 0 0 0 1px rgba(255, 123, 123, 0.3), 0 10px 22px rgba(0, 0, 0, 0.4);
}
.btn-icon {
  font-size: 11px;
  line-height: 1;
}

.hint {
  margin: 0;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  color: #8fb3d8;
  background: rgba(53, 200, 232, 0.08);
  border-left: 2px solid #35c8e8;
}
.hint.muted {
  color: #7d95b5;
  background: rgba(125, 149, 181, 0.08);
  border-left-color: #2a4a6c;
}

.live-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(53, 200, 232, 0.4);
  background: radial-gradient(120% 120% at 0% 0%, rgba(53, 200, 232, 0.2), rgba(10, 16, 28, 0.9));
}
.live-top {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #9fe8f7;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #35c8e8;
  box-shadow: 0 0 0 3px rgba(53, 200, 232, 0.18);
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.live-card strong {
  font-size: 20px;
  font-weight: 700;
  color: #e8f1fb;
  letter-spacing: 0.02em;
}
.live-meta {
  display: flex;
  gap: 10px;
  font-size: 10px;
  color: #6d85a6;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #7d95b5;
}
.list-head b {
  color: #35c8e8;
}
.clear-btn {
  border: none;
  background: none;
  color: #7d95b5;
  font-size: 11px;
  cursor: pointer;
}
.clear-btn:hover {
  color: #ff7b7b;
}
.annotation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.annotation-item {
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid #1b2a41;
  background: #0d1626;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.annotation-item:hover {
  border-color: #2a4a6c;
}
.annotation-item.selected {
  border-color: rgba(53, 200, 232, 0.6);
  background: rgba(53, 200, 232, 0.08);
}
.annotation-item.editing {
  border-style: dashed;
}
.item-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.item-name {
  font-size: 12px;
  font-weight: 600;
  color: #dbe8f8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-value {
  font-size: 13px;
  font-weight: 700;
  color: #35c8e8;
  white-space: nowrap;
}
.name-input {
  width: 110px;
  padding: 2px 6px;
  font-size: 12px;
  color: #e8f1fb;
  background: #08111f;
  border: 1px solid #35c8e8;
  border-radius: 4px;
  outline: none;
}
.item-meta {
  display: flex;
  gap: 8px;
  margin-top: 3px;
  font-size: 10px;
  color: #5f7899;
}
.item-meta .kind {
  color: #8aa4c6;
}
.item-actions {
  display: flex;
  gap: 4px;
  margin-top: 7px;
}
.icon-btn {
  flex: 1;
  padding: 3px 0;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid #1b2a41;
  background: #0a1220;
  color: #7d95b5;
  cursor: pointer;
  transition: all 0.14s ease;
}
.icon-btn:hover {
  color: #c5d4e8;
  border-color: #2a4a6c;
}
.icon-btn.on {
  color: #35c8e8;
  border-color: rgba(53, 200, 232, 0.55);
  background: rgba(53, 200, 232, 0.1);
}
.icon-btn.danger:hover {
  color: #ff7b7b;
  border-color: rgba(255, 123, 123, 0.5);
}
.empty {
  margin: 0;
  padding: 20px 10px;
  text-align: center;
  font-size: 11px;
  color: #5f7899;
  border: 1px dashed #1b2a41;
  border-radius: 8px;
}
</style>
