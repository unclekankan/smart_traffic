/**
 * 二维地图引擎（OpenLayers 实现）
 *
 * 实现 common/types/engine 的 MapEngine 契约：
 * 上层通过该接口驱动 2D 场景，与 3D（Cesium）可互换。
 * 图层装配在 layers/ 下按职责拆分，本类只负责编排与交互。
 */

import Map from 'ol/Map'
import View from 'ol/View'
import Overlay from 'ol/Overlay'
import ScaleLine from 'ol/control/ScaleLine'
import { unByKey } from 'ol/Observable'
import type { EventsKey } from 'ol/events'
import type LayerGroup from 'ol/layer/Group'

import {
  allRouteFeatures,
  allStopFeatures,
  ensureMetroLoaded,
  getRoute,
  getRouteMidpoint,
  getStop,
  getStopPoint,
} from '@/common/data/metroRepository'
import type { CameraState, GeoJSONFeatureCollection, LngLat } from '@/common/types/geo'
import type { MetroRouteProps, MetroStopProps } from '@/common/types/metro'
import type { CoverageResult, NearbyStopsResult } from '@/common/types/analysis'
import type {
  MapEngine,
  MapEngineEvents,
  MapMode,
  SelectedObject,
} from '@/common/types/engine'
import type { MeasureMode } from '@/common/types/measure'
import type { NetworkMode } from '@/common/types/network'
import { DEFAULT_LAYER_VISIBILITY, type LayerId } from '@/common/constants/layers'
import { useMapStore } from '@/stores/mapStore'
import { TypedEmitter } from '@/common/utils/emitter'

import { MAP2D_VIEW } from './config/view'
import { DEFAULT_BASEMAP_ID, type BasemapId } from './config/basemaps'
import { styleState } from './styles/shared'
import { createBaseMapGroup, setBaseMap } from './layers/basemap'
import { createRoadLayer } from './layers/roads'
import { createStationLayer } from './layers/stations'
import { createStationLabelLayer } from './layers/stationLabels'
import {
  createCoverageLayer,
  createNearbyLayer,
  renderCoverageOverlay,
  renderNearbyOverlay,
  renderStationBufferOverlay,
  setStationBufferSelection,
  stationBufferLayer,
} from './layers/analysis'
import { createBusRouteLayer, createBusStopLayer, createBusStopNameLayer } from './layers/bus'
import {
  createSelectedRouteLayer,
  createSelectedRouteNameLayer,
  createSelectedRouteSource,
  createSelectedRouteStopLayer,
  createSelectedRouteStopSource,
  createSelectedRouteNameSource,
  loadRouteFeature,
  loadStopFeatures,
} from './layers/selectedBus'
import { createMeasureLayer } from './measure/measureLayer'
import { MeasureController } from './measure/measureController'
import { createTransitLayer, renderTransitPlan } from './layers/transit'
import type { TransitPlanResult } from '@/common/types/transit'

import type VectorLayer from 'ol/layer/Vector'
import type VectorSource from 'ol/source/Vector'
import type TileLayer from 'ol/layer/Tile'
import type TileWMS from 'ol/source/TileWMS'

interface RouteMarker {
  overlay: Overlay
  el: HTMLDivElement
}

export class Map2DEngine extends TypedEmitter<MapEngineEvents> implements MapEngine {
  readonly mode: MapMode = '2d'

