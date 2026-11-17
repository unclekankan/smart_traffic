/**
 * 工作台全局状态
 *
 * 职责：
 * - 持有 2D/3D 模式、图层可见性、选中对象、分析结果等跨组件状态
 * - 承接引擎事件（select / pointer）与面板指令（定位 / 分析）
 * - 引擎切换（2D↔3D）时的相机状态记忆由 MapContainer 读写此处的 lastCamera
 *
 * 组件只与本 store 及 common 契约交互，不直接触碰地图引擎实例。
 */

import { defineStore } from 'pinia'

import { DEFAULT_LAYER_VISIBILITY, LAYER_IDS, type LayerId } from '@/common/constants/layers'
import type { MapMode, SelectedObject } from '@/common/types/engine'
import type { NetworkMode } from '@/common/types/network'
import type { CameraState, LngLat } from '@/common/types/geo'
import type { MetroSimulationState } from '@/common/types/simulation'
import type { MeasureAnnotation, MeasureMode, MeasureResult } from '@/common/types/measure'
import type {
  CoverageKind,
  CoverageResult,
  StationBufferResult,
  NearbyStop,
  NearbyStopsResult,
} from '@/common/types/analysis'
import { analysisApi } from '@/common/services/analysis'
import { transitApi, TransitApiError } from '@/common/services/transit'
import type { TransitPlanResult } from '@/common/types/transit'
import { getRoute, getSceneStats } from '@/common/data/metroRepository'
import { getRouteSummary } from '@/common/data/busRepository'

/** 左侧功能栏视图标识 */
export type RailView = 'workbench' | 'layers' | 'analysis' | 'route' | 'measure' | 'weather' | 'simulation'

function createMetroSimulationState(session = 0): MetroSimulationState {
  return {
    session,
    phase: 'idle',
    routeId: null,
    routeName: null,
    tilesEnabled: false,
    otherRoutesVisible: false,
    speedMultiplier: 1,
    model: { phase: 'idle', progress: 0, error: null },
    tilesStatus: 'idle',
    error: null,
  }
}

/** 路线规划地图选点目标 */
export type RoutePickTarget = 'origin' | 'destination'

export interface RouteState {
  origin: LngLat | null
  destination: LngLat | null
  pickTarget: RoutePickTarget | null
  strategy: number
  result: TransitPlanResult | null
  selectedId: string | null
  loading: boolean
  error: string | null
  notice: string | null
}

function createRouteState(): RouteState {
  return {
    origin: null,
    destination: null,
    pickTarget: null,
    strategy: 0,
    result: null,
    selectedId: null,
    loading: false,
    error: null,
    notice: null,
  }
}

const routeRequestGeneration: Record<MapMode, number> = { '2d': 0, '3d': 0 }

/**
 * 附近站点查询的单视图状态
 *
 * 2D / 3D 各持有一份（nearbyByMode），查询参数、结果缓存、选点状态
 * 与在途请求完全隔离，切换模式时不共享、不污染。
 */
export interface NearbyQueryState {
  /** 搜索半径（米） */
  radius: number
  /** 查询中心点（null 表示尚未选点） */
  center: LngLat | null
  /** 查询结果（按距离升序） */
  result: NearbyStopsResult | null
  /** 地图选点模式：开启后点击地图将作为查询中心 */
  pickMode: boolean
  loading: boolean
  error: string | null
}

function createNearbyQueryState(): NearbyQueryState {
  return { radius: 1000, center: null, result: null, pickMode: false, loading: false, error: null }
}

/** 各模式在途请求序号：仅最新一次响应允许写回对应模式的状态切片 */
const nearbyRequestGeneration: Record<MapMode, number> = { '2d': 0, '3d': 0 }

/**
 * 单站缓冲区分析的单视图状态
 *
 * 2D / 3D 各持有一份（stationBufferByMode）：半径参数、分析结果、
 * 渲染状态与在途请求完全隔离，切换模式时不共享、不残留。
 */
export interface StationBufferState {
  /** 缓冲半径（米） */
  radius: number
  /** 当前模式最近一次分析结果（null 表示未分析） */
  result: StationBufferResult | null
  loading: boolean
  error: string | null
}

function createStationBufferState(): StationBufferState {
  return { radius: 500, result: null, loading: false, error: null }
}

