/**
 * 三维地图引擎（Cesium 实现）
 *
 * 实现 common/types/engine 的 MapEngine 契约，与 Map2DEngine 可互换：
 * - 底面：GridImageryProvider 程序化网格（非静态贴图、无需在线影像）
 * - 业务对象：roads / stations / analysis 三组实体，职责与 2D 图层一一对应
 * - 选中高亮：站点改写既有实体样式；线路直接改写圆管材质并叠加恒定像素宽核心线，不重建业务实体
 * - 范围约束：相机位置始终钳制在成都市域内（高度 300m~300km），
 *   平移 / 旋转 / 俯仰等三维立体操作不受限制
 */

import * as Cesium from 'cesium'

import { getRouteDetail } from '@/common/data/busRepository'
import type { BusRouteFeature, BusStopProps } from '@/common/types/bus'
import type { GeoJSONFeatureCollection } from '@/common/types/geo'
import {
  allRouteFeatures,
  allStopFeatures,
  ensureMetroLoaded,
  getRoute,
  getRoutePath,
  getStop,
  getStopFeature,
  getStopPoint,
} from '@/common/data/metroRepository'
import type { CameraState, LngLat } from '@/common/types/geo'
import type { NearbyStopsResult, StationBufferResult } from '@/common/types/analysis'
import type { MeasureAnnotation } from '@/common/types/measure'
import type {
  MapEngine,
  MapEngineEvents,
  MapMode,
  SelectedObject,
} from '@/common/types/engine'
import { DEFAULT_LAYER_VISIBILITY, type LayerId } from '@/common/constants/layers'
import { BUS_WMS_LAYERS, BUS_WMS_URL } from '@/map2d/config/busWms'
import { PALETTE } from '@/common/constants/colors'
import { TypedEmitter } from '@/common/utils/emitter'
import { toRad } from '@/tools'
import {
  CAMERA_LIMITS,
  GRID_STYLE,
  MAP3D_CAMERA,
  heightToZoom,
  zoomToHeight,
} from './config/viewer'
import { createBaseMapLayers3D, DEFAULT_3D_BASEMAP_FALLBACK, DEFAULT_3D_BASEMAP_ID } from './config/basemaps'
import { createBusRouteEntities, createBusStopEntities, createRoadEntities, removeBusRouteEntities } from './entities/roads'
import type { RoadRenderOptions } from './entities/roads'
import { createAllStations } from './entities/stations'
import { createNearbyEntities, removeNearbyEntities } from './entities/analysis'
import { createStationBufferEntities, removeStationBufferEntities } from './entities/stationBuffer'
import { MeasureController3D } from './measure/measureController3D'

const ACCENT = Cesium.Color.fromCssColorString(PALETTE.accent)
const ACCENT_LIGHT = Cesium.Color.fromCssColorString(PALETTE.accentLight)
const STATION_HIGHLIGHT_COLOR = Cesium.Color.fromCssColorString(PALETTE.accentLight)

function stationRouteHeading(stopId: string): number {
  const stop = getStopFeature(stopId)?.properties
  if (!stop) return 0
  const routeNames = new Set(stop.lines.map((line) => line.name))
  const point = getStopPoint(stopId)
  if (!point) return 0

  for (const feature of allRouteFeatures().features) {
    if (!routeNames.has(feature.properties.route_cn)) continue
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') continue
    const paths: LngLat[][] = feature.geometry.type === 'MultiLineString'
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates]
    for (const path of paths) {
      let nearestIndex = -1
      let nearestDistance = Number.POSITIVE_INFINITY
      for (let i = 0; i < path.length; i++) {
        const candidate = path[i]
        if (!candidate) continue
        const dx = (candidate[0] - point[0]) * Math.cos(Cesium.Math.toRadians(point[1]))
        const dy = candidate[1] - point[1]
        const distance = dx * dx + dy * dy
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = i
        }
      }
      if (nearestIndex < 0 || nearestDistance > 0.00001) continue
      const start = path[Math.max(0, nearestIndex - 1)]
      const end = path[Math.min(path.length - 1, nearestIndex + 1)]
      if (!start || !end) continue
      const east = (end[0] - start[0]) * Math.cos(Cesium.Math.toRadians(point[1]))
      const north = end[1] - start[1]
      return Cesium.Math.zeroToTwoPi(Math.atan2(east, north))
    }
  }
  return 0
}

/** Cesium may return an Entity as `id`, while primitives expose the string id. */
function rawIdOf(picked: unknown): string | null {
  if (!picked || typeof picked !== 'object') return null
  const hit = picked as {
    id?: unknown
    primitive?: { id?: unknown }
  }
  const rawId = hit.id ?? hit.primitive?.id
  if (typeof rawId === 'string' || typeof rawId === 'number') return String(rawId)
  if (rawId && typeof rawId === 'object' && 'id' in rawId) {
    return String((rawId as { id: unknown }).id)
  }
  return null
}

