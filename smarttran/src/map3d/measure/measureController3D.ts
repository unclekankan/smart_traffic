/**
 * 3D 测距 / 测面积控制器（Cesium 独立实现）
 *
 * 与 2D 的 `map2d/measure/MeasureController` 完全独立：
 * - 交互：独立的 ScreenSpaceEventHandler（单击取点、双击 / 右键结束、拖拽顶点编辑）
 * - 渲染：Cesium 实体（贴地折线 / 面、顶点符号、带背景的标注文本）
 * - 计算：Cesium.EllipsoidGeodesic + ENU 局部投影（见 measureMath）
 *
 * 绘制草稿采用 **单实体 + CallbackProperty(isConstant=false)** 模式：
 * setMode 时一次性创建，geometry / label / position 由回调闭包读取
 * this.points + this.cursorPoint，MOUSE_MOVE 只改变量，Cesium 每帧自动求值，
 * 彻底避免"每帧 removeDraftEntities + viewer.entities.add"导致的图元重建卡顿。
 *
 * 引擎销毁或模式切换时整体移除，不残留任何实体或输入监听。
 */

import * as Cesium from 'cesium'

import { PALETTE } from '@/common/constants/colors'
import type { LngLat } from '@/common/types/geo'
import type { MeasureAnnotation, MeasureMode, MeasureResult } from '@/common/types/measure'
import { formatArea, formatDistance } from '@/common/utils/measureFormat'
import { computeMeasure3D, geodesicDistance } from './measureMath'

const DRAFT_PREFIX = 'measure:draft:'
const ANNOTATION_PREFIX = 'measure:annotation:'
const VERTEX_PREFIX = 'measure:vertex:'

const ACCENT = Cesium.Color.fromCssColorString(PALETTE.accent)
const ACCENT_LIGHT = Cesium.Color.fromCssColorString(PALETTE.accentLight)
const TEXT_COLOR = Cesium.Color.fromCssColorString('#E8F1FB')
const TEXT_OUTLINE = Cesium.Color.fromCssColorString('#0A101C')
const LABEL_BG = Cesium.Color.fromCssColorString('#0A101C').withAlpha(0.86)
const FILL = ACCENT.withAlpha(0.14)
const FILL_SELECTED = ACCENT.withAlpha(0.24)

/** 可注入的输入处理器（生产环境用 Cesium，单测用轻量替身） */
export interface MeasurePointerEvent {
  position: Cesium.Cartesian2
  endPosition: Cesium.Cartesian2
}

export interface MeasureInputHandler {
  setInputAction(action: (movement: any) => void, type: number): void
  removeInputAction(type: number): void
  destroy(): void
}

export interface MeasureController3DOptions {
  viewer: Cesium.Viewer
  onDraft: (result: MeasureResult | null) => void
  onComplete: (annotation: MeasureAnnotation) => void
  onUpdate: (annotation: MeasureAnnotation) => void
  /** 单测注入；缺省使用 Cesium.ScreenSpaceEventHandler */
  handler?: MeasureInputHandler
}

interface DraftGroup {
  polygon?: Cesium.Entity
  outline?: Cesium.Entity
  line?: Cesium.Entity
  label?: Cesium.Entity
  /** 已确认顶点的 Point 实体（索引与 this.points 对齐） */
  vertices: Cesium.Entity[]
}

interface AnnotationGroup {
  polygon?: Cesium.Entity
  line?: Cesium.Entity
  outline?: Cesium.Entity
  label?: Cesium.Entity
  vertices: Cesium.Entity[]
}

function rawEntityId(picked: unknown): string | null {
  if (!picked || typeof picked !== 'object') return null
  const id = (picked as { id?: unknown }).id
  if (typeof id === 'string') return id
  if (id && typeof id === 'object' && 'id' in id) {
    const inner = (id as { id: unknown }).id
    return typeof inner === 'string' ? inner : null
  }
  return null
}

