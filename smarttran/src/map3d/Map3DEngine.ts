/**
 * 三维地图引擎（Cesium 实现）
 *
 * 实现 common/types/engine 的 MapEngine 契约，与 Map2DEngine 可互换：
 * - 底面：GridImageryProvider 程序化网格（非静态贴图、无需在线影像）
 * - 业务对象：roads / stations / analysis 三组实体，职责与 2D 图层一一对应
 * - 选中高亮：独立覆盖实体（选中青色发光线 / 光圈），不重建业务实体
 */

import * as Cesium from 'cesium'

import {
  allRouteFeatures,
  allStopFeatures,
  ensureMetroLoaded,
  getRoute,
  getRoutePath,
  getStop,
  getStopPoint,
} from '@/common/data/metroRepository'
import type { CameraState } from '@/common/types/geo'
import type {
  BufferOverlay,
  MapEngine,
  MapEngineEvents,
  MapMode,
  SelectedObject,
} from '@/common/types/engine'
import type { LayerId } from '@/common/constants/layers'
import { PALETTE } from '@/common/constants/colors'
import { TypedEmitter } from '@/common/utils/emitter'
import { toRad } from '@/tools'

import { GRID_STYLE, MAP3D_CAMERA, zoomToHeight } from './config/viewer'
import { createRoadEntities, positionsFromPath } from './entities/roads'
import { createAllStations } from './entities/stations'
import { renderBufferEntity } from './entities/analysis'

const ACCENT = Cesium.Color.fromCssColorString(PALETTE.accent)
const ACCENT_LIGHT = Cesium.Color.fromCssColorString(PALETTE.accentLight)

/** 实体 id → 业务键（剥离 `:casing` / `:label` 等部件后缀） */
function bizKeyOf(entityId: string | number): string | null {
  const s = String(entityId)
  const parts = s.split(':')
  if (parts.length < 2) return null
  const key = `${parts[0]}:${parts[1]}`
  return /^(road|station):/.test(key) ? key : null
}

export class Map3DEngine extends TypedEmitter<MapEngineEvents> implements MapEngine {
  readonly mode: MapMode = '3d'

  private viewer: Cesium.Viewer | null = null
  private handler: Cesium.ScreenSpaceEventHandler | null = null
  /** 业务实体索引：`<kind>:<id>` → 主实体（flyTo 用） */
  private entityIndex = new Map<string, Cesium.Entity>()
  private highlightEntity: Cesium.Entity | null = null

  /* ---------------- 生命周期 ---------------- */

  async init(container: HTMLElement): Promise<void> {
    this.destroy()

    // 从后端加载成都地铁数据（幂等缓存）
    await ensureMetroLoaded()

    // 版权球挂到离屏节点：由平台界面统一承担信息展示
    const creditContainer = document.createElement('div')
    const viewer = new Cesium.Viewer(container, {
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.GridImageryProvider({
          cells: GRID_STYLE.cells,
          color: GRID_STYLE.color,
          glowColor: GRID_STYLE.glowColor,
          glowWidth: GRID_STYLE.glowWidth,
          backgroundColor: GRID_STYLE.backgroundColor,
        }),
      ),
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
    this.viewer = viewer

    // ---- 业务实体装配（与 2D 图层一一对应） ----
    for (const feature of allRouteFeatures().features) {
      const [casing, main] = createRoadEntities(viewer.entities, feature)
      if (main) this.entityIndex.set(`road:${feature.properties.id}`, main)
      if (casing) this.entityIndex.set(`road:${feature.properties.id}:casing`, casing)
    }
    createAllStations(viewer.entities, allStopFeatures())
    for (const feature of allStopFeatures().features) {
      const stopId = feature.properties.stop_id
      const entity = viewer.entities.values.find((e) => e.id === `station:${stopId}`)
      if (entity) this.entityIndex.set(`station:${stopId}`, entity)
    }

    this.bindPicking(viewer)
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

  /** 拾取：单击选择业务对象，移动上报经纬度 */
  private bindPicking(viewer: Cesium.Viewer): void {
    // 关闭默认双击跟踪实体行为
    viewer.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    )

    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    this.handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position)
      const bizKey = bizKeyOf((picked as { id?: unknown } | undefined)?.id as string | number)
      this.emit('select', bizKey ? this.toObject(bizKey) : null)
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
    return null
  }

  /* ---------------- 契约方法 ---------------- */

