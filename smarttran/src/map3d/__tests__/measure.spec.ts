import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Cesium from 'cesium'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'
import { getArea, getLength } from 'ol/sphere'

import type { MeasureAnnotation } from '@/common/types/measure'
import type { LngLat } from '@/common/types/geo'
import { MeasureController3D, type MeasureInputHandler } from '../measure/measureController3D'
import { computeAreaResult, computeDistanceResult, geodesicDistance } from '../measure/measureMath'

const P1: LngLat = [104.06, 30.66]
const P2: LngLat = [104.07, 30.66]
const P3: LngLat = [104.07, 30.67]

function entityCollection() {
  const values: any[] = []
  return {
    values,
    add(options: any) {
      const entity = { ...options, show: true }
      values.push(entity)
      return entity
    },
    remove(entity: any) {
      const index = values.indexOf(entity)
      if (index < 0) return false
      values.splice(index, 1)
      return true
    },
  }
}

function fakeHandler() {
  const actions = new Map<number, (event: any) => void>()
  const state = { destroyed: false }
  const handler: MeasureInputHandler & { fire: (type: number, event?: any) => void; actions: Map<number, (event: any) => void>; state: typeof state } = {
    actions,
    state,
    setInputAction(action, type) { actions.set(type, action) },
    removeInputAction(type) { actions.delete(type) },
    destroy() { actions.clear(); state.destroyed = true },
    fire(type, event = {}) { actions.get(type)?.(event) },
  }
  return handler
}

function fakeViewer() {
  const entities = entityCollection()
  const container = document.createElement('div')
  const camera = {
    // 测试用：把屏幕坐标的 x/y 直接当作经纬度
    pickEllipsoid: (position: { x: number; y: number }) =>
      Cesium.Cartesian3.fromDegrees(position.x, position.y),
    getPickRay: () => ({}),
  }
  const scene = {
    canvas: document.createElement('canvas'),
    camera,
    globe: { ellipsoid: Cesium.Ellipsoid.WGS84, pick: () => undefined },
    pick: (_position: unknown) => ({ id: 'measure:vertex:annotation-1:1' }),
    screenSpaceCameraController: { enableInputs: true },
  }
  return { viewer: { entities, scene, container } as unknown as Cesium.Viewer, entities, scene, container }
}

const click = (position: LngLat) => ({
  position: { x: position[0], y: position[1] },
  endPosition: { x: position[0], y: position[1] },
})

function setup() {
  const handler = fakeHandler()
  const { viewer, entities, scene, container } = fakeViewer()
  const onDraft = vi.fn()
  const onComplete = vi.fn()
  const onUpdate = vi.fn()
  const controller = new MeasureController3D({ viewer, handler, onDraft, onComplete, onUpdate })
  return { controller, handler, entities, scene, container, onDraft, onComplete, onUpdate }
}

const annotationIds = (entities: ReturnType<typeof entityCollection>) =>
  entities.values
    .map((entity) => String(entity.id))
    .filter((id) => id.startsWith('measure:annotation:') || id.startsWith('measure:vertex:'))

beforeEach(() => vi.restoreAllMocks())