  private map: Map | null = null
  private basemap: LayerGroup | null = null
  private roads: VectorLayer<VectorSource> | null = null
  private stations: VectorLayer<VectorSource> | null = null
  private stationLabels: VectorLayer<VectorSource> | null = null
  /** 公交 WMS 图层（GeoServer） */
  private busRoutes: TileLayer<TileWMS> | null = null
  private busStops: TileLayer<TileWMS> | null = null
  private busStopNames: TileLayer<TileWMS> | null = null
  /** 选中公交线路的矢量叠加层（三图层独立显隐） */
  private selectedBusRouteLayer: VectorLayer<VectorSource> | null = null
  private selectedBusStopLayer: VectorLayer<VectorSource> | null = null
  private selectedBusNameLayer: VectorLayer<VectorSource> | null = null
  private selectedBusRouteSource: VectorSource | null = null
  private selectedBusStopSource: VectorSource | null = null
  private selectedBusNameSource: VectorSource | null = null
  /** 选中公交线路的站点/名称显隐状态（由 store 同步过来） */
  private busRouteStopsVisible = true
  private busRouteNamesVisible = true
  /** 当前交通网络 */
  private networkMode: NetworkMode = 'metro'
  /** 图层开关的期望状态（最终可见性还需与网络模式求交） */
  private visibility: Record<LayerId, boolean> = { ...DEFAULT_LAYER_VISIBILITY }
  /** 覆盖分析图层（逐站缓冲区 + 并集轮廓） */
  private coverageLayer: VectorLayer<VectorSource> | null = null
  private coverageSource: VectorSource | null = null
  /** 附近站点分析图层 */
  private nearbyLayer: VectorLayer<VectorSource> | null = null
  private nearbySource: VectorSource | null = null
  /** 分析选点模式（附近站点查询） */
  private pickPointMode = false
  /** 路线规划选点模式 */
  private routePickMode = false
  /** 路线规划图层 */
  private transitLayer: VectorLayer<VectorSource> | null = null
  private transitSource: VectorSource | null = null
  /** 起终点选点标记（DOM Overlay：与点击坐标像素级对齐，不依赖矢量重绘） */
  private routeOriginMarker: RouteMarker | null = null
  private routeDestinationMarker: RouteMarker | null = null
  private measureSource: VectorSource | null = null
  private measure: MeasureController | null = null
  private eventKeys: EventsKey[] = []

  /* ---------------- 生命周期 ---------------- */

  async init(container: HTMLElement): Promise<void> {
    this.destroy()

    // 从后端加载成都地铁线路与站点（幂等缓存）
    await ensureMetroLoaded()
    useMapStore().refreshSceneStats()
    const routeCollection: GeoJSONFeatureCollection<MetroRouteProps> = allRouteFeatures()
    const stopCollection: GeoJSONFeatureCollection<MetroStopProps> = allStopFeatures()

    const basemap = createBaseMapGroup(DEFAULT_BASEMAP_ID)
    this.basemap = basemap
    const coverage = createCoverageLayer()
    const nearby = createNearbyLayer()
    const measure = createMeasureLayer()
    const transit = createTransitLayer()
    this.roads = createRoadLayer(routeCollection)
    this.stations = createStationLayer(stopCollection)
    this.stationLabels = createStationLabelLayer(stopCollection)
    this.busRoutes = createBusRouteLayer()
    this.busStops = createBusStopLayer()
    this.busStopNames = createBusStopNameLayer()

    // 选中公交线路的矢量叠加层（独立三个 source + layer，最上层 zIndex）
    this.selectedBusRouteSource = createSelectedRouteSource()
    this.selectedBusStopSource = createSelectedRouteStopSource()
    this.selectedBusNameSource = createSelectedRouteNameSource()
    this.selectedBusRouteLayer = createSelectedRouteLayer(this.selectedBusRouteSource)
    this.selectedBusStopLayer = createSelectedRouteStopLayer(this.selectedBusStopSource)
    this.selectedBusNameLayer = createSelectedRouteNameLayer(this.selectedBusNameSource)
    this.coverageLayer = coverage.layer
    this.coverageSource = coverage.source
    this.nearbyLayer = nearby.layer
    this.nearbySource = nearby.source
    this.measureSource = measure.source
    this.transitLayer = transit.layer
    this.transitSource = transit.source

    const map = new Map({
      target: container,
      view: new View({
        projection: MAP2D_VIEW.projection,
        center: [...MAP2D_VIEW.center],
        zoom: MAP2D_VIEW.zoom,
        minZoom: MAP2D_VIEW.minZoom,
        maxZoom: MAP2D_VIEW.maxZoom,
        extent: [...MAP2D_VIEW.extent],
      }),
      // 隐藏默认缩放按钮 / 版权球：工具条与状态栏由上层 UI 提供
      controls: [new ScaleLine({ units: 'metric', minWidth: 120 })],
      layers: [
        basemap,
        this.busRoutes,
        this.busStops,
        this.busStopNames,
        this.roads,
        this.stations,
        this.stationLabels,
        coverage.layer,
        nearby.layer,
        stationBufferLayer,
        measure.layer,
        transit.layer,
        // 选中公交线路叠加层（必须最上层）
        this.selectedBusRouteLayer,
        this.selectedBusStopLayer,
        this.selectedBusNameLayer,
      ],
    })

    this.map = map
    this.routeOriginMarker = this.createRouteMarker(map, '起', '#E5484D')
    this.routeDestinationMarker = this.createRouteMarker(map, '终', '#D32F2F')
    // 初始按「地铁」网络装配可见性，避免公交 WMS 与地铁图层同时出现
    this.applyVisibility()

    this.measure = new MeasureController({
      map,
      source: measure.source,
      onResult: (result) => this.emit('measure', result),
    })

    this.bindInteractions(map)

    map.once('rendercomplete', () => this.emit('ready'))
  }