function bizKeyOf(picked: unknown): string | null {
  const id = rawIdOf(picked)
  if (!id) return null
  const parts = id.split(':')
  if (parts.length < 2) return null
  if (parts[0] === 'road-volume' && parts.length >= 3) return `road:${parts[1]}`
  if (parts[0] === 'bus-route' && parts.length >= 3) return `busRoute:${parts[1]}`
  const key = `${parts[0]}:${parts[1]}`
  return /^(road|station):/.test(key) ? key : null
}

export class Map3DEngine extends TypedEmitter<MapEngineEvents> implements MapEngine {
  readonly mode: MapMode = '3d'

  private viewer: Cesium.Viewer | null = null
  private handler: Cesium.ScreenSpaceEventHandler | null = null
  /** 业务实体索引：`<kind>:<id>` → 主实体（flyTo 用） */
  private entityIndex = new Map<string, Cesium.Entity>()
  /** 当前线路高亮对应的原始材质快照 */
  private highlightedRoad: Array<{
    entity: Cesium.Entity
    material: Cesium.MaterialProperty
    volume: boolean
  }> = []
  private selectedRoadId: string | null = null
  private contextRoadId: string | null = null
  private selectedStationEntities: Array<{
    entity: Cesium.Entity
    pointPixelSize?: Cesium.Property | undefined
    pointColor?: Cesium.Property | undefined
    pointOutlineColor?: Cesium.Property | undefined
    pointOutlineWidth?: Cesium.Property | undefined
    boxMaterial?: Cesium.MaterialProperty | undefined
    boxOutlineColor?: Cesium.Property | undefined
    modelSilhouetteColor?: Cesium.Property | undefined
    modelSilhouetteSize?: Cesium.Property | undefined
  }> = []
  /** 分析选点 / 路线规划选点模式（互斥，与 2D 引擎行为一致） */
  private pickPointMode = false
  private routePickMode = false
  /** 每帧相机钳制回调（destroy 时移除） */
  private clampCallback: Cesium.Event.RemoveCallback | null = null
  /** 底图回退：剩余候选列表、瓦片错误计数、错误事件移除回调 */
  private basemapFallbackQueue: string[] = []
  private basemapErrorCount = 0
  private basemapErrorRemovers: Array<() => void> = []
  private currentBasemapId: string | null = null
  private roadRenderOptions: Partial<RoadRenderOptions>
  private networkMode: 'metro' | 'bus' = 'metro'
  private busPickRequestGeneration = 0
  private roadsVisible = true
  private selectedBusRouteId: number | null = null
  private busRouteRequestGeneration = 0
  private selectedBusEntities: Cesium.Entity[] = []
  private selectedBusStopMarkers: Cesium.Entity[] = []
  private selectedBusStopLabels: Cesium.Entity[] = []
  /** 选中公交线路的站点符号 / 名称注记显隐（由 bus-control-popup 经 store 同步） */
  private busRouteStopsVisible = true
  private busRouteNamesVisible = true
  private layerVisibility: Record<LayerId, boolean> = { ...DEFAULT_LAYER_VISIBILITY }
  private busImageryLayers: Partial<Record<'busRoutes' | 'busStops' | 'busStopNames', Cesium.ImageryLayer>> = {}
  private basemapImageryLayers: Cesium.ImageryLayer[] = []
  /** 附近站点分析覆盖物（本引擎实例独立持有，与 2D 引擎互不影响） */
  private nearbyEntities: Cesium.Entity[] = []
  /** 单站缓冲区分析覆盖物（本引擎实例独立持有，与 2D 图层互不影响） */
  private stationBufferEntities: Cesium.Entity[] = []
  /** 3D 测量控制器（Cesium 独立实现，与 2D 的 MeasureController 互不共享） */
  private measure3d: MeasureController3D | null = null

  constructor(
    private readonly onBasemapChange?: (id: string) => void,
    roadRenderOptions: Partial<RoadRenderOptions> = {},
  ) {
    super()
    this.roadRenderOptions = roadRenderOptions
  }


  /* ---------------- 生命周期 ---------------- */

