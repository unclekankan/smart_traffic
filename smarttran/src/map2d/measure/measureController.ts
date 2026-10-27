/**
 * 测距 / 测面积控制器（OpenLayers 原生实现）
 *
 * 职责边界：
 * - 采集：ol/interaction/Draw（LineString / Polygon）
 * - 计算：ol/sphere 的 getLength / getArea（按视图投影 EPSG:4326 做测地计算）
 * - 反馈：ol/Overlay 浮层实时展示结果
 *
 * 对外只暴露业务语义（MeasureMode / MeasureResult），
 * 由 Map2DEngine 转接到 MapEngine 的 `measure` 事件。
 */

import type { Feature } from 'ol'
import type { Coordinate } from 'ol/coordinate'
import type { EventsKey } from 'ol/events'
import type Geometry from 'ol/geom/Geometry'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'
import Draw from 'ol/interaction/Draw'
import type Map from 'ol/Map'
import Overlay from 'ol/Overlay'
import { unByKey } from 'ol/Observable'
import type VectorSource from 'ol/source/Vector'
import { getArea, getLength } from 'ol/sphere'

import type { MeasureMode, MeasureResult } from '@/common/types/measure'
import { formatArea, formatDistance } from '@/common/utils/measureFormat'
import { measureSketchStyle } from './measureLayer'

/** 视图投影（与 map2d/config/view.ts 保持一致） */
const VIEW_PROJECTION = 'EPSG:4326'

export interface MeasureControllerOptions {
  map: Map
  /** 承载已完成测量几何的图层数据源 */
  source: VectorSource
  /** 结果变化回调，null 表示已清除 */
  onResult: (result: MeasureResult | null) => void
}

export class MeasureController {
  private readonly map: Map
  private readonly source: VectorSource
  private readonly onResult: (result: MeasureResult | null) => void

  private draw: Draw | null = null
  private mode: MeasureMode | null = null
  /** 草图几何 change 监听（绘制过程中实时计算） */
  private changeKey: EventsKey | null = null
  /** 当前（或最近一次）测量要素 */
  private feature: Feature<Geometry> | null = null

  private readonly tooltip: Overlay
  private readonly tooltipEl: HTMLDivElement

  constructor(options: MeasureControllerOptions) {
    this.map = options.map
    this.source = options.source
    this.onResult = options.onResult

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

  /** 是否处于测量状态（用于引擎屏蔽点选、切换指针样式） */
  get active(): boolean {
    return this.mode !== null
  }

  /** 启用 / 关闭测量；重复设置同一模式不重建交互 */
  setMode(mode: MeasureMode | null): void {
    if (mode === this.mode) return
    this.detachDraw()
    this.source.clear()
    this.feature = null
    this.hideTooltip()
    this.onResult(null)
    this.mode = mode

    if (!mode) {
      this.setCursor('')
      return
    }
    this.startDraw(mode)
    this.setCursor('crosshair')
  }

  /** 清除测量图形与结果（保留当前模式） */
  clear(): void {
    this.source.clear()
    this.feature = null
    this.hideTooltip()
    this.onResult(null)
  }

  destroy(): void {
    this.detachDraw()
    this.hideTooltip()
    this.map.removeOverlay(this.tooltip)
    this.tooltipEl.remove()
    this.setCursor('')
  }

  /* ---------------- 内部实现 ---------------- */

  private startDraw(mode: MeasureMode): void {
    const draw = new Draw({
      source: this.source,
      type: mode === 'area' ? 'Polygon' : 'LineString',
      style: measureSketchStyle(),
    })
    this.draw = draw
    this.map.addInteraction(draw)

    draw.on('drawstart', (event) => {
      // 每次重新取点只保留最新一次测量
      this.source.clear()
      this.onResult(null)
      this.feature = event.feature
      const geometry = event.feature.getGeometry()
      if (geometry) {
        this.changeKey = geometry.on('change', () => this.updateLive())
      }
    })

    draw.on('drawend', (event) => {
      this.unbindChange()
      this.feature = event.feature
      this.onResult(this.compute(event.feature.getGeometry() ?? null))
      this.hideTooltip()
    })
  }

  private detachDraw(): void {
    this.unbindChange()
    if (!this.draw) return
    this.map.removeInteraction(this.draw)
    this.draw = null
  }

  private unbindChange(): void {
    if (!this.changeKey) return
    unByKey(this.changeKey)
    this.changeKey = null
  }

  /** 绘制过程中实时计算并更新浮层 */
  private updateLive(): void {
    if (!this.mode) return
    const geometry = this.feature?.getGeometry()
    if (!geometry) return
    const result = this.compute(geometry)
    this.onResult(result)
    const position = this.lastCoordinate(geometry)
    if (!position) return

    this.tooltipEl.textContent =
      result.mode === 'distance'
        ? `${formatDistance(result.value)} · ${result.vertexCount} 点`
        : formatArea(result.value)
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

  /** 基于 ol/sphere 的测地计算 */
  private compute(geometry: Geometry | null): MeasureResult {
    if (this.mode === 'area') {
      const polygon = geometry instanceof Polygon ? geometry : null
      const ring = polygon?.getCoordinates()[0] ?? []
      const perimeter = ring.length >= 2
        ? getLength(new LineString(ring), { projection: VIEW_PROJECTION })
        : 0
      return {
        mode: 'area',
        value: polygon ? getArea(polygon, { projection: VIEW_PROJECTION }) : 0,
        segments: [],
        perimeter,
        // 环首尾点重复，顶点数需减 1
        vertexCount: Math.max(0, ring.length - 1),
      }
    }

    const line = geometry instanceof LineString ? geometry : null
    const coords = line?.getCoordinates() ?? []
    const segments: number[] = []
    for (let i = 1; i < coords.length; i++) {
      segments.push(
        getLength(new LineString([coords[i - 1]!, coords[i]!]), { projection: VIEW_PROJECTION }),
      )
    }
    return {
      mode: 'distance',
      value: line ? getLength(line, { projection: VIEW_PROJECTION }) : 0,
      segments,
      perimeter: 0,
      vertexCount: coords.length,
    }
  }

  private setCursor(cursor: string): void {
    const element = this.map.getTargetElement()
    if (element) element.style.cursor = cursor
  }
}