describe('3D measure controller', () => {
  it('draws a distance with live feedback and completes an annotation on double click', () => {
    const { controller, handler, onDraft, onComplete } = setup()
    controller.setMode('distance')

    handler.fire(Cesium.ScreenSpaceEventType.LEFT_CLICK, click(P1))
    handler.fire(Cesium.ScreenSpaceEventType.LEFT_CLICK, click(P2))

    const expected = geodesicDistance(P1, P2)
    const live = onDraft.mock.calls[onDraft.mock.calls.length - 1]![0]
    expect(live.mode).toBe('distance')
    expect(live.vertexCount).toBe(2)
    expect(live.value).toBeCloseTo(expected, 5)

    handler.fire(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    expect(onComplete).toHaveBeenCalledTimes(1)
    const created = onComplete.mock.calls[0]![0] as MeasureAnnotation
    expect(created.mode).toBe('distance')
    expect(created.points).toHaveLength(2)
    expect(created.points[0]![0]).toBeCloseTo(P1[0], 9)
    expect(created.points[0]![1]).toBeCloseTo(P1[1], 9)
    expect(created.points[1]![0]).toBeCloseTo(P2[0], 9)
    expect(created.points[1]![1]).toBeCloseTo(P2[1], 9)
    expect(created.value).toBeCloseTo(expected, 5)
    expect(onDraft).toHaveBeenLastCalledWith(null)
  })

  it('closes an area measurement and renders a polygon with a text label', () => {
    const { controller, handler, entities, onComplete } = setup()
    controller.setMode('area')
    for (const point of [P1, P2, P3]) {
      handler.fire(Cesium.ScreenSpaceEventType.LEFT_CLICK, click(point))
    }
    handler.fire(Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    const created = onComplete.mock.calls[0]![0] as MeasureAnnotation
    expect(created.mode).toBe('area')
    expect(created.value).toBeGreaterThan(0)
    expect(created.perimeter).toBeGreaterThan(0)

    controller.renderAnnotations([{ ...created, id: 'a1', label: '中心区', visible: true }], null)
    const ids = annotationIds(entities)
    expect(ids).toContain('measure:annotation:a1:shape')
    expect(ids).toContain('measure:annotation:a1:outline')
    expect(ids).toContain('measure:annotation:a1:label')
    const shape = entities.values.find((entity) => entity.id === 'measure:annotation:a1:shape')
    const label = entities.values.find((entity) => entity.id === 'measure:annotation:a1:label')
    expect(shape.polygon).toBeDefined()
    expect(String(label.label.text)).toContain('中心区')
  })

  it('shows vertex handles while editing and writes back drag updates', () => {
    const { controller, handler, entities, scene, onUpdate } = setup()
    controller.setMode('distance')
    handler.fire(Cesium.ScreenSpaceEventType.LEFT_CLICK, click(P1))
    handler.fire(Cesium.ScreenSpaceEventType.LEFT_CLICK, click(P2))
    handler.fire(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    const created = { ...(setupAnnotationBase()) }

    controller.renderAnnotations([created], created.id)
    controller.setEditing(created.id)
    expect(annotationIds(entities)).toContain(`measure:vertex:${created.id}:0`)

    handler.fire(Cesium.ScreenSpaceEventType.LEFT_DOWN, click(P1))
    expect(scene.screenSpaceCameraController.enableInputs).toBe(false)

    handler.fire(Cesium.ScreenSpaceEventType.MOUSE_MOVE, click([104.065, 30.665]))
    expect(scene.screenSpaceCameraController.enableInputs).toBe(false)

    handler.fire(Cesium.ScreenSpaceEventType.LEFT_UP)
    expect(scene.screenSpaceCameraController.enableInputs).toBe(true)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    const updated = onUpdate.mock.calls[0]![0] as MeasureAnnotation
    expect(updated.points[1]![0]).toBeCloseTo(104.065, 9)
    expect(updated.points[1]![1]).toBeCloseTo(30.665, 9)
    expect(updated.value).not.toBe(created.value)
  })

  it('rebuilds annotations on sync and removes all entities on destroy', () => {
    const { controller, handler, entities, container } = setup()
    const first = { ...setupAnnotationBase(), id: 'a1' }
    const second = { ...setupAnnotationBase(), id: 'a2', label: '第二条' }
    controller.renderAnnotations([first, second], 'a2')
    expect(annotationIds(entities).some((id) => id.includes('a1'))).toBe(true)
    expect(annotationIds(entities).some((id) => id.includes('a2'))).toBe(true)

    controller.renderAnnotations([second], 'a2')
    expect(annotationIds(entities).some((id) => id.includes('a1'))).toBe(false)
    expect(annotationIds(entities).some((id) => id.includes('a2'))).toBe(true)

    controller.setMode('distance')
    controller.renderAnnotations([second], 'a2')
    controller.destroy()

    expect(handler.state.destroyed).toBe(true)
    expect(entities.values).toHaveLength(0)
    expect(container.style.cursor).toBe('')
  })

  it('keeps 2D and 3D measurement values consistent for the same geometry', () => {
    const distance3D = computeDistanceResult([P1, P2, P3]).value
    const distance2D = getLength(
      new LineString([P1, P2, P3]),
      { projection: 'EPSG:4326' },
    )
    expect(distance3D).toBeGreaterThan(0)
    expect(Math.abs(distance3D - distance2D) / distance2D).toBeLessThan(0.005)

    const area3D = computeAreaResult([P1, P2, P3]).value
    const area2D = getArea(
      new Polygon([[...[P1, P2, P3], P1]]),
      { projection: 'EPSG:4326' },
    )
    expect(area3D).toBeGreaterThan(0)
    expect(Math.abs(area3D - area2D) / area2D).toBeLessThan(0.01)
  })
})

/** 与 3D 控制器生成的标注结构一致（用于同步 / 编辑测试） */
function setupAnnotationBase(): MeasureAnnotation {
  return {
    ...computeDistanceResult([P1, P2]),
    id: 'annotation-1',
    label: '测距 1',
    visible: true,
  }
}