function labelText(annotation: Pick<MeasureAnnotation, 'label' | 'mode' | 'value'>): string {
  const value = annotation.mode === 'area'
    ? formatArea(annotation.value)
    : formatDistance(annotation.value)
  return annotation.label ? `${annotation.label}\n${value}` : value
}

/**
 * 把当前 points + cursorPoint 转成 Cesium.Cartesian3[]。
 * - cursorPoint 存在时：橡皮筋预览（包含鼠标当前位置）
 * - cursorPoint 为 null 时：仅已确认点（完成 / 取消后的稳定态）
 * 点数不足时返回 []，CallbackProperty 据此决定 show。
 */
function collectPositions(
  mode: MeasureMode,
  points: LngLat[],
  cursorPoint: LngLat | null,
  minForGeometry: number,
): Cesium.Cartesian3[] {
  const source: LngLat[] = cursorPoint ? [...points, cursorPoint] : points
  if (source.length < minForGeometry) return []
  return source.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
}

/** 面积模式下 polygon 需要闭合顶点序列（首尾相同） */
function closed(positions: Cesium.Cartesian3[]): Cesium.Cartesian3[] {
  if (positions.length < 2) return positions
  return [...positions, positions[0]!]
}

export class MeasureController3D {
  private readonly viewer: Cesium.Viewer
  private readonly onDraft: (result: MeasureResult | null) => void
  private readonly onComplete: (annotation: MeasureAnnotation) => void
  private readonly onUpdate: (annotation: MeasureAnnotation) => void
  private readonly handler: MeasureInputHandler
  private readonly container: HTMLElement | undefined

  private mode: MeasureMode | null = null
  /** 当前草稿的已确认取点（WGS84） */
  private points: LngLat[] = []
  /** 鼠标当前位置（橡皮筋预览） */
  private cursorPoint: LngLat | null = null
  /** 草稿实体组：setMode 创建、cancelDraft 销毁，内部属性全用 CallbackProperty 驱动 */
  private draftGroup: DraftGroup | null = null

  private annotations: MeasureAnnotation[] = []
  private groups = new Map<string, AnnotationGroup>()
  private selectedId: string | null = null
  private editingId: string | null = null
  /** 顶点拖拽状态 */
  private dragIndex: number | null = null
  private idSeq = 0

  constructor(options: MeasureController3DOptions) {
    this.viewer = options.viewer
    this.onDraft = options.onDraft
    this.onComplete = options.onComplete
    this.onUpdate = options.onUpdate
    this.container = this.viewer.container as HTMLElement | undefined
    this.handler = options.handler
      ?? (new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas) as unknown as MeasureInputHandler)