/** 各模式缓冲区分析的在途请求序号：仅最新一次响应允许写回该模式 */
const stationBufferRequestGeneration: Record<MapMode, number> = { '2d': 0, '3d': 0 }

/**
 * 全网服务范围（覆盖分析）的单视图状态
 *
 * 2D / 3D 各持有一份（coverageByMode）：半径参数、站点范围、分析结果、
 * 透明度，切换模式时不共享、不残留。
 */
export interface CoverageState {
  /** 服务半径（米） */
  radius: number
  /** 站点范围：地铁站 / 公交站 / 全部 */
  kind: CoverageKind
  /** 当前模式最近一次覆盖分析结果（null 表示未分析） */
  result: CoverageResult | null
  loading: boolean
  error: string | null
  /** 覆盖色带透明度（0.05 - 1） */
  opacity: number
}

function createCoverageState(): CoverageState {
  return {
    radius: 300,
    kind: 'metro',
    result: null,
    loading: false,
    error: null,
    opacity: 0.7,
  }
}

/** 各模式覆盖分析的在途请求序号 */
const coverageRequestGeneration: Record<MapMode, number> = { '2d': 0, '3d': 0 }

/**
 * 测量工具的单视图状态
 *
 * 2D / 3D 各持有一份（measureByMode）：当前工具、绘制草稿、已完成标注
 * 与选中 / 编辑状态完全独立；切换地图模式时清理离开模式的全部测量状态。
 */
export interface MeasureState {
  /** 当前测量工具（'none' 表示未启用） */
  mode: MeasureMode | 'none'
  /** 绘制中的实时结果（完成后置空并写入 annotations） */
  draft: MeasureResult | null
  /** 已完成的可编辑测量标注 */
  annotations: MeasureAnnotation[]
  /** 当前选中的标注 id */
  selectedId: string | null
  /** 正在顶点编辑的标注 id */
  editingId: string | null
}

function createMeasureState(): MeasureState {
  return { mode: 'none', draft: null, annotations: [], selectedId: null, editingId: null }
}

/** 标注 id 自增序号（两种模式共用计数器，但各自标注互不共享） */
let measureAnnotationSeq = 0

