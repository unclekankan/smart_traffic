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
import type { MapMode, SelectedObject, BufferOverlay } from '@/common/types/engine'
import type { NetworkMode } from '@/common/types/network'
import type { CameraState, LngLat } from '@/common/types/geo'
import type { MeasureMode, MeasureResult } from '@/common/types/measure'
import { analyzeStationBuffer, BUFFER_RADIUS_LIMITS, type BufferAnalysisResult } from '@/tools'
import { getSceneStats, getStopPoint } from '@/common/data/metroRepository'
import { getRouteSummary } from '@/common/data/busRepository'

/** 左侧功能栏视图标识 */
export type RailView = 'workbench' | 'layers' | 'analysis' | 'measure' | 'weather'

export const useMapStore = defineStore('map', {
  state: () => ({
    /** 当前地图模式（2D 默认，对应原型 2D/3D 切换） */
    mode: '2d' as MapMode,
    /** 当前交通网络（地铁 / 公交，互斥显示） */
    networkMode: 'metro' as NetworkMode,
    layerVisibility: { ...DEFAULT_LAYER_VISIBILITY } as Record<LayerId, boolean>,
    selected: null as SelectedObject | null,
    pointer: null as LngLat | null,
    /** 路网明度（%），映射到地图容器 CSS 亮度滤镜 */
    brightness: 85,
    /** 缓冲区半径（米） */
    bufferRadius: 300,
    bufferResult: null as BufferAnalysisResult | null,
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
    /** 引擎渲染用缓冲区载荷 */
    bufferOverlay(state): BufferOverlay | null {
      const r = state.bufferResult
      return r ? { center: r.center, radiusM: r.radiusM, hitIds: r.hits.map((h) => h.id) } : null
    },
  },

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
      this.focusSeq += 1
    },

    setPointer(point: LngLat | null): void {
      this.pointer = point
    },

    setBrightness(value: number): void {
      this.brightness = value
    },

    setBufferRadius(radius: number): void {
      const { min, max } = BUFFER_RADIUS_LIMITS
      this.bufferRadius = Math.min(max, Math.max(min, Math.round(radius)))
    },

    /** 对当前选中站点执行缓冲区分析 */
    runBufferAnalysis(): void {
      const sel = this.selected
      if (!sel || sel.kind !== 'station') return
      const point = getStopPoint(sel.id)
      if (!point) return
      this.bufferResult = analyzeStationBuffer(
        { id: sel.id, name: sel.name, coordinates: point },
        this.bufferRadius,
      )
    },

    clearBuffer(): void {
      this.bufferResult = null
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