    this.handler.setInputAction((movement) => this.onLeftClick(movement.position), Cesium.ScreenSpaceEventType.LEFT_CLICK)
    this.handler.setInputAction((movement) => this.onLeftDown(movement.position), Cesium.ScreenSpaceEventType.LEFT_DOWN)
    this.handler.setInputAction(() => this.onLeftUp(), Cesium.ScreenSpaceEventType.LEFT_UP)
    this.handler.setInputAction((movement) => this.onMouseMove(movement.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    this.handler.setInputAction(() => this.finishDraft(), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    this.handler.setInputAction(() => this.finishDraft(), Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  /** 是否处于测量交互中（用于引擎屏蔽点选） */
  get active(): boolean {
    return this.mode !== null || this.editingId !== null
  }

  /** 启用 / 关闭测量（重复设置同一模式不重建实体） */
  setMode(mode: MeasureMode | null): void {
    if (mode === this.mode) return
    this.cancelDraft()
    this.mode = mode
    if (mode) this.createDraftEntities()
    this.setCursor(this.mode || this.editingId ? 'crosshair' : '')
  }

  /** 同步已完成标注（重建实体，选中态高亮，编辑态显示顶点手柄） */
  renderAnnotations(annotations: MeasureAnnotation[], selectedId: string | null): void {
    this.annotations = annotations.map((annotation) => ({ ...annotation }))
    this.selectedId = selectedId
    this.removeAnnotationEntities()
    for (const annotation of this.annotations) this.createAnnotationGroup(annotation)
  }

  /** 进入 / 退出顶点编辑（退出时结束拖拽并恢复相机操作） */
  setEditing(id: string | null): void {
    if (this.editingId === id) return
    this.editingId = id
    this.endDrag()
    this.removeAnnotationEntities()
    for (const annotation of this.annotations) this.createAnnotationGroup(annotation)
    this.setCursor(this.mode || id ? 'crosshair' : '')
  }

  /** 清除草稿与全部标注（保留当前工具） */
  clear(): void {
    this.cancelDraft()
    this.editingId = null
    this.selectedId = null
    this.annotations = []
    this.removeAnnotationEntities()
  }

  destroy(): void {
    this.cancelDraft()
    this.removeAnnotationEntities()
    this.endDrag()
    this.handler.destroy()
    this.setCursor('')
  }

  /* ---------------- 绘制交互 ---------------- */

  private onLeftClick(position: Cesium.Cartesian2): void {
    if (!this.mode || this.dragIndex !== null) return
    const point = this.pickLngLat(position)
    if (!point) return
    const last = this.points[this.points.length - 1]
    // 双击的第二下与上一点重合，忽略，避免重复顶点
    if (last && geodesicDistance(last, point) < 0.05) return
    this.points.push(point)
    this.cursorPoint = point // 橡皮筋吸附到刚落下的点，保证预览连续
    this.rebuildDraftVertices() // 已确认顶点数量变化，重建 Point 实体
    this.onDraft(this.currentDraftResult())
    this.requestRender()
  }

  private onMouseMove(position: Cesium.Cartesian2): void {
    if (this.dragIndex !== null && this.editingId) {
      const point = this.pickLngLat(position)
      if (!point) return
      this.moveVertex(this.editingId, this.dragIndex, point)
      return
    }
    if (!this.mode || this.points.length === 0) return
    const point = this.pickLngLat(position)
    if (!point) return
    this.cursorPoint = point
    this.requestRender()
  }

  private onLeftDown(position: Cesium.Cartesian2): void {
    if (!this.editingId) return
    const picked = this.viewer.scene.pick(position)
    const id = rawEntityId(picked)
    const prefix = `${VERTEX_PREFIX}${this.editingId}:`
    if (!id || !id.startsWith(prefix)) return
    this.dragIndex = Number(id.slice(prefix.length))
    if (!Number.isFinite(this.dragIndex)) {
      this.dragIndex = null
      return
    }
    // 拖拽顶点期间禁用相机平移，避免与编辑冲突
    this.viewer.scene.screenSpaceCameraController.enableInputs = false
  }

  private onLeftUp(): void {
    if (this.dragIndex === null || !this.editingId) return
    const annotation = this.annotations.find((item) => item.id === this.editingId)
    this.endDrag()
    if (annotation) this.onUpdate({ ...annotation })
  }

  private finishDraft(): void {
    if (!this.mode) return
    const minPoints = this.mode === 'area' ? 3 : 2
    if (this.points.length < minPoints) return
    const annotation: MeasureAnnotation = {
      ...this.currentDraftResult(),
      id: `measure-3d-${Date.now()}-${++this.idSeq}`,
      label: '',
      visible: true,
    }
    this.cancelDraft()
    this.onDraft(null)
    this.onComplete(annotation)
  }

  private currentDraftResult(): MeasureResult {
    return computeMeasure3D(this.mode ?? 'distance', this.points)
  }

  private cancelDraft(): void {
    this.points = []
    this.cursorPoint = null
    this.removeDraftEntities()
    this.onDraft(null)
  }

  /* ---------------- 草稿实体：CallbackProperty 单实体 ---------------- */

  /**
   * setMode 时一次性创建全部草稿实体。
   * geometry / polygon.hierarchy / outline.positions / line.positions /
   * label.position / label.text / vertices[*].position 全部用
   * new Cesium.CallbackProperty(fn, false) 动态求值，fn 闭包读取
   * this.mode / this.points / this.cursorPoint，MOUSE_MOVE 只改变量。
   */
  private createDraftEntities(): void {
    if (this.draftGroup) return
    const mode = this.mode as MeasureMode

    const draftGroup: DraftGroup = { vertices: [] }

    if (mode === 'area') {
      // 面：PolygonHierarchy 需闭合顶点，点数不足时 show=false
      draftGroup.polygon = this.viewer.entities.add({
        id: `${DRAFT_PREFIX}polygon`,
        polygon: {
          hierarchy: new Cesium.CallbackProperty(() => {
            const positions = collectPositions('area', this.points, this.cursorPoint, 3)
            if (positions.length < 3) return new Cesium.PolygonHierarchy([])
            return new Cesium.PolygonHierarchy(positions)
          }, false),
          material: new Cesium.ColorMaterialProperty(FILL),
          show: new Cesium.CallbackProperty(() => {
            const positions = collectPositions('area', this.points, this.cursorPoint, 3)
            return positions.length >= 3
          }, false),
        },
      })
      draftGroup.outline = this.viewer.entities.add({
        id: `${DRAFT_PREFIX}outline`,
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const positions = collectPositions('area', this.points, this.cursorPoint, 3)
            return closed(positions)
          }, false),
          width: 2.5,
          material: new Cesium.ColorMaterialProperty(ACCENT),
          clampToGround: true,
          show: new Cesium.CallbackProperty(() => {
            const positions = collectPositions('area', this.points, this.cursorPoint, 3)
            return positions.length >= 3
          }, false),
        },
      })
    } else {
      // 距离：折线仅需 ≥2 点（含预览点）就显示
      draftGroup.line = this.viewer.entities.add({
        id: `${DRAFT_PREFIX}line`,
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => collectPositions('distance', this.points, this.cursorPoint, 2),
            false,
          ),
          width: 3,
          material: new Cesium.ColorMaterialProperty(ACCENT),
          clampToGround: true,
          show: new Cesium.CallbackProperty(() => {
            const positions = collectPositions('distance', this.points, this.cursorPoint, 2)
            return positions.length >= 2
          }, false),
        },
      })
    }