  /** 点选拾取与指针坐标上报 */
  private bindInteractions(map: Map): void {
    const PICKABLE = [
      'roads',
      'stations',
      // 选中公交线路叠加层：线路本体与站点均可点选（属性面板统一展示）
      'selectedBusRoute',
      'selectedBusStops',
    ]

    this.eventKeys.push(
      map.on('click', (evt) => {
        // 路线规划选点模式：点击位置作为起点 / 终点
        if (this.routePickMode) {
          this.emit('routePickPoint', evt.coordinate as LngLat)
          return
        }
        // 分析选点模式：点击位置作为附近站点查询中心
        if (this.pickPointMode) {
          this.emit('pickPoint', evt.coordinate as LngLat)
          return
        }
        // 测量取点期间不触发对象点选
        if (this.measure?.active) return
        const hit = map.forEachFeatureAtPixel(
          evt.pixel,
          (feature, layer) => {
            const layerId = layer?.get('layerId') as string | undefined
            if (!layerId || !PICKABLE.includes(layerId)) return undefined
            return {
              layerId,
              id: String(feature.getId() ?? ''),
              props: feature.getProperties() as Record<string, unknown>,
            }
          },
          { hitTolerance: 4 },
        )
        this.emit(
          'select',
          hit ? this.toObject(hit.layerId, hit.id, hit.props) : null,
        )
        // 未命中矢量要素时，公交模式下再向后端反查最近的公交线路
        // （公交线路是 GeoServer WMS 瓦片，前端无法直接命中要素）
        if (!hit && this.networkMode === 'bus' && this.busRoutes?.getVisible()) {
          const view = map.getView()
          const resolution = view.getResolution() ?? 0
          // 按当前分辨率换算约 6px 的容差（视图为 EPSG:4326，1° ≈ 111km）
          const tolerance = Math.round(Math.min(300, Math.max(20, resolution * 111000 * 6)))
          void this.pickBusRouteAt(evt.coordinate as [number, number], tolerance)
        }
      }),
    )

    this.eventKeys.push(
      map.on('pointermove', (evt) => {
        const lon = evt.coordinate[0]
        const lat = evt.coordinate[1]
        this.emit('pointer', [lon, lat] as [number, number])
        const el = map.getTargetElement()
        if (!el) return
        // 测量 / 分析选点状态统一使用十字光标
        if (this.measure?.active || this.pickPointMode || this.routePickMode) {
          el.style.cursor = 'crosshair'
          return
        }
        const hover = map.hasFeatureAtPixel(evt.pixel, {
          layerFilter: (l) => PICKABLE.includes(l.get('layerId') as string),
        })
        el.style.cursor = hover ? 'pointer' : ''
      }),
    )
  }

  /**
   * 公交模式下点空白处：由后端 PostGIS 按容差反查最近的公交线路
   *
   * 命中后发 select 事件，store 会同步 selectedBusRoute，
   * 进而驱动叠加层加载与右侧属性面板展示线路详情。
   */
  private async pickBusRouteAt(
    coordinate: [number, number],
    tolerance: number,
  ): Promise<void> {
    try {
      const { busApi } = await import('@/common/services/bus')
      const picked = await busApi.pickRoute(coordinate[0], coordinate[1], tolerance)
      if (!picked) return
      this.emit('select', {
        kind: 'busRoute',
        id: String(picked.id),
        name: picked.route_cn,
      })
    } catch {
      // 后端不可用时静默失败，不影响地图其余交互
    }
  }

