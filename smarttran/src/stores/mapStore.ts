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
import type { MeasureMode, MeasureResult } from '@/common/types/measure'
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
export type RailView = 'workbench' | 'layers' | 'analysis' | 'route' | 'measure' | 'weather'

/** 路线规划地图选点目标 */
export type RoutePickTarget = 'origin' | 'destination'

export const useMapStore = defineStore('map', {
  state: () => ({
    /** 当前地图模式（2D 默认，对应原型 2D/3D 切换） */
    mode: '2d' as MapMode,
    /** 当前交通网络（地铁 / 公交，互斥显示） */
    networkMode: 'metro' as NetworkMode,
    layerVisibility: { ...DEFAULT_LAYER_VISIBILITY } as Record<LayerId, boolean>,
    selected: null as SelectedObject | null,
    /** 最近一次选中的地铁线路 id（站点详情「返回线路」用） */
    lastMetroRouteId: null as string | null,
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
    /** 测量模式（'none' 表示未启用） */
    measureMode: 'none' as MeasureMode | 'none',
    /** 当前测量结果（引擎回调写入） */
    measureResult: null as MeasureResult | null,
    /** 清除测量请求序号（MapContainer 监听后驱动引擎） */
    measureClearSeq: 0,

    // ---------- 空间分析：附近站点查询 ---------- //
    /** 搜索半径（米） */
    nearbyRadius: 1000,
    /** 查询中心点（null 表示尚未选点） */
    nearbyCenter: null as LngLat | null,
    /** 查询结果（按距离升序） */
    nearbyResult: null as NearbyStopsResult | null,
    /** 地图选点模式：开启后点击地图将作为查询中心 */
    nearbyPickMode: false,
    nearbyLoading: false,
    nearbyError: null as string | null,

    // ---------- 路线规划 ---------- //
    /** 起点 / 终点（WGS84，由地图点击获得） */
    routeOrigin: null as LngLat | null,
    routeDestination: null as LngLat | null,
    /** 当前正在地图选点的目标（null 表示未在选点） */
    routePickTarget: null as RoutePickTarget | null,
    /** 出行策略（0-6，与后端 / 高德一致） */
    routeStrategy: 0,
    routePlanResult: null as TransitPlanResult | null,
    /** 当前选中的方案 id（地图高亮 + 详情面板） */
    routeSelectedId: null as string | null,
    routePlanLoading: false,
    routePlanError: null as string | null,
    /** 无可用方案等友好引导（非错误态） */
    routePlanNotice: null as string | null,

    // ---------- 空间分析：缓冲区覆盖 ---------- //
    /** 站点服务半径（米）：300 / 500 / 800 */
    coverageRadius: 300,
    /** 分析站点范围 */
    coverageKind: 'metro' as CoverageKind,
    /** 覆盖分析结果（后端 PostGIS 计算，前端只渲染） */
    coverageResult: null as CoverageResult | null,
    stationBufferResult: null as StationBufferResult | null,
    stationBufferRadius: 500,
    stationBufferLoading: false,
    stationBufferError: null as string | null,
    coverageLoading: false,
    coverageError: null as string | null,
    /** 缓冲区图层透明度（0.05 - 1，默认偏高以保证颜色鲜艳） */
    coverageOpacity: 0.7,

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

  actions: {
    setMode(mode: MapMode): void {
      if (this.mode === mode) return
      this.mode = mode
    },

    /** 切换交通网络：地铁 / 公交（切换后清除选中，避免属性面板残留另一网络的要素） */
    setNetworkMode(mode: NetworkMode): void {
      if (this.networkMode === mode) return
      this.networkMode = mode
      this.selected = null
      this.lastMetroRouteId = null
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

    /** 面板主动选中并定位（如关联对象跳转） */
    focus(target: SelectedObject): void {
      this.selected = target
      if (target.kind === 'road') this.lastMetroRouteId = target.id
      this.focusSeq += 1
    },

    /** 从地铁站点详情返回最近一次选中的线路（无历史线路时返回 false） */
    backToMetroRoute(): boolean {
      const id = this.lastMetroRouteId
      if (id === null) return false
      const route = getRoute(id)
      if (!route) return false
      this.focus({ kind: 'road', id, name: route.name })
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
      // 离开测距面板时自动退出测量状态（已绘制的图形保留）
      if (view !== 'measure' && this.measureMode !== 'none') this.measureMode = 'none'
      // 离开空间分析面板时退出选点模式
      if (view !== 'analysis') this.nearbyPickMode = false
      // 离开路线规划面板时退出起终点选点
      if (view !== 'route') this.routePickTarget = null
    },

    /** 切换测量模式（同一模式再次点击由面板负责置为 none） */
    setMeasureMode(mode: MeasureMode | 'none'): void {
      this.measureMode = mode
      if (mode === 'none') this.measureResult = null
    },

    /** 引擎测量结果回调 */
    setMeasureResult(result: MeasureResult | null): void {
      this.measureResult = result
    },

    /** 清除测量图形与结果 */
    clearMeasure(): void {
      this.measureResult = null
      this.measureClearSeq += 1
    },

    // ---------- 空间分析：附近站点查询 ---------- //
    /** 选择搜索半径；已有查询中心时按新半径自动重查 */
    setNearbyRadius(radius: number): void {
      this.nearbyRadius = radius
      if (this.nearbyCenter) void this.loadNearbyStops()
    },

    /** 进入地图选点模式（点击地图确定查询中心） */
    startNearbyPick(): void {
      this.routePickTarget = null
      this.nearbyPickMode = true
      this.nearbyError = null
    },

    cancelNearbyPick(): void {
      this.nearbyPickMode = false
    },

    /** 引擎选点回调：以该坐标为圆心查询附近站点 */
    async pickNearbyCenter(point: LngLat): Promise<void> {
      this.nearbyPickMode = false
      this.nearbyCenter = point
      await this.loadNearbyStops()
    },

    /** 调用后端 PostGIS 附近站点查询（距离排序在后端完成） */
    async loadNearbyStops(): Promise<void> {
      const center = this.nearbyCenter
      if (!center) return
      this.nearbyLoading = true
      this.nearbyError = null
      try {
        this.nearbyResult = await analysisApi.nearbyStops(
          center[0],
          center[1],
          this.nearbyRadius,
        )
        this.nearbyCenter = this.nearbyResult.center
      } catch (err) {
        this.nearbyResult = null
        this.nearbyError = err instanceof Error ? err.message : '附近站点查询失败'
      } finally {
        this.nearbyLoading = false
      }
    },

    clearNearby(): void {
      this.nearbyCenter = null
      this.nearbyResult = null
      this.nearbyError = null
      this.nearbyPickMode = false
      this.nearbyLoading = false
    },

    /** 定位到附近站点列表中的某一站（地图飞行由引擎完成） */
    focusNearbyStop(stop: NearbyStop): void {
      this.selected = stop.kind === 'metro'
        ? { kind: 'station', id: stop.id, name: stop.name }
        : { kind: 'busStop', id: stop.id, name: stop.name }
      this.focusPoint = [stop.lon, stop.lat]
      this.focusPointSeq += 1
    },

    // ---------- 路线规划 ---------- //
    /** 进入地图选点：选择起点或终点 */
    startRoutePick(target: RoutePickTarget): void {
      this.nearbyPickMode = false
      this.routePickTarget = target
      this.routePlanError = null
      this.routePlanNotice = null
    },

    cancelRoutePick(): void {
      this.routePickTarget = null
    },

    /** 引擎选点回调：写入起点 / 终点，两端齐备后自动规划 */
    async pickRoutePoint(point: LngLat): Promise<void> {
      const target = this.routePickTarget
      if (!target) return
      if (target === 'origin') this.routeOrigin = point
      else this.routeDestination = point
      this.routePickTarget = null
      this.routePlanResult = null
      this.routeSelectedId = null
      this.routePlanNotice = null
      if (this.routeOrigin && this.routeDestination) await this.loadRoutePlan()
    },

    /** 交换起点与终点 */
    async swapRouteEndpoints(): Promise<void> {
      const origin = this.routeOrigin
      this.routeOrigin = this.routeDestination
      this.routeDestination = origin
      if (this.routeOrigin && this.routeDestination) await this.loadRoutePlan()
    },

    setRouteStrategy(strategy: number): void {
      if (this.routeStrategy === strategy) return
      this.routeStrategy = strategy
      // 已选好起终点时按新策略重新规划
      if (this.routeOrigin && this.routeDestination) void this.loadRoutePlan()
    },

    /** 调用后端路线规划（起终点为 WGS84 经纬度） */
    async loadRoutePlan(): Promise<void> {
      const origin = this.routeOrigin
      const destination = this.routeDestination
      if (!origin || !destination) return
      this.routePlanLoading = true
      this.routePlanError = null
      this.routePlanNotice = null
      try {
        const result = await transitApi.plan({
          origin,
          destination,
          strategy: this.routeStrategy,
        })
        this.routePlanResult = result
        this.routeSelectedId = result.alternatives[0]?.id ?? null
      } catch (err) {
        this.routePlanResult = null
        this.routeSelectedId = null
        if (err instanceof TransitApiError && err.code === 50003) {
          // 确实无可用方案：以引导提示展示，不按错误处理
          this.routePlanNotice = err.message
        } else {
          this.routePlanError = err instanceof Error ? err.message : '路线规划失败'
        }
      } finally {
        this.routePlanLoading = false
      }
    },

    selectRouteAlternative(id: string): void {
      this.routeSelectedId = id
    },

    /** 清除规划结果与起终点（地图图层同步清空） */
    clearRoutePlan(): void {
      this.routeOrigin = null
      this.routeDestination = null
      this.routePickTarget = null
      this.routePlanResult = null
      this.routeSelectedId = null
      this.routePlanError = null
      this.routePlanNotice = null
      this.routePlanLoading = false
    },

    // ---------- 空间分析：缓冲区覆盖 ---------- //
    setCoverageRadius(radius: number): void {
      this.coverageRadius = radius
    },

    setCoverageKind(kind: CoverageKind): void {
      this.coverageKind = kind
    },

    /** 调整缓冲区图层透明度 */
    setCoverageOpacity(value: number): void {
      this.coverageOpacity = Math.min(1, Math.max(0.05, value))
    },

    /** 执行覆盖分析：缓冲区、并集、重叠面积与重叠站点均由后端 PostGIS 计算 */
    async runCoverageAnalysis(): Promise<void> {
      this.coverageLoading = true
      this.coverageError = null
      try {
        this.coverageResult = await analysisApi.stationBuffers(
          this.coverageRadius,
          this.coverageKind,
        )
      } catch (err) {
        this.coverageResult = null
        this.coverageError = err instanceof Error ? err.message : '缓冲区覆盖分析失败'
      } finally {
        this.coverageLoading = false
      }
    },

    clearCoverage(): void {
      this.coverageResult = null
      this.coverageError = null
      this.coverageLoading = false
    },

    setStationBufferRadius(radius: number): void {
      this.stationBufferRadius = radius
    },

    async runStationBuffer(stop: { kind: 'metro' | 'bus'; id: string; name: string }): Promise<void> {
      this.stationBufferLoading = true
      this.stationBufferError = null
      this.selected = stop.kind === 'metro'
        ? { kind: 'station', id: stop.id, name: stop.name }
        : { kind: 'busStop', id: stop.id, name: stop.name }
      try {
        this.stationBufferResult = await analysisApi.stationBuffer(
          stop.kind, stop.id, this.stationBufferRadius,
        )
      } catch (err) {
        this.stationBufferResult = null
        this.stationBufferError = err instanceof Error ? err.message : '缓冲区分析失败'
      } finally {
        this.stationBufferLoading = false
      }
    },

    clearStationBuffer(): void {
      this.stationBufferResult = null
      this.stationBufferError = null
    },

    // ---------- 选中公交路线 ---------- //
    /** 选中一条公交线路（切换会触发引擎加载 GeoJSON 叠加层，并同步属性面板） */
    selectBusRoute(id: number | null): void {
      this.selectedBusRoute = id
      if (id === null) {
        if (this.selected?.kind === 'busRoute' || this.selected?.kind === 'busStop') {
          this.selected = null
        }
        return
      }
      this.lastBusRouteId = id
      const summary = getRouteSummary(id)
      this.selected = {
        kind: 'busRoute',
        id: String(id),
        name: summary?.route_cn ?? '公交线路',
      }
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
      this.selected = { kind: 'busStop', id: stopId, name }
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