  async init(container: HTMLElement): Promise<void> {
    this.destroy()

    // 从后端加载成都地铁数据（幂等缓存）
    await ensureMetroLoaded()

    // 版权球挂到离屏节点：由平台界面统一承担信息展示
    const creditContainer = document.createElement('div')
    const viewer = new Cesium.Viewer(container, {
      // 不预先塞 baseLayer，setBaseMap 会统一装配（初始化与运行时切换走同一路径，避免分叉）
      creditContainer,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
    })

    this.configureScene(viewer.scene)
    this.configureCameraLimits(viewer)
    this.viewer = viewer
    this.layerVisibility = { ...DEFAULT_LAYER_VISIBILITY }
    this.createBusImageryLayers()

    // ---- 业务实体装配（与 2D 图层一一对应） ----
    for (const feature of allRouteFeatures().features) {
      // 线路仅渲染原色单线（无 casing 外描边），颜色与 2D 同源
      const main = createRoadEntities(viewer.entities, feature, this.roadRenderOptions)
      this.entityIndex.set(`road:${feature.properties.id}`, main)
    }
    createAllStations(viewer.entities, allStopFeatures())
    for (const feature of allStopFeatures().features) {
      const stopId = feature.properties.stop_id
      const entity = viewer.entities.values.find(
        (e) => e.id === `station:${stopId}` || (typeof e.id === 'string' && e.id.startsWith(`station:${stopId}:`) && !e.id.endsWith(':label')),
      )
      if (entity) this.entityIndex.set(`station:${stopId}`, entity)
    }

    this.applyNetworkVisibility()
    this.bindPicking(viewer)
    this.measure3d = new MeasureController3D({
      viewer,
      onDraft: (result) => this.emit('measure', result),
      onComplete: (annotation) => this.emit('measureComplete', annotation),
      onUpdate: (annotation) => this.emit('measureUpdate', annotation),
    })
    this.resetView()
    this.emit('ready')
  }

  /** 深色场景外观：隐藏星空 / 大气 / 光照，网格底面由底图承担 */
  private configureScene(scene: Cesium.Scene): void {
    scene.backgroundColor = Cesium.Color.fromCssColorString(PALETTE.bgDeep)
    scene.skyBox!.show = false
    scene.skyAtmosphere!.show = false
    scene.sun!.show = false
    scene.moon!.show = false
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#0C1424')
    scene.globe.showGroundAtmosphere = false
    scene.globe.enableLighting = false
    if (scene.fog) scene.fog.enabled = false
  }