  private toObject(
    layerId: string,
    id: string,
    props: Record<string, unknown> = {},
  ): SelectedObject | null {
    if (layerId === 'roads') {
      const route = getRoute(id)
      return route ? { kind: 'road', id, name: route.name } : null
    }
    if (layerId === 'stations') {
      const stop = getStop(id)
      return stop ? { kind: 'station', id, name: stop.name } : null
    }
    // 选中公交线路的站点（GeoJSON 无 feature id，用 stop_id）
    if (layerId === 'selectedBusStops') {
      const stopId = String(props.stop_id ?? '')
      if (!stopId) return null
      return { kind: 'busStop', id: stopId, name: String(props.stop_cn ?? '公交站') }
    }
    // 选中公交线路本体
    if (layerId === 'selectedBusRoute') {
      const routeId = String(props.id ?? '')
      if (!routeId) return null
      return { kind: 'busRoute', id: routeId, name: String(props.route_cn ?? '公交线路') }
    }
    return null
  }

  /* ---------------- 契约方法 ---------------- */

  setLayerVisible(id: LayerId, visible: boolean): void {
    this.visibility[id] = visible
    this.applyVisibility()
  }

  setNetworkMode(mode: NetworkMode): void {
    if (this.networkMode === mode) return
    this.networkMode = mode
    this.applyVisibility()
  }

  /** 图层最终可见性 = 所属网络是否激活 && 图层开关状态 */
  private applyVisibility(): void {
    const metro = this.networkMode === 'metro'
    this.roads?.setVisible(metro && this.visibility.roads)
    this.stations?.setVisible(metro && this.visibility.stations)
    this.stationLabels?.setVisible(metro && this.visibility.stationLabels)
    this.busRoutes?.setVisible(!metro && this.visibility.busRoutes)
    this.busStops?.setVisible(!metro && this.visibility.busStops)
    this.busStopNames?.setVisible(!metro && this.visibility.busStopNames)

    // 选中公交线路叠加层：仅公交网络下、有选中线路时显示，三图层独立显隐
    const hasSelection = (this.selectedBusRouteSource?.getFeatures().length ?? 0)
    const showOverlay = !metro && hasSelection > 0
    this.selectedBusRouteLayer?.setVisible(showOverlay)
    this.selectedBusStopLayer?.setVisible(showOverlay && this.busRouteStopsVisible)
    this.selectedBusNameLayer?.setVisible(showOverlay && this.busRouteNamesVisible)
  }

  setSelected(target: SelectedObject | null): void {
    styleState.selectedId = target?.id ?? null
    const kind = target?.kind === 'station' ? 'metro'
      : target?.kind === 'busStop' ? 'bus'
        : target?.kind === 'road' ? 'metro'
          : target?.kind === 'busRoute' ? 'bus' : null
    setStationBufferSelection(target && kind ? { kind, id: target.id } : null)
    this.roads?.changed()
    this.stations?.changed()
    this.stationLabels?.changed()
  }

  /* ---------------- 选中公交线路叠加层 ---------------- */

