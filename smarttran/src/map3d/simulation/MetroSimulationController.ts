import * as Cesium from 'cesium'

import type { LngLat } from '@/common/types/geo'
import { MAP3D_CAMERA } from '@/map3d/config/viewer'
import type { MetroSimulationPhase, MetroSimulationState } from '@/common/types/simulation'
import { RouteTrack } from './RouteTrack'
import { destroySimulationModel, loadSimulationModel, type SimulationModelLoadResult } from './SimulationModelLoader'

export interface MetroSimulationControllerCallbacks {
  onStateChange?: (state: MetroSimulationState) => void
  onError?: (error: Error) => void
}

export interface MetroSimulationControllerOptions extends MetroSimulationControllerCallbacks {
  viewer: Cesium.Viewer
  entities?: Cesium.EntityCollection
  routePath?: LngLat[]
  routeId?: string
  routeName?: string
  tilesUrl?: string
  speedMps?: number
}

type CameraInputKey = 'enableTranslate' | 'enableRotate' | 'enableZoom' | 'enableTilt' | 'enableLook'
type CameraInputState = Record<CameraInputKey, boolean>

const SIMULATION_MODEL_SCALE = 5

export class MetroSimulationController {
  private readonly viewer: Cesium.Viewer
  private readonly tilesUrl: string
  private readonly speedMps: number
  private speedMultiplier = 1
  private readonly onStateChange?: (state: MetroSimulationState) => void
  private readonly onError?: (error: Error) => void
  private readonly cameraController: Cesium.ScreenSpaceCameraController
  private cameraInputBeforeLock: CameraInputState | null = null
  private readonly preUpdate: Cesium.Event.RemoveCallback
  private session = 0
  private tileRequest = 0
  private routeTrack: RouteTrack | null = null
  private routeId: string | null = null
  private routeName: string | null = null
  private routePath: LngLat[] = []
  private modelResult: SimulationModelLoadResult | null = null
  private tileset: Cesium.Cesium3DTileset | null = null
  private abortController: AbortController | null = null
  private elapsedSec = 0
  private distanceM = 0
  private lastTime: Cesium.JulianDate | null = null
  private phase: MetroSimulationPhase = 'idle'
  private tilesEnabled = true
  private otherRoutesVisible = true
  private locked = false
  private destroyed = false
  private state: MetroSimulationState

  constructor(options: MetroSimulationControllerOptions)
  constructor(
    viewer: Cesium.Viewer,
    routePath: LngLat[],
    routeId: string,
    routeName: string,
    callbacks?: MetroSimulationControllerCallbacks,
  )
  constructor(
    optionsOrViewer: MetroSimulationControllerOptions | Cesium.Viewer,
    routePath: LngLat[] = [],
    routeId = '',
    routeName = '',
    callbacks: MetroSimulationControllerCallbacks = {},
  ) {
    const options = optionsOrViewer instanceof Cesium.Viewer
      ? { viewer: optionsOrViewer, routePath, routeId, routeName, ...callbacks }
      : optionsOrViewer
    this.viewer = options.viewer
    this.tilesUrl = options.tilesUrl ?? '/3dtiles/tileset.json'
    this.speedMps = Math.max(0, options.speedMps ?? 18)
    this.onStateChange = options.onStateChange
    this.onError = options.onError
    this.cameraController = this.viewer.scene.screenSpaceCameraController
    this.routePath = options.routePath ?? []
    this.routeId = options.routeId ?? null
    this.routeName = options.routeName ?? null
    this.state = this.createState()
    this.preUpdate = this.viewer.scene.preUpdate.addEventListener((_scene, time) => this.update(time))
  }