  /**
   * 相机范围约束：只限制「能在哪里」，不限制「怎么操作」。
   * - 缩放距离限制 [300m, 300km]（贴近观察 ↔ 全市概览）
   * - 每帧把相机经纬度钳制回成都市域矩形；平移 / 旋转 / 俯仰完全自由
   */
  private configureCameraLimits(viewer: Cesium.Viewer): void {
    const controller = viewer.scene.screenSpaceCameraController
    controller.minimumZoomDistance = CAMERA_LIMITS.minHeight
    controller.maximumZoomDistance = CAMERA_LIMITS.maxHeight
    // 保留全部三维操作能力（默认即开启，显式声明以防外部改动）
    controller.enableTilt = true
    controller.enableRotate = true
    controller.enableTranslate = true
    controller.enableLook = true
    controller.enableZoom = true

    const [minLon, minLat, maxLon, maxLat] = CAMERA_LIMITS.extent
    this.clampCallback = viewer.scene.preRender.addEventListener(() => {
      const camera = viewer.camera
      const carto = camera.positionCartographic
      const lon = Cesium.Math.toDegrees(carto.longitude)
      const lat = Cesium.Math.toDegrees(carto.latitude)
      const clampedLon = Math.min(maxLon, Math.max(minLon, lon))
      const clampedLat = Math.min(maxLat, Math.max(minLat, lat))
      const height = Math.min(CAMERA_LIMITS.maxHeight, Math.max(CAMERA_LIMITS.minHeight, carto.height))
      if (clampedLon !== lon || clampedLat !== lat || height !== carto.height) {
        camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(clampedLon, clampedLat, height),
          orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
        })
      }
    })
  }

  /** 拾取：单击选择业务对象（选点模式下改为上报坐标），移动上报经纬度 */
  private bindPicking(viewer: Cesium.Viewer): void {
    // 关闭默认双击跟踪实体行为
    viewer.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    )

    this.handler = this.handler ?? new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    this.handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // 测量交互期间不触发业务对象点选
      if (this.measure3d?.active) return
      const busPickGeneration = ++this.busPickRequestGeneration
      const point = this.screenToLngLat(viewer, movement.position)
      if (point && (this.routePickMode || this.pickPointMode)) {
        // 选点模式：坐标直接供业务使用，不触发对象选中
        if (this.routePickMode) this.emit('routePickPoint', point)
        else this.emit('pickPoint', point)
        return
      }
      if (!point) {
        this.emit('select', null)
        return
      }
      const picks = viewer.scene.drillPick(movement.position, 16)
      const pickedKey = picks.find((pick) => rawIdOf(pick)?.startsWith('bus-route:'))
        ? bizKeyOf(picks.find((pick) => rawIdOf(pick)?.startsWith('bus-route:')))
        : picks.find((pick) => rawIdOf(pick)?.startsWith('road-volume:'))
          ? bizKeyOf(picks.find((pick) => rawIdOf(pick)?.startsWith('road-volume:')))
          : picks.map(bizKeyOf).find((key) => key?.startsWith('road:'))
            ?? picks.map(bizKeyOf).find((key) => key?.startsWith('station:'))
            ?? bizKeyOf(viewer.scene.pick(movement.position))
      // 点中线路高亮核心线时不改变现有选中（避免反复取消/重选）
      if (!pickedKey && picks.some((pick) => rawIdOf(pick) === 'highlight:road')) return
      if (pickedKey) {
        this.emit('select', this.toObject(pickedKey))
        return
      }
      if (this.networkMode === 'bus' && this.layerVisibility.busRoutes && point) {
        const tolerance = this.busPickTolerance(viewer.camera.positionCartographic.height)
        void this.pickBusRouteAt(point, tolerance, busPickGeneration)
        return
      }
      this.emit('select', null)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const viewer = this.viewer
      if (!viewer) return
      const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid)
      if (!cartesian) return
      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      this.emit('pointer', [
        Cesium.Math.toDegrees(carto.longitude),
        Cesium.Math.toDegrees(carto.latitude),
      ])
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  }

  /** 屏幕坐标 → WGS84 经纬度（拾不到球面时返回 null） */
  private screenToLngLat(
    viewer: Cesium.Viewer,
    position: Cesium.Cartesian2,
  ): LngLat | null {
    const cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid)
    if (!cartesian) return null
    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    return [
      Cesium.Math.toDegrees(carto.longitude),
      Cesium.Math.toDegrees(carto.latitude),
    ]
  }

  private busPickTolerance(cameraHeight: number): number {
    const viewportHeight = this.viewer?.canvas.clientHeight ?? 0
    if (viewportHeight <= 0) return 60
    return Math.round(Math.min(300, Math.max(20, cameraHeight / viewportHeight * 6)))
  }

  private async pickBusRouteAt(
    point: LngLat,
    tolerance: number,
    generation: number,
  ): Promise<void> {
    try {
      const { busApi } = await import('@/common/services/bus')
      const picked = await busApi.pickRoute(point[0], point[1], tolerance)
      if (generation !== this.busPickRequestGeneration) return
      const target = picked ? {
        kind: 'busRoute' as const,
        id: String(picked.id),
        name: picked.route_cn,
      } : null
      this.emit('select', target)
      if (target) void this.selectBusRoute(Number(target.id))
    } catch {
      // Keep map interaction responsive when the lookup service is unavailable.
    }
  }

  private async flyToBusStop(stopId: string): Promise<void> {
    try {
      const { busApi } = await import('@/common/services/bus')
      const { lon, lat } = await busApi.getStopLocation(stopId)
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !this.viewer) return
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 900),
        duration: 0.6,
      })
    } catch {
      // Keep the current camera when stop coordinates are unavailable.
    }
  }

  private flyToBusRoute(route: BusRouteFeature, stops: GeoJSONFeatureCollection<BusStopProps>): void {
    if (!this.viewer) return
    const orderedStops = stops.features
      .filter((stop) => stop.geometry.type === 'Point' && Number.isFinite(stop.properties.frac))
      .sort((a, b) => (a.properties.frac ?? 0) - (b.properties.frac ?? 0))
    const middleStop = orderedStops[Math.floor(orderedStops.length / 2)]
    if (middleStop?.geometry.type === 'Point') {
      const [lon, lat] = middleStop.geometry.coordinates
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 900),
        duration: 0.6,
      })
      return
    }

    const geometry = route.geometry
    if (!geometry) return
    const coordinates = geometry.type === 'LineString'
      ? geometry.coordinates
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates.flat()
        : []
    if (coordinates.length === 0) return
    const positions = coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
    void this.viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(positions), {
      duration: 0.6,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 1600),
    })
  }

  private toObject(bizKey: string): SelectedObject | null {
    const [kind, id] = bizKey.split(':') as [string, string]
    if (kind === 'road') {
      const route = getRoute(id)
      return route ? { kind: 'road', id, name: route.name } : null
    }
    if (kind === 'station') {
      const stop = getStop(id)
      return stop ? { kind: 'station', id, name: stop.name } : null
    }
    if (kind === 'busRoute') {
      return { kind: 'busRoute', id, name: `公交线路 ${id}` }
    }
    return null
  }

  /* ---------------- 契约方法 ---------------- */

  setLayerVisible(id: LayerId, visible: boolean): void {
    this.layerVisibility[id] = visible
    if (id === 'roads') {
      this.roadsVisible = visible
      this.updateBusRouteVisibility()
    }
    if (id === 'busRoutes' || id === 'busStops' || id === 'busStopNames') {
      const layer = this.busImageryLayers[id]
      if (layer) layer.show = this.networkMode === 'bus' && visible
      if (id === 'busRoutes') this.updateBusRouteVisibility()
      return
    }
    const prefixByLayer: Partial<Record<LayerId, string[]>> = {
      roads: ['road:', 'road-volume:'],
      stations: ['station:'],
      stationLabels: ['station:'],
      models3d: ['station:'],
    }
    const prefixes = prefixByLayer[id]
    if (!prefixes || !this.viewer) return
    // 说明：models3d 与 stations 同属车站实体组，3D 下统一由
    // 「三维车站模型」开关控制盒体可见性，符号与注记跟随「站点符号」开关。
    const controlModels = id === 'models3d'
    const controlLabels = id === 'stationLabels'
    this.viewer.entities.values
      .filter((e) => typeof e.id === 'string' && prefixes.some((prefix) => e.id.startsWith(prefix)))
      .forEach((entity) => {
        // 盒体（box）与导入模型（model）均属于三维模型，标签属于注记，其余为点符号
        const isModelPart = entity.box !== undefined || entity.model !== undefined
        const isLabelPart = entity.label !== undefined
        if (controlModels !== isModelPart) return
        if (controlLabels !== isLabelPart) return
        entity.show = visible && this.networkMode === 'metro'
      })
  }

  setSelected(target: SelectedObject | null): void {
    this.selectedRoadId = target?.kind === 'road' ? target.id : null
    this.refreshHighlight(target)
  }

  setContextRoad(target: SelectedObject | null): void {
    const roadId = target?.kind === 'road' ? target.id : null
    if (roadId === this.contextRoadId && this.highlightedRoad.length > 0) return
    this.contextRoadId = roadId
    this.refreshRoadHighlight()
  }

  /** 开启 / 关闭分析选点模式（点击地图发出 pickPoint） */
  setPickPointMode(active: boolean): void {
    this.pickPointMode = active
    if (active) this.routePickMode = false
  }

  /** 开启 / 关闭路线规划选点模式（点击地图发出 routePickPoint） */
  setRoutePickMode(active: boolean): void {
    this.routePickMode = active
    if (active) this.pickPointMode = false
  }

  /**
   * 渲染 / 清除附近站点分析覆盖物（null 表示清除）。
   * 先整体移除旧实体再重建，重复渲染不产生残留。
   */
  renderNearbyStops(result: NearbyStopsResult | null): void {
    if (this.viewer) removeNearbyEntities(this.viewer.entities)
    this.nearbyEntities = []
    if (!result || !this.viewer) return
    this.nearbyEntities = createNearbyEntities(this.viewer.entities, result)
  }

  /**
   * 渲染 / 清除单站缓冲区分析结果（null 表示清除）。
   * 3D 独立实现：缓冲面 + 范围内站点 / 线路实体，先整体移除再重建，不产生残留。
   */
  renderStationBuffer(result: StationBufferResult | null): void {
    if (this.viewer) removeStationBufferEntities(this.viewer.entities)
    this.stationBufferEntities = []
    if (!result || !this.viewer) return
    this.stationBufferEntities = createStationBufferEntities(this.viewer.entities, result)
  }

  /** Switch the full network between metro entities and bus WMS layers. */
  setNetworkMode(mode: 'metro' | 'bus'): void {
    this.networkMode = mode
    this.applyNetworkVisibility()
    this.updateBusRouteVisibility()
  }

  private createBusImageryLayers(): void {
    if (!this.viewer) return
    const definitions = [
      ['busRoutes', BUS_WMS_LAYERS.routes],
      ['busStops', BUS_WMS_LAYERS.stops],
      ['busStopNames', BUS_WMS_LAYERS.stopNames],
    ] as const
    for (const [id, layerName] of definitions) {
      const layer = new Cesium.ImageryLayer(new Cesium.WebMapServiceImageryProvider({
        url: BUS_WMS_URL,
        layers: layerName,
        parameters: { service: 'WMS', version: '1.1.1', format: 'image/png', transparent: true, srs: 'EPSG:4326' },
      }), { show: false })
      this.viewer.imageryLayers.add(layer)
      this.busImageryLayers[id] = layer
    }
  }

  private applyNetworkVisibility(): void {
    if (!this.viewer) return
    this.viewer.entities.values.forEach((entity) => {
      if (typeof entity.id !== 'string') return
      const isMetro = /^(road|road-volume|station):/.test(entity.id)
      if (!isMetro) return
      const visible = this.networkMode === 'metro'
      if (entity.id.startsWith('road:') || entity.id.startsWith('road-volume:')) {
        entity.show = visible && this.layerVisibility.roads
      } else if (entity.box || entity.model) {
        entity.show = visible && this.layerVisibility.models3d
      } else if (entity.label) {
        entity.show = visible && this.layerVisibility.stationLabels
      } else {
        entity.show = visible && this.layerVisibility.stations
      }
    })
    for (const id of ['busRoutes', 'busStops', 'busStopNames'] as const) {
      const layer = this.busImageryLayers[id]
      if (layer) layer.show = this.networkMode === 'bus' && this.layerVisibility[id]
    }
  }

  async selectBusRoute(id: number | null): Promise<void> {
    const generation = ++this.busRouteRequestGeneration
    this.selectedBusRouteId = id
    this.removeSelectedBusRoute()
    if (id === null || !this.viewer) return

    try {
      const detail = await getRouteDetail(id)
      if (generation !== this.busRouteRequestGeneration || id !== this.selectedBusRouteId || !this.viewer) return
      this.selectedBusEntities = createBusRouteEntities(this.viewer.entities, detail.route as BusRouteFeature)
      const stopEntities = createBusStopEntities(
        this.viewer.entities,
        detail.stops ?? { type: 'FeatureCollection', features: [] },
      )
      this.selectedBusStopMarkers = stopEntities.markers
      this.selectedBusStopLabels = stopEntities.labels
      this.updateBusRouteVisibility()
      if (this.networkMode === 'bus' && this.viewer.camera) {
        this.flyToBusRoute(detail.route as BusRouteFeature, detail.stops)
      }
    } catch (error) {
      if (generation === this.busRouteRequestGeneration) {
        console.error(`Failed to load selected bus route ${id}`, error)
      }
    }
  }

  private removeSelectedBusRoute(): void {
    if (this.viewer) removeBusRouteEntities(this.viewer.entities)
    this.selectedBusEntities = []
    this.selectedBusStopMarkers = []
    this.selectedBusStopLabels = []
  }

  private updateBusRouteVisibility(): void {
    const baseVisible = this.networkMode === 'bus'
      && this.layerVisibility.busRoutes
      && this.roadsVisible
      && this.selectedBusRouteId !== null
    this.selectedBusEntities.forEach((entity) => { entity.show = baseVisible })
    this.selectedBusStopMarkers.forEach((entity) => { entity.show = baseVisible && this.busRouteStopsVisible })
    this.selectedBusStopLabels.forEach((entity) => { entity.show = baseVisible && this.busRouteNamesVisible })
  }

  setBusRouteStopsVisible(visible: boolean): void {
    this.busRouteStopsVisible = visible
    this.updateBusRouteVisibility()
  }

  setBusRouteNamesVisible(visible: boolean): void {
    this.busRouteNamesVisible = visible
    this.updateBusRouteVisibility()
  }

  /** 高亮只修改并恢复既有实体：站点改 point/box/model 属性，线路同步改贴地线与立体层材质。 */
  private refreshHighlight(target: SelectedObject | null): void {
    if (!this.viewer) return
    this.restoreStationStyle()
    this.refreshRoadHighlight()
    if (!target || target.kind !== 'station') return
    const entities = this.viewer.entities.values.filter(
      (entity) => bizKeyOf({ id: entity.id }) === `station:${target.id}`,
    )
    for (const entity of entities) {
      const snapshot: NonNullable<typeof this.selectedStationEntities[number]> = { entity }
      if (entity.point) {
        snapshot.pointPixelSize = entity.point.pixelSize
        snapshot.pointColor = entity.point.color
        snapshot.pointOutlineColor = entity.point.outlineColor
        snapshot.pointOutlineWidth = entity.point.outlineWidth
        const size = entity.point.pixelSize?.getValue(Cesium.JulianDate.now()) ?? 11
        entity.point.pixelSize = new Cesium.ConstantProperty(size + 4)
        entity.point.color = new Cesium.ConstantProperty(STATION_HIGHLIGHT_COLOR)
        entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.WHITE)
        entity.point.outlineWidth = new Cesium.ConstantProperty(3)
      }
      if (entity.box) {
        snapshot.boxMaterial = entity.box.material
        snapshot.boxOutlineColor = entity.box.outlineColor
        entity.box.material = new Cesium.ColorMaterialProperty(ACCENT.withAlpha(0.95))
        entity.box.outlineColor = new Cesium.ConstantProperty(Cesium.Color.WHITE)
      }
      if (entity.model) {
        snapshot.modelSilhouetteColor = entity.model.silhouetteColor
        snapshot.modelSilhouetteSize = entity.model.silhouetteSize
        entity.model.silhouetteColor = new Cesium.ConstantProperty(ACCENT_LIGHT)
        entity.model.silhouetteSize = new Cesium.ConstantProperty(3)
      }
      this.selectedStationEntities.push(snapshot)
    }
  }

  private refreshRoadHighlight(): void {
    this.restoreRoadStyle()
    const roadId = this.selectedRoadId ?? this.contextRoadId
    if (!this.viewer || !roadId) return

    const roadKey = `road:${roadId}`
    const entities = this.viewer.entities.values.filter(
      (entity) => typeof entity.id === 'string' && (
        entity.id === roadKey
        || entity.id.startsWith(`${roadKey}:segment:`)
        || entity.id.startsWith(`road-volume:${roadId}:`)
      ),
    )
    for (const entity of entities) {
      if (entity.polyline) {
        this.highlightedRoad.push({ entity, material: entity.polyline.material, volume: false })
        entity.polyline.material = new Cesium.ColorMaterialProperty(ACCENT_LIGHT)
      }
      if (entity.polylineVolume) {
        this.highlightedRoad.push({ entity, material: entity.polylineVolume.material, volume: true })
        entity.polylineVolume.material = new Cesium.ColorMaterialProperty(ACCENT_LIGHT)
      }
    }
  }

  private restoreRoadStyle(): void {
    for (const snapshot of this.highlightedRoad) {
      if (snapshot.volume && snapshot.entity.polylineVolume) {
        snapshot.entity.polylineVolume.material = snapshot.material
      } else if (!snapshot.volume && snapshot.entity.polyline) {
        snapshot.entity.polyline.material = snapshot.material
      }
    }
    this.highlightedRoad = []
  }

  private restoreStationStyle(): void {
    for (const snapshot of this.selectedStationEntities) {
      const { entity } = snapshot
      if (entity.point) {
        entity.point.pixelSize = snapshot.pointPixelSize
        entity.point.color = snapshot.pointColor
        entity.point.outlineColor = snapshot.pointOutlineColor
        entity.point.outlineWidth = snapshot.pointOutlineWidth
      }
      if (entity.box) {
        entity.box.material = snapshot.boxMaterial
        entity.box.outlineColor = snapshot.boxOutlineColor
      }
      if (entity.model) {
        entity.model.silhouetteColor = snapshot.modelSilhouetteColor
        entity.model.silhouetteSize = snapshot.modelSilhouetteSize
      }
    }
    this.selectedStationEntities = []
  }

  /**
   * 在线底图切换（用户手动触发）：清空回退队列后按 id 重建
   * 与初始化走同一套 createBaseMapLayers3D 工厂，避免 Provider 参数分叉
   */
  setBaseMap(id: string): void {
    if (id === this.currentBasemapId) return
    // 用户手动切换底图时，清空自动回退队列，避免随后误触发回退
    this.basemapFallbackQueue = []
    this.basemapErrorCount = 0
    this.swapImageryLayers(id)
    this.currentBasemapId = id
    this.onBasemapChange?.(id)
  }

  /** 默认底图加载：优先 preferred，瓦片持续失败时按 fallbackQueue 自动回退。 */
  setBaseMapWithFallback(preferred: string, fallbackQueue: string[]): void {
    if (!this.viewer) return
    this.basemapFallbackQueue = [...fallbackQueue]
    this.basemapErrorCount = 0
    this.applyBasemap(preferred)
  }

  /** 回退路径装配底图：不清空回退队列，并绑定瓦片错误监听 */
  private applyBasemap(id: string): void {
    if (!this.viewer) return
    this.swapImageryLayers(id)
    this.attachBasemapErrorListeners()
    this.currentBasemapId = id
    this.onBasemapChange?.(id)
  }

  /** 实际执行 imageryLayers 替换（不碰回退队列） */
  private swapImageryLayers(id: string): void {
    if (!this.viewer) return
    this.detachBasemapErrorListeners()
    const layers = this.viewer.imageryLayers
    for (const layer of this.basemapImageryLayers) layers.remove(layer, true)
    this.basemapImageryLayers = createBaseMapLayers3D(id)
    for (const layer of this.basemapImageryLayers) layers.add(layer, 0)
  }

  private attachBasemapErrorListeners(): void {
    if (!this.viewer) return
    const threshold = 3
    for (const layer of this.basemapImageryLayers) {
      const remove = layer.errorEvent.addEventListener(() => {
        this.basemapErrorCount++
        if (this.basemapErrorCount >= threshold) {
          // 当前底图持续失败，取下一个候选项回退
          const next = this.basemapFallbackQueue.shift()
          if (next) {
            this.basemapErrorCount = 0
            this.applyBasemap(next)
          }
        }
      })
      this.basemapErrorRemovers.push(remove as unknown as () => void)
    }
  }

  private detachBasemapErrorListeners(): void {
    for (const remove of this.basemapErrorRemovers) {
      try { remove() } catch { /* noop */ }
    }
    this.basemapErrorRemovers = []
  }

  /** 3D 测量：Cesium 实体渲染 + 独立输入处理器 */
  setMeasureMode(mode: 'distance' | 'area' | null): void {
    this.measure3d?.setMode(mode)
  }

  clearMeasure(): void {
    this.measure3d?.clear()
  }

  /** 同步已完成测量标注（3D 独立渲染管线：Cesium 实体 + Label） */
  renderMeasureAnnotations(annotations: MeasureAnnotation[], selectedId: string | null): void {
    this.measure3d?.renderAnnotations(annotations, selectedId)
  }

  /** 进入 / 退出标注顶点编辑（拖拽顶点手柄） */
  setMeasureEditing(annotationId: string | null): void {
    this.measure3d?.setEditing(annotationId)
  }

  getCameraState(): CameraState {
    const camera = this.viewer?.camera
    if (!camera) {
      return {
        lon: MAP3D_CAMERA.lon,
        lat: MAP3D_CAMERA.lat,
        scale: heightToZoom(MAP3D_CAMERA.height),
        heading: toRad(MAP3D_CAMERA.headingDeg),
        pitch: toRad(MAP3D_CAMERA.pitchDeg),
        roll: 0,
      }
    }
    const carto = camera.positionCartographic
    return {
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      // scale 语义与 2D 对齐为 zoom 级别，跨模式切换时视角尺度可换算
      scale: heightToZoom(carto.height),
      height: carto.height,
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    }
  }

  applyCameraState(state: CameraState): void {
    this.viewer?.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.height ?? zoomToHeight(state.scale)),
      orientation: {
        heading: state.heading ?? 0,
        pitch: state.pitch ?? toRad(MAP3D_CAMERA.pitchDeg),
        roll: state.roll ?? 0,
      },
    })
  }

  resetView(): void {
    this.viewer?.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        MAP3D_CAMERA.lon,
        MAP3D_CAMERA.lat,
        MAP3D_CAMERA.height,
      ),
      orientation: {
        heading: toRad(MAP3D_CAMERA.headingDeg),
        pitch: toRad(MAP3D_CAMERA.pitchDeg),
        roll: 0,
      },
      duration: 0.8,
    })
  }

  /** 定位到业务对象（线路 → 沿线视角；站点 → 垂直俯视线路方向） */
  flyToObject(target: SelectedObject): void {
    if (!this.viewer) return
    if (target.kind === 'busRoute') {
      void this.selectBusRoute(Number(target.id))
      return
    }
    if (target.kind === 'busStop') {
      void this.flyToBusStop(target.id)
      return
    }
    if (target.kind === 'road') {
      const entity = this.entityIndex.get(`road:${target.id}`)
      if (entity) {
        this.viewer.flyTo(entity, {
          offset: new Cesium.HeadingPitchRange(0, toRad(-38), 3000),
          duration: 0.8,
        })
      }
      return
    }
    if (target.kind === 'station') {
      const point = getStopPoint(target.id)
      if (point) {
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(point[0], point[1], 900),
          orientation: {
            heading: stationRouteHeading(target.id),
            pitch: toRad(-90),
            roll: 0,
          },
          duration: 0.9,
        })
      }
    }
  }

  /** 定位到指定坐标（附近站点列表定位），zoom 与 2D 语义一致 */
  flyToPoint(point: LngLat, zoom = 15): void {
    this.viewer?.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        point[0],
        point[1],
        zoomToHeight(zoom),
      ),
      orientation: { heading: 0, pitch: toRad(MAP3D_CAMERA.pitchDeg), roll: 0 },
      duration: 0.9,
    })
  }

  destroy(): void {
    this.busPickRequestGeneration++
    this.busRouteRequestGeneration++
    this.selectedBusRouteId = null
    this.removeSelectedBusRoute()
    this.renderNearbyStops(null)
    this.renderStationBuffer(null)
    this.measure3d?.destroy()
    this.measure3d = null
    this.clampCallback?.()
    this.clampCallback = null
    this.detachBasemapErrorListeners()
    this.basemapFallbackQueue = []
    this.basemapErrorCount = 0
    this.busImageryLayers = {}
    this.basemapImageryLayers = []
    this.restoreRoadStyle()
    this.selectedRoadId = null
    this.contextRoadId = null
    this.restoreStationStyle()
    this.handler?.destroy()
    this.handler = null
    this.pickPointMode = false
    this.routePickMode = false
    this.entityIndex.clear()
    if (this.viewer) {
      this.viewer.destroy()
      this.viewer = null
    }
    this.clear()
  }
}