    // 数值 Label：位置跟随最后一个点（橡皮筋末端），文本实时计算
    draftGroup.label = this.viewer.entities.add({
      id: `${DRAFT_PREFIX}label`,
      position: new Cesium.CallbackProperty(() => {
        const positions = collectPositions(mode, this.points, this.cursorPoint, 2)
        if (positions.length === 0) return Cesium.Cartesian3.ZERO
        // 距离模式 → 末端；面积模式 → 质心
        if (mode === 'area') {
          let lon = 0
          let lat = 0
          const source: LngLat[] = this.cursorPoint ? [...this.points, this.cursorPoint] : this.points
          for (const [x, y] of source) { lon += x; lat += y }
          const count = source.length || 1
          return Cesium.Cartesian3.fromDegrees(lon / count, lat / count)
        }
        return positions[positions.length - 1]!
      }, false) as unknown as Cesium.PositionProperty,
      label: new Cesium.LabelGraphics({
        text: new Cesium.CallbackProperty(() => {
          const result = computeMeasure3D(mode, this.cursorPoint ? [...this.points, this.cursorPoint] : this.points)
          return mode === 'area' ? formatArea(result.value) : formatDistance(result.value)
        }, false),
        font: '600 13px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        fillColor: TEXT_COLOR,
        outlineColor: TEXT_OUTLINE,
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: LABEL_BG,
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(500, 1.15, 3_000_000, 0.65),
        show: new Cesium.CallbackProperty(() => {
          const minForGeom = mode === 'area' ? 3 : 2
          const positions = collectPositions(mode, this.points, this.cursorPoint, minForGeom)
          return positions.length >= minForGeom
        }, false),
      }),
    })

