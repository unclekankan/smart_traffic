/**
 * 2D 测距 / 测面积控制器（OpenLayers 原生实现，3D 独立实现于 map3d/measure）
 *
 * 职责边界：
 * - 采集：ol/interaction/Draw（LineString / Polygon）实时绘制轨迹
 * - 计算：ol/sphere 的 getLength / getArea（按视图投影 EPSG:4326 做测地计算）
 * - 反馈：ol/Overlay 浮层实时展示当前数值
 * - 标注：已完成测量写入独立标注图层，支持文本重命名、显隐、删除与 ol/interaction/Modify 顶点编辑
 *
 * 对外只暴露业务语义（MeasureMode / MeasureResult / MeasureAnnotation），
 * 由 Map2DEngine 转接到 MapEngine 事件。
 */

import Collection from 'ol/Collection'
import Feature from 'ol/Feature'
import type { Coordinate } from 'ol/coordinate'
import type { EventsKey } from 'ol/events'
import type Geometry from 'ol/geom/Geometry'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import type OlMap from 'ol/Map'
import Overlay from 'ol/Overlay'
import { unByKey } from 'ol/Observable'
import type VectorSource from 'ol/source/Vector'
import { getArea, getLength } from 'ol/sphere'

import type { LngLat } from '@/common/types/geo'
import type { MeasureAnnotation, MeasureMode, MeasureResult } from '@/common/types/measure'
import { formatArea, formatDistance } from '@/common/utils/measureFormat'
import { measureSketchStyle } from './measureLayer'

/** 视图投影（与 map2d/config/view.ts 保持一致） */
const VIEW_PROJECTION = 'EPSG:4326'

export interface MeasureControllerOptions {
  map: OlMap
  /** 承载已完成测量标注的图层数据源 */
  source: VectorSource
  /** 绘制草稿实时结果，null 表示草稿清空 */
  onDraft: (result: MeasureResult | null) => void
  /** 完成一次测量 */
  onComplete: (annotation: MeasureAnnotation) => void
  /** 顶点编辑后更新标注 */
  onUpdate: (annotation: MeasureAnnotation) => void
}

export class MeasureController {
  private readonly map: OlMap
  private readonly source: VectorSource
  private readonly onDraft: (result: MeasureResult | null) => void
  private readonly onComplete: (annotation: MeasureAnnotation) => void
  private readonly onUpdate: (annotation: MeasureAnnotation) => void

  private draw: Draw | null = null
  private modify: Modify | null = null
  private mode: MeasureMode | null = null
  /** 草图几何 change 监听（绘制过程中实时计算） */
  private changeKey: EventsKey | null = null
  private sketch: Feature<Geometry> | null = null

  /** 当前模式的标注缓存与几何要素索引（用于选中样式 / 顶点编辑） */
  private annotations: MeasureAnnotation[] = []
  private featureById = new Map<string, Feature<Geometry>>()
  private selectedId: string | null = null
  private editingId: string | null = null

  private readonly tooltip: Overlay
  private readonly tooltipEl: HTMLDivElement

  constructor(options: MeasureControllerOptions) {
    this.map = options.map
    this.source = options.source
    this.onDraft = options.onDraft
    this.onComplete = options.onComplete
    this.onUpdate = options.onUpdate

    this.tooltipEl = document.createElement('div')
    this.tooltipEl.style.cssText = [
      'position:absolute',
      'transform:translate(-50%,-130%)',
      'padding:4px 8px',
      'border-radius:4px',
      'background:rgba(10,16,28,.92)',
      'border:1px solid #35c8e8',
      'color:#e8f1fb',
      'font-size:11px',
      'line-height:1.4',
      'white-space:nowrap',
      'pointer-events:none',
    ].join(';')
    this.tooltip = new Overlay({ element: this.tooltipEl, positioning: 'bottom-center' })
    this.map.addOverlay(this.tooltip)
  }

  /** 是否处于测量交互中（用于引擎屏蔽点选、切换指针样式） */
  get active(): boolean {
    return this.mode !== null || this.editingId !== null
  }

  /** 启用 / 关闭测量；重复设置同一模式不重建交互 */
  setMode(mode: MeasureMode | null): void {
    if (mode === this.mode) return
    this.detachDraw()
    this.detachModify()
    this.hideTooltip()
    this.onDraft(null)
    this.mode = mode

    if (!mode) {
      this.setCursor('')
      return
    }
    this.startDraw(mode)
    this.setCursor('crosshair')
  }

  /** 同步标注图层（由 store 驱动，重建几何 / 文本 / 选中样式） */
  renderAnnotations(annotations: MeasureAnnotation[], selectedId: string | null): void {
    this.annotations = annotations.map((annotation) => ({ ...annotation }))
    this.selectedId = selectedId
    this.rebuildFeatures()
  }

  /** 进入 / 退出顶点编辑（null 表示退出） */
  setEditing(id: string | null): void {
    if (this.editingId === id) return
    this.editingId = id
    this.detachModify()
    if (id) {
      this.attachModify(id)
      this.setCursor('crosshair')
    } else {
      this.setCursor(this.mode ? 'crosshair' : '')
    }
  }

  /** 清除测量标注与草稿，保留当前工具（重新开始绘制） */
  clear(): void {
    this.detachModify()
    this.detachDraw()
    this.source.clear()
    this.featureById.clear()
    this.annotations = []
    this.selectedId = null
    this.editingId = null
    this.sketch = null
    this.hideTooltip()
    this.onDraft(null)
    if (this.mode) this.startDraw(this.mode)
  }

  destroy(): void {
    this.detachDraw()
    this.detachModify()
    this.hideTooltip()
    this.map.removeOverlay(this.tooltip)
    this.tooltipEl.remove()
    this.setCursor('')
  }