  async start(routeId = this.routeId ?? '', routeName = this.routeName ?? '', path = this.routePath): Promise<void> {
    const session = ++this.session
    this.cleanupSession()
    this.routeId = routeId
    this.routeName = routeName
    this.routePath = path
    this.routeTrack = new RouteTrack(path)
    this.elapsedSec = 0
    this.distanceM = 0
    this.lastTime = null
    this.setPhase('preparing')
    this.lockCameraInput()

    const start = this.routeTrack.start
    if (!start) {
      this.fail(session, new Error('线路没有有效轨迹'))
      return
    }
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(start[0], start[1], 700),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
      duration: 0.8,
    })

    const abortController = new AbortController()
    this.abortController = abortController
    try {
      const result = await loadSimulationModel({
        signal: abortController.signal,
        onProgress: (progress) => {
          if (session !== this.session || this.destroyed) return
          this.state = { ...this.state, model: { phase: progress >= 1 ? 'ready' : 'loading', progress, error: null } }
          this.onStateChange?.(this.state)
        },
      })
      if (session !== this.session || this.destroyed || abortController.signal.aborted) {
        destroySimulationModel(result)
        return
      }
      this.modelResult = result
      this.viewer.scene.primitives.add(result.model)
      this.updateModel()
      if (this.tilesEnabled) void this.loadTiles(session)
      if (this.routeTrack.totalDistanceM === 0) this.setPhase('completed')
      else this.setPhase('running')
    } catch (error) {
      if (session !== this.session || this.destroyed || abortController.signal.aborted) return
      this.fail(session, error instanceof Error ? error : new Error('模拟初始化失败'))
    }
  }

  pause(): void {
    if (this.phase === 'running') {
      this.lastTime = null
      this.setPhase('paused')
    }
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.lastTime = null
      this.setPhase('running')
    }
  }

  stop(): void {
    ++this.session
    this.cleanupSession()
    this.routeId = null
    this.routeName = null
    this.routeTrack = null
    this.setPhase('idle')
    this.restoreCameraInput()
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(MAP3D_CAMERA.lon, MAP3D_CAMERA.lat, MAP3D_CAMERA.height),
      orientation: {
        heading: Cesium.Math.toRadians(MAP3D_CAMERA.headingDeg),
        pitch: Cesium.Math.toRadians(MAP3D_CAMERA.pitchDeg),
        roll: 0,
      },
      duration: 0.6,
    })
  }

  setTilesVisible(visible: boolean): void {
    this.tilesEnabled = visible
    if (this.tileset) this.tileset.show = visible
    if (!visible) {
      ++this.tileRequest
      this.removeTileset()
    } else if (!this.tileset && this.phase !== 'idle') {
      void this.loadTiles(this.session)
    }
    this.state = { ...this.state, tilesEnabled: visible }
    this.onStateChange?.(this.state)
  }

  setTilesEnabled(enabled: boolean): void {
    this.setTilesVisible(enabled)
  }

  setOtherRoutesVisible(visible: boolean): void {
    this.otherRoutesVisible = visible
    this.state = { ...this.state, otherRoutesVisible: visible }
    this.onStateChange?.(this.state)
  }

  setSpeedMultiplier(speed: number): void {
    this.speedMultiplier = Math.min(4, Math.max(0.25, speed))
    this.state = { ...this.state, speedMultiplier: this.speedMultiplier }
    this.onStateChange?.(this.state)
  }

  isRunning(): boolean {
    return this.phase === 'running'
  }

  isLocked(): boolean {
    return this.locked
  }

  get active(): boolean {
    return this.phase !== 'idle'
  }

  get activeRouteId(): string | null {
    return this.routeId
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    ++this.session
    this.cleanupSession()
    this.routeTrack = null
    this.restoreCameraInput()
    this.preUpdate()
  }

  private async loadTiles(session: number): Promise<void> {
    const request = ++this.tileRequest
    this.state = { ...this.state, tilesStatus: 'loading' }
    this.onStateChange?.(this.state)
    try {
      const tileset = await Cesium.Cesium3DTileset.fromUrl('/3dtiles/tileset.json')
      if (session !== this.session || request !== this.tileRequest || this.destroyed || !this.tilesEnabled) {
        if (!tileset.isDestroyed()) tileset.destroy()
        return
      }
      this.tileset = tileset
      tileset.show = this.tilesEnabled
      this.viewer.scene.primitives.add(tileset)
      this.state = { ...this.state, tilesStatus: 'ready' }
      this.onStateChange?.(this.state)
    } catch (error) {
      if (session !== this.session || request !== this.tileRequest || this.destroyed) return
      const failure = error instanceof Error ? error : new Error('场景瓦片加载失败')
      this.state = { ...this.state, tilesStatus: 'error', error: failure.message }
      this.onStateChange?.(this.state)
      this.onError?.(failure)
    }
  }

  private update(time: Cesium.JulianDate): void {
    if (!this.routeTrack || !this.modelResult || (this.phase !== 'running' && this.phase !== 'completed')) return
    if (this.phase === 'running' && this.lastTime) {
      const deltaSec = Math.max(0, Math.min(0.2, Cesium.JulianDate.secondsDifference(time, this.lastTime)))
      this.elapsedSec += deltaSec
      this.distanceM = Math.min(this.routeTrack.totalDistanceM, this.distanceM + deltaSec * this.speedMps * this.speedMultiplier)
      if (this.distanceM >= this.routeTrack.totalDistanceM) this.setPhase('completed')
    }
    this.lastTime = Cesium.JulianDate.clone(time, this.lastTime ?? new Cesium.JulianDate())
    this.updateModel()
  }

  private updateModel(): void {
    const snapshot = this.routeTrack?.sample(this.distanceM)
    const model = this.modelResult?.model
    if (!snapshot || !model || model.isDestroyed()) return
    const position = Cesium.Cartesian3.fromDegrees(snapshot.position[0], snapshot.position[1], 10)
    const hpr = new Cesium.HeadingPitchRoll(snapshot.headingRad + Cesium.Math.toRadians(90), Cesium.Math.toRadians(0), Cesium.Math.toRadians(0))
    const modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr)
    const scaleMatrix = Cesium.Matrix4.fromUniformScale(SIMULATION_MODEL_SCALE)
    model.modelMatrix = Cesium.Matrix4.multiply(modelMatrix, scaleMatrix, new Cesium.Matrix4())
    this.viewer.camera.lookAt(position, new Cesium.HeadingPitchRange(snapshot.headingRad, Cesium.Math.toRadians(-25), 420))
  }

  private cleanupSession(): void {
    this.abortController?.abort()
    this.abortController = null
    ++this.tileRequest
    if (this.modelResult) {
      if (this.viewer.scene.primitives.contains(this.modelResult.model)) this.viewer.scene.primitives.remove(this.modelResult.model)
      destroySimulationModel(this.modelResult)
      this.modelResult = null
    }
    this.removeTileset()
    this.lastTime = null
  }

  private removeTileset(): void {
    if (!this.tileset) return
    if (this.viewer.scene.primitives.contains(this.tileset)) this.viewer.scene.primitives.remove(this.tileset)
    if (!this.tileset.isDestroyed()) this.tileset.destroy()
    this.tileset = null
  }

  private lockCameraInput(): void {
    if (!this.locked) {
      this.cameraInputBeforeLock = {
        enableTranslate: this.cameraController.enableTranslate,
        enableRotate: this.cameraController.enableRotate,
        enableZoom: this.cameraController.enableZoom,
        enableTilt: this.cameraController.enableTilt,
        enableLook: this.cameraController.enableLook,
      }
    }
    this.cameraController.enableTranslate = false
    this.cameraController.enableRotate = false
    this.cameraController.enableZoom = false
    this.cameraController.enableTilt = false
    this.cameraController.enableLook = false
    this.locked = true
  }

  private restoreCameraInput(): void {
    if (!this.cameraInputBeforeLock) return
    Object.assign(this.cameraController, this.cameraInputBeforeLock)
    this.cameraInputBeforeLock = null
    this.locked = false
  }

  private fail(session: number, error: Error): void {
    if (session !== this.session || this.destroyed) return
    this.setPhase('error', error.message)
    this.onError?.(error)
  }

  private setPhase(phase: MetroSimulationPhase, error: string | null = null): void {
    this.phase = phase
    this.state = { ...this.state, session: this.session, phase, routeId: this.routeId, routeName: this.routeName, error }
    this.onStateChange?.(this.state)
  }

  private createState(): MetroSimulationState {
    return {
      session: this.session,
      phase: 'idle',
      routeId: this.routeId,
      routeName: this.routeName,
      tilesEnabled: this.tilesEnabled,
      otherRoutesVisible: this.otherRoutesVisible,
      speedMultiplier: this.speedMultiplier,
      model: { phase: 'idle', progress: 0, error: null },
      tilesStatus: 'idle',
      error: null,
    }
  }
}