export const useMapStore = defineStore('map', {
  state: () => ({
    /** 当前地图模式（2D 默认，对应原型 2D/3D 切换） */
    mode: '2d' as MapMode,
    /** 当前交通网络（地铁 / 公交，互斥显示） */
    networkMode: 'metro' as NetworkMode,
    layerVisibility: { ...DEFAULT_LAYER_VISIBILITY } as Record<LayerId, boolean>,
    selected: null as SelectedObject | null,
    /** 地图高亮选择按视图独立保存；切换模式时不传递选择 */
    selectedByMode: { '2d': null, '3d': null } as Record<MapMode, SelectedObject | null>,
    /** 最近一次选中的地铁线路 id（站点详情「返回线路」用） */
    lastMetroRouteId: null as string | null,
    /** 站点详情来源线路，仅用于保留线路高亮 */
    contextMetroRoute: null as SelectedObject | null,
    /** 站点详情前一次性保存的地图视角 */
    stationReturnCamera: null as CameraState | null,
    /** 站点返回线路请求序号 */
    stationReturnSeq: 0,
    pointer: null as LngLat | null,
    /** 路网明度（%），映射到地图容器 CSS 亮度滤镜 */
    brightness: 85,
    /** 2D/3D 各自最近一次相机状态（模式切换时保持视角） */
    lastCamera: { '2d': null, '3d': null } as Record<MapMode, CameraState | null>,
    /** 定位请求序号：面板触发「定位」时自增，MapContainer 监听后驱动引擎飞行 */
    focusSeq: 0,
    /** 视角复位请求序号 */
    resetSeq: 0,
    /** 当前在线底图 id（basemaps 注册表） */
    baseMapId: 'osm',
    /** 左侧功能栏当前激活的功能视图 */
    railView: 'workbench' as RailView,
    /** 场景要素统计（线路 / 站点数量，加载后端数据后刷新） */
    sceneStats: { routes: 0, stops: 0 },
    /** 2D / 3D 各自的测量工具、草稿与标注图层，互不共享 */
    measureByMode: {
      '2d': createMeasureState(),
      '3d': createMeasureState(),
    } as Record<MapMode, MeasureState>,
    /** 清除测量请求序号（MapContainer 监听后驱动当前引擎重置绘制） */
    measureClearSeq: 0,
    /** 3D 地铁车辆模拟专属状态，切换模式时不自动恢复 */
    simulation3d: createMetroSimulationState(),

    // ---------- 空间分析：附近站点查询（按地图模式隔离） ---------- //
    /** 2D / 3D 各自的查询参数、结果缓存与选点状态，互不共享 */
    nearbyByMode: {
      '2d': createNearbyQueryState(),
      '3d': createNearbyQueryState(),
    } as Record<MapMode, NearbyQueryState>,

    // ---------- 路线规划 ---------- //
    routeByMode: { '2d': createRouteState(), '3d': createRouteState() } as Record<MapMode, RouteState>,

    // ---------- 空间分析：全网覆盖 ---------- //
    /** 2D / 3D 各自的覆盖分析参数、结果与透明度，互不共享 */
    coverageByMode: {
      '2d': createCoverageState(),
      '3d': createCoverageState(),
    } as Record<MapMode, CoverageState>,

    // ---------- 空间分析：缓冲区覆盖 ---------- //
    /** 2D / 3D 各自的缓冲区分析参数、结果与加载状态，互不共享 */
    stationBufferByMode: {
      '2d': createStationBufferState(),
      '3d': createStationBufferState(),
    } as Record<MapMode, StationBufferState>,

    /** 列表点选后的定位请求（坐标 + 序号，MapContainer 监听） */
    focusPoint: null as LngLat | null,
    focusPointSeq: 0,

    // ---------- 选中公交路线的叠加图层 ---------- //
    /** 当前选中的公交路线 id（null 表示未选中；仅公交网络模式生效） */
    selectedBusRoute: null as number | null,
    /** 最近一次选中的公交线路 id（站点详情「返回线路」的兜底） */
    lastBusRouteId: null as number | null,
    /** 选中公交线路的站点符号是否可见 */
    busRouteStopsVisible: true,
    /** 选中公交线路的站点名称注记是否可见 */
    busRouteNamesVisible: true,
  }),

  getters: {
    /** 当前模式的附近查询状态切片（2D / 3D 各自独立，面板只读当前模式） */
    nearbyState(): NearbyQueryState {
      return this.nearbyByMode[this.mode]
    },
    nearbyRadius(): number {
      return this.nearbyState.radius
    },
    nearbyCenter(): LngLat | null {
      return this.nearbyState.center
    },
    nearbyResult(): NearbyStopsResult | null {
      return this.nearbyState.result
    },
    nearbyPickMode(): boolean {
      return this.nearbyState.pickMode
    },
    nearbyLoading(): boolean {
      return this.nearbyState.loading
    },
    nearbyError(): string | null {
      return this.nearbyState.error
    },

    /** 当前模式的缓冲区分析状态切片（2D / 3D 各自独立） */
    stationBufferState(): StationBufferState {
      return this.stationBufferByMode[this.mode]
    },
    stationBufferRadius(): number {
      return this.stationBufferState.radius
    },
    stationBufferResult(): StationBufferResult | null {
      return this.stationBufferState.result
    },
    stationBufferLoading(): boolean {
      return this.stationBufferState.loading
    },
    stationBufferError(): string | null {
      return this.stationBufferState.error
    },

    /** 当前模式的覆盖分析状态切片（2D / 3D 各自独立） */
    coverageState(): CoverageState {
      return this.coverageByMode[this.mode]
    },
    coverageRadius(): number {
      return this.coverageState.radius
    },
    coverageKind(): CoverageKind {
      return this.coverageState.kind
    },
    coverageResult(): CoverageResult | null {
      return this.coverageState.result
    },
    coverageLoading(): boolean {
      return this.coverageState.loading
    },
    coverageError(): string | null {
      return this.coverageState.error
    },
    coverageOpacity(): number {
      return this.coverageState.opacity
    },

    routeState(): RouteState {
      return this.routeByMode[this.mode]
    },
    routeOrigin(): LngLat | null { return this.routeState.origin },
    routeDestination(): LngLat | null { return this.routeState.destination },
    routePickTarget(): RoutePickTarget | null { return this.routeState.pickTarget },
    routeStrategy(): number { return this.routeState.strategy },
    routePlanResult(): TransitPlanResult | null { return this.routeState.result },
    routeSelectedId(): string | null { return this.routeState.selectedId },
    routePlanLoading(): boolean { return this.routeState.loading },
    routePlanError(): string | null { return this.routeState.error },
    routePlanNotice(): string | null { return this.routeState.notice },

    /** 当前模式的测量状态切片（2D / 3D 各自独立） */
    measureState(): MeasureState {
      return this.measureByMode[this.mode]
    },
    measureMode(): MeasureMode | 'none' {
      return this.measureState.mode
    },
    /** 绘制中的实时测量结果（面板与地图浮层同步展示） */
    measureResult(): MeasureResult | null {
      return this.measureState.draft
    },
    measureAnnotations(): MeasureAnnotation[] {
      return this.measureState.annotations
    },
    selectedMeasureId(): string | null {
      return this.measureState.selectedId
    },
    measureEditingId(): string | null {
      return this.measureState.editingId
    },
  },

  actions: {
    setMode(mode: MapMode): void {
      if (this.mode === mode) return
      if (mode !== '3d') this.stopMetroSimulation()
      // 测量与覆盖图形绑定引擎实例；路线业务切片保留以便切回时恢复。
      this.measureByMode[this.mode] = createMeasureState()
      this.measureClearSeq += 1
      this.coverageByMode[this.mode] = createCoverageState()
      this.mode = mode
      this.selected = this.selectedByMode[mode]
    },

    setViewSelection(mode: MapMode, target: SelectedObject | null): void {
      this.selectedByMode[mode] = target
    },

    startMetroSimulation(routeId: string, routeName: string): number | null {
      if (this.mode !== '3d' || this.networkMode !== 'metro' || this.simulation3d.phase !== 'idle' || !getRoute(routeId)) return null
      const session = this.simulation3d.session + 1
      this.simulation3d = {
        ...createMetroSimulationState(session),
        phase: 'preparing',
        routeId,
        routeName,
      }
      this.railView = 'simulation'
      return session
    },

    stopMetroSimulation(): void {
      const session = this.simulation3d.session + 1
      this.simulation3d = createMetroSimulationState(session)
    },

    setMetroSimulationPaused(paused: boolean): void {
      const state = this.simulation3d
      if (paused && state.phase === 'running') state.phase = 'paused'
      else if (!paused && state.phase === 'paused') state.phase = 'running'
    },

    setMetroSimulationTilesEnabled(enabled: boolean): void {
      this.simulation3d.tilesEnabled = enabled
      if (!enabled) this.simulation3d.tilesStatus = 'idle'
    },

    setMetroSimulationOtherRoutesVisible(visible: boolean): void {
      this.simulation3d.otherRoutesVisible = visible
    },

    setMetroSimulationSpeedMultiplier(speed: number): void {
      this.simulation3d.speedMultiplier = Math.min(4, Math.max(0.25, speed))
    },

    applyMetroSimulationState(session: number, state: MetroSimulationState): void {
      if (this.mode !== '3d' || this.networkMode !== 'metro' || session !== this.simulation3d.session
        || state.session !== session || state.routeId !== this.simulation3d.routeId) return
      this.simulation3d = { ...state, model: { ...state.model } }
    },

    /** 更新业务详情并同步当前地图的独立选择 */
    setCurrentSelection(target: SelectedObject | null): void {
      this.selected = target
      this.selectedByMode[this.mode] = target
    },

    /** 切换交通网络：地铁 / 公交（切换后清除选中，避免属性面板残留另一网络的要素） */
    setNetworkMode(mode: NetworkMode): void {
      if (this.networkMode === mode) return
      if (mode === 'bus') this.stopMetroSimulation()
      this.networkMode = mode
      this.selected = null
      this.selectedByMode['2d'] = null
      this.selectedByMode['3d'] = null
      this.lastMetroRouteId = null
      this.contextMetroRoute = null
      this.stationReturnCamera = null
      this.selectedBusRoute = null
      this.lastBusRouteId = null
    },

    toggleLayer(id: LayerId): void {
      this.layerVisibility[id] = !this.layerVisibility[id]
    },

    setAllLayersVisible(visible: boolean): void {
      for (const id of LAYER_IDS) this.layerVisibility[id] = visible
    },

    /** 引擎点选事件入口（不做相机飞行） */
    select(target: SelectedObject | null): void {
      this.selectForMode(this.mode, target)
    },

    selectForMode(mode: MapMode, target: SelectedObject | null): void {
      const previous = this.selectedByMode[mode]
      if (mode === '3d' && this.simulation3d.phase !== 'idle'
        && (target?.kind !== 'road' || target.id !== this.simulation3d.routeId)) this.stopMetroSimulation()
      if (target?.kind === 'station' && previous?.kind === 'road' && this.networkMode === 'metro') {
        this.contextMetroRoute = previous
      } else if (target?.kind !== 'station') {
        this.contextMetroRoute = null
        this.stationReturnCamera = null
      }
      this.selectedByMode[mode] = target
      this.selected = target
      // 记录最近选中的地铁线路，供站点详情「返回线路」使用
      if (target?.kind === 'road') this.lastMetroRouteId = target.id
      // 地图上点选公交线路本体时，同步叠加层选中态（保证控制弹窗可用）
      if (target?.kind === 'busRoute') {
        const id = Number(target.id)
        this.selectedBusRoute = id
        this.lastBusRouteId = id
      }
    },

    /** 面板主动显示对象详情并定位，不覆盖地图引擎独立选择 */
    focus(target: SelectedObject): void {
      this.selected = target
      if (target.kind === 'road') this.lastMetroRouteId = target.id
      if (target.kind === 'busRoute') {
        const id = Number(target.id)
        this.selectedBusRoute = id
        this.lastBusRouteId = id
      }
      this.focusSeq += 1
    },

    setStationReturnCamera(camera: CameraState | null): void {
      this.stationReturnCamera = camera
    },

    /** 从地铁站点详情返回来源线路，并请求恢复进入站点前的视角 */
    backToMetroRoute(): boolean {
      const target = this.contextMetroRoute
      const id = target?.id ?? this.lastMetroRouteId
      if (id === null) return false
      const route = getRoute(id)
      if (!route) return false
      this.focus(target ?? { kind: 'road', id, name: route.name })
      this.contextMetroRoute = null
      this.stationReturnSeq += 1
      return true
    },

    setPointer(point: LngLat | null): void {
      this.pointer = point
    },

    setBrightness(value: number): void {
      this.brightness = value
    },

    saveCamera(mode: MapMode, camera: CameraState): void {
      this.lastCamera[mode] = camera
    },

    requestResetView(): void {
      this.resetSeq += 1
    },

    setBaseMap(id: string): void {
      this.baseMapId = id
    },

    /** 刷新场景要素统计（引擎加载完后端数据后调用） */
    refreshSceneStats(): void {
      this.sceneStats = getSceneStats()
    },

    /** 左侧功能栏切换（再次点击同一项回到工作台） */
    setRailView(view: RailView): void {
      this.railView = view
      // 离开测距面板时退出当前模式的绘制状态（已完成标注保留）
      if (view !== 'measure' && this.measureMode !== 'none') {
        this.measureState.mode = 'none'
        this.measureState.draft = null
        this.measureState.editingId = null
      }
      // 离开空间分析面板时退出当前模式的选点状态（另一模式的选点状态独立保留）
      if (view !== 'analysis') this.nearbyState.pickMode = false
      // 离开路线规划面板时只退出当前模式的选点
      if (view !== 'route') this.routeState.pickTarget = null
    },

    /** 切换当前模式的测量工具；关闭工具只取消草稿，已完成标注保留 */
    setMeasureMode(mode: MeasureMode | 'none'): void {
      const slice = this.measureState
      slice.mode = mode
      slice.draft = null
      slice.editingId = null
      if (mode === 'none') slice.selectedId = null
    },

    /** 引擎绘制草稿回调（仅接受当前模式的事件，避免跨模式串扰） */
    setMeasureDraft(mode: MapMode, result: MeasureResult | null): void {
      if (mode !== this.mode) return
      this.measureState.draft = result
    },

    /** 完成一次测量：写入当前模式的标注图层，并自动选中 */
    addMeasureAnnotation(mode: MapMode, annotation: MeasureAnnotation): void {
      if (mode !== this.mode) return
      const slice = this.measureState
      const prefix = annotation.mode === 'area' ? '面积' : '测距'
      const sameMode = slice.annotations.filter((item) => item.mode === annotation.mode).length + 1
      const created: MeasureAnnotation = {
        ...annotation,
        id: annotation.id || `measure-${++measureAnnotationSeq}`,
        label: annotation.label || `${prefix} ${sameMode}`,
        visible: annotation.visible !== false,
      }
      slice.annotations.push(created)
      slice.selectedId = created.id
      slice.draft = null
      slice.editingId = null
    },

    /** 顶点编辑完成：按 id 更新当前模式的标注并重新计算数值 */
    updateMeasureAnnotation(mode: MapMode, annotation: MeasureAnnotation): void {
      if (mode !== this.mode) return
      const slice = this.measureState
      const index = slice.annotations.findIndex((item) => item.id === annotation.id)
      if (index < 0) return
      slice.annotations[index] = { ...slice.annotations[index]!, ...annotation }
    },

    /** 重命名标注（当前模式） */
    renameMeasureAnnotation(id: string, label: string): void {
      const item = this.measureState.annotations.find((annotation) => annotation.id === id)
      if (!item) return
      item.label = label.trim() || item.label
    },

    /** 切换标注文本显隐 */
    toggleMeasureAnnotationVisible(id: string): void {
      const item = this.measureState.annotations.find((annotation) => annotation.id === id)
      if (!item) return
      item.visible = !item.visible
    },

    /** 选中标注（null 表示取消选中） */
    selectMeasureAnnotation(id: string | null): void {
      const slice = this.measureState
      slice.selectedId = id
      if (id === null && slice.editingId !== null) slice.editingId = null
    },

    /** 进入 / 退出标注顶点编辑（null 表示退出） */
    setMeasureEditing(id: string | null): void {
      const slice = this.measureState
      if (id !== null && !slice.annotations.some((annotation) => annotation.id === id)) return
      slice.editingId = id
      if (id !== null) slice.selectedId = id
    },

    /** 删除单个标注 */
    removeMeasureAnnotation(id: string): void {
      const slice = this.measureState
      const index = slice.annotations.findIndex((annotation) => annotation.id === id)
      if (index < 0) return
      slice.annotations.splice(index, 1)
      if (slice.selectedId === id) slice.selectedId = null
      if (slice.editingId === id) slice.editingId = null
    },

    /** 清除当前模式的全部测量图形、标注与草稿（保留当前工具） */
    clearMeasure(): void {
      const slice = this.measureState
      slice.draft = null
      slice.annotations = []
      slice.selectedId = null
      slice.editingId = null
      this.measureClearSeq += 1
    },

    // ---------- 空间分析：附近站点查询 ---------- //
    /** 选择搜索半径；已有查询中心时按新半径自动重查（只影响当前模式） */
    setNearbyRadius(radius: number): void {
      const slice = this.nearbyState
      slice.radius = radius
      if (slice.center) void this.loadNearbyStops()
    },

    /** 进入地图选点模式（点击地图确定查询中心） */
    startNearbyPick(): void {
      this.routeState.pickTarget = null
      const slice = this.nearbyState
      slice.pickMode = true
      slice.error = null
    },

    cancelNearbyPick(): void {
      this.nearbyState.pickMode = false
    },

    /** 引擎选点回调：以该坐标为圆心查询附近站点 */
    async pickNearbyCenter(point: LngLat): Promise<void> {
      const slice = this.nearbyState
      slice.pickMode = false
      slice.center = point
      await this.loadNearbyStops()
    },

    /**
     * 调用后端 PostGIS 附近站点查询（距离排序在后端完成）。
     * 请求发起时锁定所属模式：响应只写回该模式的状态切片，
     * 跨模式切换期间的在途响应不会污染另一模式的缓存。
     */
    async loadNearbyStops(): Promise<void> {
      const mode = this.mode
      const slice = this.nearbyByMode[mode]
      const center = slice.center
      if (!center) return
      const generation = ++nearbyRequestGeneration[mode]
      slice.loading = true
      slice.error = null
      try {
        const result = await analysisApi.nearbyStops(center[0], center[1], slice.radius)
        if (generation !== nearbyRequestGeneration[mode]) return
        slice.result = result
        slice.center = result.center
      } catch (err) {
        if (generation !== nearbyRequestGeneration[mode]) return
        slice.result = null
        slice.error = err instanceof Error ? err.message : '附近站点查询失败'
      } finally {
        if (generation === nearbyRequestGeneration[mode]) slice.loading = false
      }
    },

    /** 清除当前模式的查询状态，并作废其未完成的在途响应 */
    clearNearby(): void {
      nearbyRequestGeneration[this.mode] += 1
      const slice = this.nearbyState
      slice.center = null
      slice.result = null
      slice.error = null
      slice.pickMode = false
      slice.loading = false
    },

    /** 定位到附近站点列表中的某一站（地图飞行由引擎完成） */
    focusNearbyStop(stop: NearbyStop): void {
      this.setCurrentSelection(stop.kind === 'metro'
        ? { kind: 'station', id: stop.id, name: stop.name }
        : { kind: 'busStop', id: stop.id, name: stop.name })
      this.focusPoint = [stop.lon, stop.lat]
      this.focusPointSeq += 1
    },

    // ---------- 路线规划 ---------- //
    startRoutePick(target: RoutePickTarget): void {
      this.nearbyState.pickMode = false
      this.routeState.pickTarget = target
      this.routeState.error = null
      this.routeState.notice = null
    },

    cancelRoutePick(): void {
      this.routeState.pickTarget = null
    },

    async pickRoutePoint(point: LngLat, mode: MapMode): Promise<void> {
      const slice = this.routeByMode[mode]
      const target = slice.pickTarget
      if (!target) return
      if (target === 'origin') slice.origin = point
      else slice.destination = point
      slice.pickTarget = null
      slice.result = null
      slice.selectedId = null
      slice.notice = null
      if (slice.origin && slice.destination) await this.loadRoutePlan(mode)
    },

    async swapRouteEndpoints(): Promise<void> {
      const slice = this.routeState
      const origin = slice.origin
      slice.origin = slice.destination
      slice.destination = origin
      if (slice.origin && slice.destination) await this.loadRoutePlan(this.mode)
    },

    setRouteStrategy(strategy: number): void {
      const slice = this.routeState
      if (slice.strategy === strategy) return
      slice.strategy = strategy
      if (slice.origin && slice.destination) void this.loadRoutePlan(this.mode)
    },

    async loadRoutePlan(mode: MapMode): Promise<void> {
      const slice = this.routeByMode[mode]
      const origin = slice.origin
      const destination = slice.destination
      if (!origin || !destination) return
      const generation = ++routeRequestGeneration[mode]
      slice.loading = true
      slice.error = null
      slice.notice = null
      try {
        const result = await transitApi.plan({ origin, destination, strategy: slice.strategy })
        if (routeRequestGeneration[mode] !== generation) return
        slice.result = result
        slice.selectedId = result.alternatives[0]?.id ?? null
      } catch (err) {
        if (routeRequestGeneration[mode] !== generation) return
        slice.result = null
        slice.selectedId = null
        if (err instanceof TransitApiError && err.code === 50003) slice.notice = err.message
        else slice.error = err instanceof Error ? err.message : '路线规划失败'
      } finally {
        if (routeRequestGeneration[mode] === generation) slice.loading = false
      }
    },

    selectRouteAlternative(id: string): void {
      this.routeState.selectedId = id
    },

    clearRoutePlan(): void {
      const mode = this.mode
      routeRequestGeneration[mode]++
      this.routeByMode[mode] = createRouteState()
    },

    // ---------- 空间分析：全网覆盖 ---------- //
    setCoverageRadius(radius: number): void {
      this.coverageState.radius = radius
    },

    setCoverageKind(kind: CoverageKind): void {
      this.coverageState.kind = kind
    },

    /** 调整覆盖色带透明度 */
    setCoverageOpacity(value: number): void {
      this.coverageState.opacity = Math.min(1, Math.max(0.05, value))
    },

    /** 执行覆盖分析：后端 PostGIS 计算覆盖层数 / 面积 / 重叠率，结果只写回当前模式 */
    async runCoverageAnalysis(): Promise<void> {
      const mode = this.mode
      const slice = this.coverageByMode[mode]
      const generation = ++coverageRequestGeneration[mode]
      slice.loading = true
      slice.error = null
      try {
        const result = await analysisApi.stationBuffers(slice.radius, slice.kind)
        if (coverageRequestGeneration[mode] !== generation) return // 过期响应丢弃
        slice.result = result
      } catch (err) {
        if (coverageRequestGeneration[mode] !== generation) return
        slice.result = null
        slice.error = err instanceof Error ? err.message : '覆盖分析失败'
      } finally {
        if (coverageRequestGeneration[mode] === generation) {
          slice.loading = false
        }
      }
    },

    clearCoverage(): void {
      const slice = this.coverageState
      slice.result = null
      slice.error = null
      slice.loading = false
    },

    /** 选择缓冲半径（仅影响当前模式，切回时恢复各自参数） */
    setStationBufferRadius(radius: number): void {
      this.stationBufferState.radius = radius
    },

    /**
     * 单站缓冲区分析：请求发起时锁定所属模式，半径取自该模式的状态切片，
     * 响应也只写回该模式；切换模式期间的在途响应不会串到另一模式。
     */
    async runStationBuffer(stop: { kind: 'metro' | 'bus'; id: string; name: string }): Promise<void> {
      const mode = this.mode
      const slice = this.stationBufferByMode[mode]
      const generation = ++stationBufferRequestGeneration[mode]
      slice.loading = true
      slice.error = null
      this.setCurrentSelection(stop.kind === 'metro'
        ? { kind: 'station', id: stop.id, name: stop.name }
        : { kind: 'busStop', id: stop.id, name: stop.name })
      try {
        const result = await analysisApi.stationBuffer(stop.kind, stop.id, slice.radius)
        if (generation !== stationBufferRequestGeneration[mode]) return
        slice.result = result
      } catch (err) {
        if (generation !== stationBufferRequestGeneration[mode]) return
        slice.result = null
        slice.error = err instanceof Error ? err.message : '缓冲区分析失败'
      } finally {
        if (generation === stationBufferRequestGeneration[mode]) slice.loading = false
      }
    },

    /** 清除当前模式的缓冲区结果，并作废其未完成的在途响应 */
    clearStationBuffer(): void {
      stationBufferRequestGeneration[this.mode] += 1
      const slice = this.stationBufferState
      slice.result = null
      slice.error = null
      slice.loading = false
    },

    // ---------- 选中公交路线 ---------- //
    /** 选中一条公交线路（切换会触发引擎加载 GeoJSON 叠加层，并同步属性面板） */
    selectBusRoute(id: number | null): void {
      this.selectedBusRoute = id
      if (id === null) {
        if (this.selected?.kind === 'busRoute' || this.selected?.kind === 'busStop') {
          this.setCurrentSelection(null)
        }
        return
      }
      this.lastBusRouteId = id
      const summary = getRouteSummary(id)
      this.setCurrentSelection({
        kind: 'busRoute',
        id: String(id),
        name: summary?.route_cn ?? '公交线路',
      })
    },
    /** 取消选中公交线路：引擎监听 selectedBusRoute 后销毁已加载的 GeoJSON 叠加层 */
    clearBusRoute(): void {
      this.selectBusRoute(null)
    },
    /** 从公交站点详情返回所属线路（优先当前选中线路，其次最近一次选中） */
    backToBusRoute(): void {
      const id = this.selectedBusRoute ?? this.lastBusRouteId
      if (id === null) return
      this.selectBusRoute(id)
    },
    /** 选中公交站点（属性面板展示站点详情，与地铁站点同一套 UI） */
    selectBusStop(stopId: string, name: string): void {
      this.setCurrentSelection({ kind: 'busStop', id: stopId, name })
    },
    /** 切换选中公交线路的站点符号显隐 */
    setBusRouteStopsVisible(v: boolean): void {
      this.busRouteStopsVisible = v
    },
    /** 切换选中公交线路的站点名称显隐 */
    setBusRouteNamesVisible(v: boolean): void {
      this.busRouteNamesVisible = v
    },
  },
})