  /* ---------------- 内部实现 ---------------- */

  private rebuildFeatures(): void {
    this.source.clear()
    this.featureById.clear()
    for (const annotation of this.annotations) {
      const feature = this.featureForAnnotation(annotation)
      if (!feature) continue
      this.source.addFeature(feature)
      this.featureById.set(annotation.id, feature)
    }
    this.detachModify()
    if (this.editingId) this.attachModify(this.editingId)
  }

  private featureForAnnotation(annotation: MeasureAnnotation): Feature<Geometry> | null {
    const coords: Coordinate[] = annotation.points.map(([lon, lat]) => [lon, lat])
    let geometry: Geometry
    if (annotation.mode === 'area') {
      if (coords.length < 3) return null
      geometry = new Polygon([[...coords, coords[0]!]])
    } else {
      if (coords.length < 2) return null
      geometry = new LineString(coords)
    }
    const feature = new Feature({ geometry })
    feature.setProperties({
      measureId: annotation.id,
      label: annotation.label,
      text: `${annotation.label}\n${annotation.mode === 'area'
        ? formatArea(annotation.value)
        : formatDistance(annotation.value)}`,
      selected: annotation.id === this.selectedId,
      visible: annotation.visible,
    })
    return feature
  }

  private startDraw(mode: MeasureMode): void {
    const draw = new Draw({
      type: mode === 'area' ? 'Polygon' : 'LineString',
      style: measureSketchStyle(),
    })
    this.draw = draw
    this.map.addInteraction(draw)

    draw.on('drawstart', (event) => {
      this.onDraft(null)
      this.sketch = event.feature
      const geometry = event.feature.getGeometry()
      if (geometry) {
        this.changeKey = geometry.on('change', () => this.updateLive())
      }
    })

    draw.on('drawend', (event) => {
      this.unbindChange()
      const geometry = event.feature.getGeometry()
      this.sketch = null
      this.hideTooltip()
      this.onDraft(null)
      if (!geometry) return
      this.onComplete(this.annotationFromGeometry(geometry, { id: '', label: '', visible: true }))
    })
  }

  private detachDraw(): void {
    this.unbindChange()
    if (!this.draw) return
    this.map.removeInteraction(this.draw)
    this.draw = null
  }

  private attachModify(id: string): void {
    const feature = this.featureById.get(id)
    if (!feature) return
    const modify = new Modify({ features: new Collection([feature]), pixelTolerance: 6 })
    this.modify = modify
    this.map.addInteraction(modify)
    modify.on('modifyend', () => {
      const base = this.annotations.find((annotation) => annotation.id === id)
      const geometry = feature.getGeometry()
      if (!base || !geometry) return
      this.onUpdate(this.annotationFromGeometry(geometry, base))
    })
  }

  private detachModify(): void {
    if (!this.modify) return
    this.map.removeInteraction(this.modify)
    this.modify = null
  }

  private unbindChange(): void {
    if (!this.changeKey) return
    unByKey(this.changeKey)
    this.changeKey = null
  }

  /** 绘制过程中实时计算并更新浮层 + 面板草稿 */
  private updateLive(): void {
    if (!this.mode) return
    const geometry = this.sketch?.getGeometry()
    if (!geometry) return
    const result = this.compute(geometry)
    this.onDraft(result)
    const position = this.lastCoordinate(geometry)
    if (!position) return

    this.tooltipEl.textContent = result.mode === 'distance'
      ? `${formatDistance(result.value)} · ${result.vertexCount} 点`
      : `${formatArea(result.value)} · ${result.vertexCount} 顶点`
    this.tooltip.setPosition(position)
  }

  private hideTooltip(): void {
    this.tooltip.setPosition(undefined)
  }

  private lastCoordinate(geometry: Geometry): Coordinate | undefined {
    if (geometry instanceof LineString) {
      const coords = geometry.getCoordinates()
      return coords[coords.length - 1]
    }
    if (geometry instanceof Polygon) {
      const ring = geometry.getCoordinates()[0] ?? []
      return ring[ring.length - 1]
    }
    return undefined
  }

  private annotationFromGeometry(
    geometry: Geometry,
    base: Pick<MeasureAnnotation, 'id' | 'label' | 'visible'>,
  ): MeasureAnnotation {
    return { ...this.compute(geometry), ...base }
  }

  /** 基于 ol/sphere 的测地计算（模型与 3D 侧 Cesium 结果保持一致） */
  private compute(geometry: Geometry): MeasureResult {
    if (geometry instanceof Polygon) {
      const ring = geometry.getCoordinates()[0] ?? []
      // 环首尾点重复，顶点数需减 1
      const points = ring.slice(0, Math.max(0, ring.length - 1)) as LngLat[]
      const perimeter = ring.length >= 2
        ? getLength(new LineString(ring), { projection: VIEW_PROJECTION })
        : 0
      return {
        mode: 'area',
        value: getArea(geometry, { projection: VIEW_PROJECTION }),
        segments: [],
        perimeter,
        vertexCount: points.length,
        points,
      }
    }

    const coords = geometry instanceof LineString ? geometry.getCoordinates() : []
    const points = coords as LngLat[]
    const segments: number[] = []
    for (let i = 1; i < coords.length; i++) {
      segments.push(
        getLength(new LineString([coords[i - 1]!, coords[i]!]), { projection: VIEW_PROJECTION }),
      )
    }
    return {
      mode: 'distance',
      value: segments.reduce((sum, segment) => sum + segment, 0),
      segments,
      perimeter: 0,
      vertexCount: points.length,
      points,
    }
  }

  private setCursor(cursor: string): void {
    const element = this.map.getTargetElement()
    if (element) element.style.cursor = cursor
  }
}
