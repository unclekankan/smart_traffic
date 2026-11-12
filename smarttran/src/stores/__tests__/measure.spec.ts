import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useMapStore } from '../mapStore'
import type { MeasureAnnotation, MeasureResult } from '@/common/types/measure'

function draft(overrides: Partial<MeasureResult> = {}): MeasureResult {
  return {
    mode: 'distance',
    value: 1200,
    segments: [600, 600],
    perimeter: 0,
    vertexCount: 3,
    points: [[104.06, 30.66], [104.065, 30.66], [104.07, 30.66]],
    ...overrides,
  }
}

function annotation(id: string, overrides: Partial<MeasureAnnotation> = {}): MeasureAnnotation {
  return { ...draft(), id, label: '', visible: true, ...overrides }
}

beforeEach(() => setActivePinia(createPinia()))

describe('measure state isolation between 2D and 3D', () => {
  it('clears the leaving mode measurement state on switch and keeps it out of the target mode', () => {
    const store = useMapStore()
    store.setMeasureMode('distance')
    store.setMeasureDraft('2d', draft())

    expect(store.measureMode).toBe('distance')
    expect(store.measureResult).not.toBeNull()

    store.addMeasureAnnotation('2d', annotation('m1'))
    // 完成测量后草稿转入标注图层
    expect(store.measureResult).toBeNull()
    expect(store.measureAnnotations).toHaveLength(1)
    expect(store.measureAnnotations[0]).toMatchObject({ label: '测距 1', visible: true })

    store.setMode('3d')

    // 3D 视图干净：无工具、无草稿、无标注、无残留选中
    expect(store.measureMode).toBe('none')
    expect(store.measureResult).toBeNull()
    expect(store.measureAnnotations).toHaveLength(0)
    expect(store.selectedMeasureId).toBeNull()
    expect(store.measureEditingId).toBeNull()
    // 离开的 2D 模式同样被完整清理
    expect(store.measureByMode['2d'].mode).toBe('none')
    expect(store.measureByMode['2d'].annotations).toHaveLength(0)
    expect(store.measureByMode['2d'].draft).toBeNull()

    store.setMode('2d')
    expect(store.measureAnnotations).toHaveLength(0)
  })

  it('ignores measurement events that belong to the other mode', () => {
    const store = useMapStore()
    store.setMode('3d')

    store.setMeasureDraft('2d', draft())
    store.addMeasureAnnotation('2d', annotation('m2'))
    store.updateMeasureAnnotation('2d', annotation('m2', { value: 9999 }))

    expect(store.measureResult).toBeNull()
    expect(store.measureAnnotations).toHaveLength(0)
    expect(store.measureByMode['2d'].annotations).toHaveLength(0)
  })

  it('keeps each mode annotations independent when measurements run in both', () => {
    const store = useMapStore()
    store.addMeasureAnnotation('2d', annotation('a2d'))
    store.setMode('3d')
    store.addMeasureAnnotation('3d', annotation('a3d', { value: 800 }))

    expect(store.measureAnnotations.map((item) => item.id)).toEqual(['a3d'])
    store.setMode('2d')
    // 离开 3D 时其测量状态被完整清理，不会带到 2D，也不在 3D 切片中残留
    expect(store.measureAnnotations).toHaveLength(0)
    expect(store.measureByMode['3d'].annotations).toHaveLength(0)
  })
})

describe('measure annotation editing', () => {
  it('renames, toggles visibility, selects and removes annotations in the current mode', () => {
    const store = useMapStore()
    store.addMeasureAnnotation('2d', annotation('m1'))
    store.addMeasureAnnotation('2d', annotation('m2', { mode: 'area', label: '面积 1' }))

    store.renameMeasureAnnotation('m1', '  主通道  ')
    expect(store.measureAnnotations[0]!.label).toBe('主通道')

    store.toggleMeasureAnnotationVisible('m1')
    expect(store.measureAnnotations[0]!.visible).toBe(false)

    store.selectMeasureAnnotation('m2')
    expect(store.selectedMeasureId).toBe('m2')

    store.removeMeasureAnnotation('m2')
    expect(store.measureAnnotations.map((item) => item.id)).toEqual(['m1'])
    expect(store.selectedMeasureId).toBeNull()
  })

  it('updates geometry result only for existing annotations', () => {
    const store = useMapStore()
    store.addMeasureAnnotation('2d', annotation('m1'))

    const updated = annotation('m1', { value: 1500, vertexCount: 4 })
    store.updateMeasureAnnotation('2d', updated)
    expect(store.measureAnnotations[0]!.value).toBe(1500)
    expect(store.measureAnnotations[0]!.vertexCount).toBe(4)

    store.updateMeasureAnnotation('2d', annotation('missing', { value: 1 }))
    expect(store.measureAnnotations).toHaveLength(1)
  })

  it('enters and exits vertex editing only for known annotations', () => {
    const store = useMapStore()
    store.addMeasureAnnotation('2d', annotation('m1'))

    store.setMeasureEditing('missing')
    expect(store.measureEditingId).toBeNull()

    store.setMeasureEditing('m1')
    expect(store.measureEditingId).toBe('m1')
    expect(store.selectedMeasureId).toBe('m1')

    store.setMeasureEditing(null)
    expect(store.measureEditingId).toBeNull()
  })

  it('clearMeasure removes graphics of the current mode only and keeps the active tool', () => {
    const store = useMapStore()
    store.setMeasureMode('area')
    store.addMeasureAnnotation('2d', annotation('m1'))
    store.setMode('3d')
    store.setMeasureMode('distance')
    store.addMeasureAnnotation('3d', annotation('a1'))

    const seq = store.measureClearSeq
    store.clearMeasure()

    expect(store.measureMode).toBe('distance')
    expect(store.measureAnnotations).toHaveLength(0)
    expect(store.measureResult).toBeNull()
    expect(store.measureClearSeq).toBe(seq + 1)
    // 2D 的切片保持被清理后的空状态，不会复活
    expect(store.measureByMode['2d'].annotations).toHaveLength(0)
  })
})