  /** 选中/取消选中公交线路：拉后端详情 → 加载矢量叠加层 → flyTo */
  async selectBusRoute(id: number | null): Promise<void> {
    // 清空
    loadRouteFeature(this.selectedBusRouteSource!, null)
    loadStopFeatures(this.selectedBusStopSource!, null)
    loadStopFeatures(this.selectedBusNameSource!, null)
    if (!id) {
      this.applyVisibility()
      return
    }
    try {
      const { getRouteDetail } = await import('@/common/data/busRepository')
      const detail = await getRouteDetail(id)
      loadRouteFeature(this.selectedBusRouteSource!, detail.route)
      loadStopFeatures(this.selectedBusStopSource!, detail.stops)
      // 注记 layer 也用 stops 数据（样式里读 stop_cn）
      loadStopFeatures(this.selectedBusNameSource!, detail.stops)

      // flyTo：线路几何 bbox
      const view = this.map?.getView()
      const fc = detail.route.geometry
      if (view && fc) {
        // GeoJSON 坐标是 [lon, lat]（EPSG:4326），OpenLayers View 也是 EPSG:4326
        let bbox: [number, number, number, number] | null = null
        const flatten = (coords: unknown[]): void => {
          for (const c of coords) {
            if (Array.isArray(c) && typeof c[0] === 'number') {
              const [lon, lat] = c as [number, number]
              bbox ??= [lon, lat, lon, lat]
              bbox[0] = Math.min(bbox[0], lon)
              bbox[1] = Math.min(bbox[1], lat)
              bbox[2] = Math.max(bbox[2], lon)
              bbox[3] = Math.max(bbox[3], lat)
            } else if (Array.isArray(c)) {
              flatten(c)
            }
          }
        }
        if (fc.type === 'LineString') flatten(fc.coordinates as unknown[])
        else if (fc.type === 'MultiLineString') flatten((fc.coordinates as unknown[]).flat())
        if (bbox) {
          view.fit(bbox, { padding: [60, 60, 60, 60], maxZoom: 15, duration: 500 })
        }
      }
    } catch (err) {
      console.warn('[Map2DEngine] selectBusRoute failed:', err)
    } finally {
      this.applyVisibility()
    }
  }

  setBusRouteStopsVisible(v: boolean): void {
    this.busRouteStopsVisible = v
    this.applyVisibility()
  }

  setBusRouteNamesVisible(v: boolean): void {
    this.busRouteNamesVisible = v
    this.applyVisibility()
  }

  /* ---------------- 空间分析 ---------------- */

  setPickPointMode(active: boolean): void {
    this.pickPointMode = active
    if (active) this.routePickMode = false
    const el = this.map?.getTargetElement()
    if (el && !this.measure?.active) el.style.cursor = active ? 'crosshair' : ''
  }

  setRoutePickMode(active: boolean): void {
    this.routePickMode = active
    if (active) this.pickPointMode = false
    const el = this.map?.getTargetElement()
    if (el && !this.measure?.active) el.style.cursor = active ? 'crosshair' : ''
  }

  /** 渲染路线规划结果与起终点标记；有结果时自动缩放到路线范围 */
  renderRoutePlan(
    result: TransitPlanResult | null,
    selectedId: string | null,
    origin: LngLat | null = null,
    destination: LngLat | null = null,
  ): void {
    const start = origin ?? result?.origin ?? null
    const end = destination ?? result?.destination ?? null
    // 尚未出规划结果时起点用红色选点标记，出结果后转为绿色起点
    const picking = !result || !result.alternatives.length
    this.setRouteMarker(this.routeOriginMarker, start, '起', picking ? '#E5484D' : '#2E7D32')
    this.setRouteMarker(this.routeDestinationMarker, end, '终', '#D32F2F')

    if (!this.transitSource) return
    renderTransitPlan(this.transitSource, result, selectedId)
    if (!result) return
    const extent = this.transitSource.getExtent()
    if (extent && extent.every((n) => Number.isFinite(n))) {
      this.map?.getView().fit(extent, { padding: [90, 90, 90, 90], maxZoom: 16, duration: 600 })
    }
  }

  /** 创建起终点 DOM 标记：锚定地图坐标，点击后无需等待矢量图层重绘 */
  private createRouteMarker(map: Map, label: string, color: string): RouteMarker {
    const el = document.createElement('div')
    el.textContent = label
    el.style.cssText = [
      'width:18px;height:18px;border-radius:50%',
      'display:flex;align-items:center;justify-content:center',
      `background:${color};border:2px solid #fff;color:#fff`,
      'font:600 11px/1 "PingFang SC","Microsoft YaHei",sans-serif',
      'box-shadow:0 1px 6px rgba(10,16,28,.55);pointer-events:none',
    ].join(';')
    const overlay = new Overlay({
      element: el,
      positioning: 'center-center',
      stopEvent: false,
    })
    map.addOverlay(overlay)
    return { overlay, el }
  }

  private setRouteMarker(
    marker: RouteMarker | null,
    point: LngLat | null,
    label: string,
    color: string,
  ): void {
    if (!marker) return
    marker.el.textContent = label
    marker.el.style.background = color
    marker.overlay.setPosition(point ? [point[0], point[1]] : undefined)
  }