    this.draftGroup = draftGroup
  }

  /**
   * 已确认顶点数变化时，重建 Point 实体数组。
   * 橡皮筋末端（cursorPoint）由 geometry CallbackProperty 自动延伸，
   * 不再单独创建 Point 实体，避免与顶点重叠闪烁。
   */
  private rebuildDraftVertices(): void {
    if (!this.draftGroup) return
    for (const v of this.draftGroup.vertices) this.viewer.entities.remove(v)
    this.draftGroup.vertices = []
    this.points.forEach((point, index) => {
      const [lon, lat] = point
      this.draftGroup!.vertices.push(
        this.viewer.entities.add({
          id: `${DRAFT_PREFIX}vertex:${index}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: {
            pixelSize: 9,
            color: ACCENT,
            outlineColor: TEXT_OUTLINE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      )
    })
  }

  private removeDraftEntities(): void {
    if (!this.draftGroup) {
      // 兜底：移除残留
      this.viewer.entities.values
        .filter((e) => typeof e.id === 'string' && e.id.startsWith(DRAFT_PREFIX))
        .forEach((e) => this.viewer.entities.remove(e))
      return
    }
    for (const entity of [
      this.draftGroup.polygon,
      this.draftGroup.outline,
      this.draftGroup.line,
      this.draftGroup.label,
      ...this.draftGroup.vertices,
    ]) {
      if (entity) this.viewer.entities.remove(entity)
    }
    this.draftGroup = null
  }

  /** 按需渲染模式下强制重绘（橡皮筋跟随更稳） */
  private requestRender(): void {
    try { this.viewer.scene.requestRender() } catch { /* ignore */ }
  }

  /* ---------------- 标注渲染 ---------------- */

  private createAnnotationGroup(annotation: MeasureAnnotation): void {
    const positions = annotation.points.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
    if (positions.length === 0) return
    const selected = annotation.id === this.selectedId
    const editing = annotation.id === this.editingId
    const group: AnnotationGroup = { vertices: [] }
    const baseId = `${ANNOTATION_PREFIX}${annotation.id}`

    if (annotation.mode === 'area' && positions.length >= 3) {
      group.polygon = this.viewer.entities.add({
        id: `${baseId}:shape`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: new Cesium.ColorMaterialProperty(selected ? FILL_SELECTED : FILL),
        },
      })
      group.outline = this.viewer.entities.add({
        id: `${baseId}:outline`,
        polyline: {
          positions: [...positions, positions[0]!],
          width: selected ? 3 : 2,
          material: selected
            ? new Cesium.ColorMaterialProperty(ACCENT_LIGHT)
            : new Cesium.PolylineDashMaterialProperty({ color: ACCENT }),
          clampToGround: true,
        },
      })
    } else if (annotation.mode === 'distance' && positions.length >= 2) {
      group.line = this.viewer.entities.add({
        id: `${baseId}:shape`,
        polyline: {
          positions,
          width: selected ? 4 : 3,
          material: selected
            ? new Cesium.ColorMaterialProperty(ACCENT_LIGHT)
            : new Cesium.PolylineDashMaterialProperty({ color: ACCENT }),
          clampToGround: true,
        },
      })
    }

    if (annotation.visible) {
      group.label = this.viewer.entities.add({
        id: `${baseId}:label`,
        position: this.anchorCartesian(annotation, positions),
        label: this.labelGraphics(labelText(annotation)),
      })
    }

    if (editing || selected) {
      positions.forEach((position, index) => {
        group.vertices.push(
          this.viewer.entities.add({
            id: `${VERTEX_PREFIX}${annotation.id}:${index}`,
            position,
            point: {
              pixelSize: editing ? 11 : 7,
              color: editing ? ACCENT_LIGHT : ACCENT,
              outlineColor: TEXT_OUTLINE,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        )
      })
    }

    this.groups.set(annotation.id, group)
  }

  private removeAnnotationEntities(): void {
    for (const group of this.groups.values()) {
      for (const entity of [group.polygon, group.line, group.outline, group.label, ...group.vertices]) {
        if (entity) this.viewer.entities.remove(entity)
      }
    }
    this.groups.clear()
    // 兜底：移除可能未被 groups 索引到的标注 / 顶点实体
    this.viewer.entities.values
      .filter((entity) => {
        if (typeof entity.id !== 'string') return false
        return entity.id.startsWith(ANNOTATION_PREFIX) || entity.id.startsWith(VERTEX_PREFIX)
      })
      .forEach((entity) => this.viewer.entities.remove(entity))
  }

  /** 顶点拖拽：更新几何、数值与标注文本（松手后才回写 store） */
  private moveVertex(id: string, index: number, point: LngLat): void {
    const annotation = this.annotations.find((item) => item.id === id)
    const group = this.groups.get(id)
    if (!annotation || !group || !annotation.points[index]) return

    const points = annotation.points.map((item, i) => (i === index ? point : item))
    const recomputed = computeMeasure3D(annotation.mode, points)
    Object.assign(annotation, recomputed)

    const positions = points.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
    if (group.polygon?.polygon) {
      group.polygon.polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(positions))
    }
    if (group.outline?.polyline) {
      group.outline.polyline.positions = new Cesium.ConstantProperty([...positions, positions[0]!])
    }
    if (group.line?.polyline) {
      group.line.polyline.positions = new Cesium.ConstantProperty(positions)
    }
    if (group.label) {
      group.label.position = new Cesium.ConstantPositionProperty(this.anchorCartesian(annotation, positions))
      if (group.label.label) {
        group.label.label.text = new Cesium.ConstantProperty(labelText(annotation))
      }
    }
    const handle = group.vertices[index]
    if (handle) handle.position = new Cesium.ConstantPositionProperty(positions[index]!)
    this.requestRender()
  }

  private endDrag(): void {
    this.dragIndex = null
    if (this.viewer.scene.screenSpaceCameraController.enableInputs === false) {
      this.viewer.scene.screenSpaceCameraController.enableInputs = true
    }
  }

  /* ---------------- 通用工具 ---------------- */

  /** 屏幕坐标 → 地表经纬度（优先地球拾取，退回椭球求交） */
  private pickLngLat(position: Cesium.Cartesian2): LngLat | null {
    const scene = this.viewer.scene
    const ray = scene.camera.getPickRay(position)
    const onGlobe = ray ? scene.globe.pick(ray, scene) : undefined
    const cartesian = onGlobe ?? scene.camera.pickEllipsoid(position, scene.globe.ellipsoid)
    if (!cartesian) return null
    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    if (!carto) return null
    return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)]
  }

  private anchorCartesian(annotation: MeasureAnnotation, positions: Cesium.Cartesian3[]): Cesium.Cartesian3 {
    if (annotation.mode === 'distance') return positions[positions.length - 1]!
    let lon = 0
    let lat = 0
    for (const [x, y] of annotation.points) {
      lon += x
      lat += y
    }
    const count = annotation.points.length || 1
    return Cesium.Cartesian3.fromDegrees(lon / count, lat / count)
  }

  private labelGraphics(text: string): Cesium.LabelGraphics {
    return new Cesium.LabelGraphics({
      text,
      font: '600 13px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      fillColor: TEXT_COLOR,
      outlineColor: TEXT_OUTLINE,
      outlineWidth: 3,
      showBackground: true,
      backgroundColor: LABEL_BG,
      backgroundPadding: new Cesium.Cartesian2(8, 5),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(500, 1.15, 3_000_000, 0.65),
    })
  }

  private setCursor(cursor: string): void {
    if (this.container) this.container.style.cursor = cursor
  }
}
