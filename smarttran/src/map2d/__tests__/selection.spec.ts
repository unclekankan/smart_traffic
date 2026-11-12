import { afterEach, describe, expect, it, vi } from 'vitest'

import { Map2DEngine } from '../Map2DEngine'
import { styleState } from '../styles/shared'
import { stationBufferLayer } from '../layers/analysis'

const changed = vi.fn()

vi.mock('../layers/analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layers/analysis')>()
  return {
    ...actual,
    setStationBufferSelection: vi.fn(),
  }
})

function engineWithLayers(): Map2DEngine {
  const engine = new Map2DEngine()
  Object.assign(engine, {
    roads: { changed },
    stations: { changed },
    stationLabels: { changed },
  })
  return engine
}

afterEach(() => {
  styleState.selectedId = null
  changed.mockClear()
})

describe('Map2DEngine selection state', () => {
  it('updates only the 2D style state and refreshes its layers', () => {
    const engine = engineWithLayers()

    engine.setSelected({ kind: 'road', id: 'R1', name: 'Line 1' })

    expect(styleState.selectedId).toBe('R1')
    expect(changed).toHaveBeenCalledTimes(3)

    engine.setSelected(null)

    expect(styleState.selectedId).toBeNull()
    expect(changed).toHaveBeenCalledTimes(6)
  })

  it('clears the module-owned 2D selection when destroyed', () => {
    const engine = engineWithLayers()
    engine.setSelected({ kind: 'station', id: 'S1', name: 'Station' })
    changed.mockClear()

    engine.destroy()

    expect(styleState.selectedId).toBeNull()
    expect(changed).toHaveBeenCalledTimes(3)
    expect(stationBufferLayer.getSource()?.getFeatures()).toHaveLength(0)
  })
})