  renderNearbyStops(result: NearbyStopsResult | null): void {
    if (this.nearbySource) renderNearbyOverlay(this.nearbySource, result)
  }

  renderStationBuffer(result: import('@/common/types/analysis').StationBufferResult | null): void {
    renderStationBufferOverlay(result)
  }

  renderCoverage(result: CoverageResult | null, opacity: number): void {
    if (!this.coverageSource) return
    renderCoverageOverlay(this.coverageSource, result)
    this.coverageLayer?.setOpacity(result ? opacity : 1)
  }

  setCoverageOpacity(opacity: number): void {
    this.coverageLayer?.setOpacity(opacity)
  }

  flyToPoint(point: LngLat, zoom = 16): void {
    this.map?.getView().animate({ center: point, zoom, duration: 500 })
  }

  setMeasureMode(mode: MeasureMode | null): void {
    this.measure?.setMode(mode)
  }

  clearMeasure(): void {
    this.measure?.clear()
  }

  /* ---------------- 底图 ---------------- */

  setBaseMap(id: string): void {
    if (this.basemap) setBaseMap(this.basemap, id as BasemapId)
  }

  getCameraState(): CameraState {
    const view = this.map?.getView()
    const center = view?.getCenter() ?? [...MAP2D_VIEW.center]
    return {
      lon: center[0] ?? MAP2D_VIEW.center[0],
      lat: center[1] ?? MAP2D_VIEW.center[1],
      scale: view?.getZoom() ?? MAP2D_VIEW.zoom,
    }
  }

  applyCameraState(state: CameraState): void {
    this.map?.getView().animate({ center: [state.lon, state.lat] as [number, number], zoom: state.scale, duration: 500 })
  }

  resetView(): void {
    this.map?.getView().animate({
      center: [...MAP2D_VIEW.center],
      zoom: MAP2D_VIEW.zoom,
      duration: 600,
    })
  }

  /** 地图内定位到指定对象（属性面板「定位」按钮） */
  flyToObject(target: SelectedObject): void {
    const view = this.map?.getView()
    if (!view) return
    if (target.kind === 'road') {
      const center = getRouteMidpoint(target.id)
      if (center) view.animate({ center, zoom: 13.2, duration: 600 })
    } else if (target.kind === 'station') {
      const center = getStopPoint(target.id)
      if (center) view.animate({ center, zoom: 16, duration: 600 })
    } else if (target.kind === 'busRoute') {
      // 选中公交线路：按叠加层几何范围适配
      const extent = this.selectedBusRouteSource?.getExtent()
      if (extent && extent.every((n) => Number.isFinite(n))) {
        view.fit(extent, { padding: [80, 80, 80, 80], maxZoom: 15, duration: 600 })
      }
    } else if (target.kind === 'busStop') {
      // 选中公交站点：居中放大到该站
      const feature = this.selectedBusStopSource
        ?.getFeatures()
        .find((f) => String(f.get('stop_id')) === target.id)
      const geom = feature?.getGeometry()
      if (!geom) return
      const [minX = 0, minY = 0, maxX = 0, maxY = 0] = geom.getExtent()
      view.animate({
        center: [(minX + maxX) / 2, (minY + maxY) / 2],
        zoom: 16,
        duration: 500,
      })
    }
  }

  destroy(): void {
    this.eventKeys.forEach((k) => unByKey(k))
    this.eventKeys = []
    this.measure?.destroy()
    this.measure = null
    this.map?.setTarget(undefined)
    this.map = null
    this.basemap = null
    this.roads = this.stations = this.stationLabels = null
    this.busRoutes = null
    this.busStops = null
    this.busStopNames = null
    this.selectedBusRouteLayer = null
    this.selectedBusStopLayer = null
    this.selectedBusNameLayer = null
    this.selectedBusRouteSource = null
    this.selectedBusStopSource = null
    this.selectedBusNameSource = null
    this.coverageLayer = null
    this.coverageSource = null
    this.nearbyLayer = null
    this.nearbySource = null
    this.pickPointMode = false
    this.routePickMode = false
    this.routeOriginMarker = null
    this.routeDestinationMarker = null
    this.transitLayer = null
    this.transitSource = null
    this.measureSource = null
    this.clear()
  }
}