  setLayerVisible(id: LayerId, visible: boolean): void {
    const prefixByLayer: Partial<Record<LayerId, string>> = {
      roads: 'road:',
      stations: 'station:',
      stationLabels: 'station:',
      models3d: 'station:',
    }
    const prefix = prefixByLayer[id]
    if (!prefix || !this.viewer) return
    // 说明：models3d 与 stations 同属车站实体组，3D 下统一由
    // 「三维车站模型」开关控制盒体可见性，符号与注记跟随「站点符号」开关。
    const controlModels = id === 'models3d'
    const controlLabels = id === 'stationLabels'
    this.viewer.entities.values
      .filter((e) => typeof e.id === 'string' && e.id.startsWith(prefix))
      .forEach((entity) => {
        // 盒体（box 图形）属于三维模型，标签属于注记，其余为点符号
        const isModelPart = entity.box !== undefined
        const isLabelPart = entity.label !== undefined
        if (controlModels !== isModelPart) return
        if (controlLabels !== isLabelPart) return
        entity.show = visible
      })
  }

  setSelected(target: SelectedObject | null): void {
    this.refreshHighlight(target)
  }

  /** 3D 场景暂未接入公交 WMS，切换网络时保持既有地铁实体（后续接入 Cesium 瓦片图层） */
  setNetworkMode(): void { }

  /** 选中公交线路叠加层仅 2D 实现；3D 侧空实现 */
  selectBusRoute(): void { }
  setBusRouteStopsVisible(): void { }
  setBusRouteNamesVisible(): void { }

  /** 选中高亮：叠加发光折线（线路）或光圈（站点），不改动业务实体 */
  private refreshHighlight(target: SelectedObject | null): void {
    if (!this.viewer) return
    if (this.highlightEntity) {
      this.viewer.entities.remove(this.highlightEntity)
      this.highlightEntity = null
    }
    if (!target) return

    if (target.kind === 'road') {
      const path = getRoutePath(target.id)
      if (!path) return
      this.highlightEntity = this.viewer.entities.add({
        id: 'highlight:road',
        polyline: {
          positions: positionsFromPath(path, 4),
          width: 13,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.28,
            color: ACCENT_LIGHT,
          }),
          clampToGround: true,
        },
      })
      return
    }

    const point = getStopPoint(target.id)
    if (!point) return
    this.highlightEntity = this.viewer.entities.add({
      id: 'highlight:station',
      position: Cesium.Cartesian3.fromDegrees(point[0], point[1], 1),
      ellipse: {
        semiMajorAxis: 42,
        semiMinorAxis: 42,
        material: new Cesium.ColorMaterialProperty(ACCENT.withAlpha(0.14)),
        outline: true,
        outlineColor: ACCENT.withAlpha(0.8),
        height: 1,
      },
    })
  }

  renderBuffer(overlay: BufferOverlay | null): void {
    if (this.viewer) renderBufferEntity(this.viewer.entities, overlay)
  }

  /** 3D 在线底图切换：后续接入（当前为程序化网格底面） */
  setBaseMap(): void { }

  /** 3D 场景暂不支持测量，测量交互由 2D 引擎（OpenLayers Draw）实现 */
  setMeasureMode(): void { }

  clearMeasure(): void { }

  getCameraState(): CameraState {
    const camera = this.viewer?.camera
    if (!camera) return { lon: MAP3D_CAMERA.lon, lat: MAP3D_CAMERA.lat, scale: MAP3D_CAMERA.height }
    const carto = camera.positionCartographic
    return {
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      scale: carto.height,
    }
  }

  applyCameraState(state: CameraState): void {
    // 由 2D 进入：zoom → 相机高度经验换算，保持视角尺度
    this.viewer?.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, zoomToHeight(state.scale)),
      orientation: { heading: 0, pitch: toRad(MAP3D_CAMERA.pitchDeg), roll: 0 },
      duration: 0.8,
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

  /** 定位到业务对象（线路 → 沿线视角；站点 → 环绕俯视） */
  flyToObject(target: SelectedObject): void {
    if (!this.viewer) return
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
          destination: Cesium.Cartesian3.fromDegrees(point[0], point[1] - 0.0022, 900),
          orientation: { heading: 0, pitch: toRad(-35), roll: 0 },
          duration: 0.9,
        })
      }
    }
  }

  destroy(): void {
    this.handler?.destroy()
    this.handler = null
    this.entityIndex.clear()
    this.highlightEntity = null
    if (this.viewer) {
      this.viewer.destroy()
      this.viewer = null
    }
    this.clear()
  }
}
