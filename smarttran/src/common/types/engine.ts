/**
 * 地图引擎统一契约
 *
 * map2d（OpenLayers）与 map3d（Cesium）实现同一套 MapEngine 接口，
 * 上层（MapContainer / Pinia store / 面板组件）只依赖本契约编程，
 * 不感知具体地图库 —— 这是 2D/3D 可切换架构的核心约束。
 */

import type { CameraState, LngLat } from './geo'
import type { MeasureAnnotation, MeasureMode, MeasureResult } from './measure'
import type { NetworkMode } from './network'
import type { CoverageResult, NearbyStopsResult, StationBufferResult } from './analysis'
import type { TransitPlanResult } from './transit'
import type { LayerId } from '../constants/layers'
import type { MetroSimulationState } from './simulation'

export type MapMode = '2d' | '3d'

export type ObjectKind = 'road' | 'station' | 'busRoute' | 'busStop'

/** 被选中的业务对象（跨模式保持，见原型「2D/3D 业务身份保留」） */
export interface SelectedObject {
  kind: ObjectKind
  id: string
  name: string
}

/** 引擎事件表：上层通过 on() 订阅 */
export interface MapEngineEvents {
  /** 用户点选了地图对象（null 表示清除选择） */
  select: SelectedObject | null
  /** 指针移动（null 表示移出地图） */
  pointer: LngLat | null
  /** 测量草稿实时结果（null 表示草稿已清空） */
  measure: MeasureResult | null
  /** 完成一次测量，生成可编辑标注 */
  measureComplete: MeasureAnnotation
  /** 顶点编辑后标注几何 / 数值更新 */
  measureUpdate: MeasureAnnotation
  /** 分析选点：附近站点查询模式下点击地图返回的坐标 */
  pickPoint: LngLat
  /** 路线规划选点：点击地图返回起 / 终点坐标及来源模式 */
  routePickPoint: { point: LngLat; mode: MapMode }
  /** 引擎初始化完成 */
  ready: void
}

export interface MetroSimulationEngine {
  startMetroSimulation?(routeId: string, routeName: string, path: LngLat[]): Promise<void>
  stopMetroSimulation?(): void
  setMetroSimulationPaused?(paused: boolean): void
  setMetroSimulationTilesEnabled?(enabled: boolean): void
  setMetroSimulationOtherRoutesVisible?(visible: boolean): void
  setMetroSimulationSpeedMultiplier?(speed: number): void
  onMetroSimulationStateChange?(listener: (state: MetroSimulationState) => void): () => void
}

export interface MapEngine {
  readonly mode: MapMode

  /** 在指定容器内初始化（幂等，重复调用先销毁） */
  init(container: HTMLElement): Promise<void>

  /** 图层可见性（2D/3D 同一套图层 id） */
  setLayerVisible(id: LayerId, visible: boolean): void

  /** 切换交通网络：地铁 / 公交（两组图层互斥显示） */
  setNetworkMode(mode: NetworkMode): void

  /** 选中/取消选中公交线路（拉后端详情加载矢量叠加层） */
  selectBusRoute?(id: number | null): void | Promise<void>
  /** 选中公交线路的站点符号显隐（仅 2D 有效） */
  setBusRouteStopsVisible?(visible: boolean): void
  /** 选中公交线路的站点名称注记显隐（仅 2D 有效） */
  setBusRouteNamesVisible?(visible: boolean): void

  /** 外部驱动选中态（如「定位线路」按钮），引擎负责高亮与聚焦动画 */
  setSelected(target: SelectedObject | null): void

  /** 保留站点详情来源线路的选中高亮（仅支持地铁线路） */
  setContextRoad?(target: SelectedObject | null): void

  /** 开启 / 关闭分析选点模式（开启后点击地图发出 pickPoint 事件） */
  setPickPointMode?(active: boolean): void

  /** 开启 / 关闭路线规划选点模式（开启后点击地图发出 routePickPoint 事件） */
  setRoutePickMode?(active: boolean): void

  /** 渲染路线规划结果与起终点标记（markers 在无规划结果时也会显示） */
  renderRoutePlan?(
    result: TransitPlanResult | null,
    selectedId: string | null,
    origin?: LngLat | null,
    destination?: LngLat | null,
  ): void

  /** 渲染 / 清除附近站点分析覆盖物（null 表示清除） */
  renderNearbyStops?(result: NearbyStopsResult | null): void

  /** 渲染 / 清除单站缓冲区分析结果 */
  renderStationBuffer?(result: StationBufferResult | null): void

  /** 渲染 / 清除站点缓冲区覆盖物（opacity 为图层不透明度 0-1） */
  renderCoverage?(result: CoverageResult | null, opacity: number): void

  /** 调整缓冲区图层不透明度 */
  setCoverageOpacity?(opacity: number): void

  /** 飞行到指定坐标（附近站点列表定位） */
  flyToPoint?(point: LngLat, zoom?: number): void

  /** 启用 / 关闭测量交互（mode 为 null 时关闭） */
  setMeasureMode(mode: MeasureMode | null): void

  /** 清除测量图形与结果 */
  clearMeasure(): void

  /** 同步已完成测量标注（由 store 驱动，引擎负责地图渲染） */
  renderMeasureAnnotations?(annotations: MeasureAnnotation[], selectedId: string | null): void

  /** 进入 / 退出指定标注的顶点编辑模式（null 表示退出） */
  setMeasureEditing?(annotationId: string | null): void

  /** 切换在线底图（id 见 map2d/config/basemaps 注册表） */
  setBaseMap(id: string): void

  /** 定位 / 视角飞行到指定对象 */
  flyToObject(target: SelectedObject): void

  /** 相机状态读写（用于 2D/3D 切换时保持视角） */
  getCameraState(): CameraState
  applyCameraState(state: CameraState): void

  /** 视角复位到默认全景 */
  resetView(): void

  on<K extends keyof MapEngineEvents>(
    event: K,
    listener: MapEngineEvents[K] extends void ? () => void : (payload: MapEngineEvents[K]) => void,
  ): () => void

  /** 释放全部资源（WebGL 上下文 / DOM / 监听） */
  destroy(): void
}

export type MapEngineConstructor = new () => MapEngine
