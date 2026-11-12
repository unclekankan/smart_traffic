import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'

import type { SelectedObject } from '@/common/types/engine'
import { Map3DEngine } from '../Map3DEngine'

function roadEntities(id: string) {
  const lineMaterial = new Cesium.ColorMaterialProperty(Cesium.Color.RED)
  const volumeMaterial = new Cesium.ColorMaterialProperty(Cesium.Color.RED.withAlpha(0.5))
  const line = { id: `road:${id}`, polyline: { material: lineMaterial } }
  const volume = { id: `road-volume:${id}:0`, polylineVolume: { material: volumeMaterial } }
  const viewer = { entities: { values: [line, volume] } }
  const engine = Object.create(Map3DEngine.prototype) as Map3DEngine
  Object.assign(engine, {
    viewer: {
      ...viewer,
      destroy() {},
      scene: { canvas: document.createElement('canvas') },
      screenSpaceEventHandler: { removeInputAction() {} },
      camera: { cancelFlight() {} },
    },
    handler: { destroy() {} },
    listeners: new Map(),
    selectedRoadId: null,
    contextRoadId: null,
    highlightedRoad: [],
    selectedStationEntities: [],
    basemapErrorRemovers: [],
    basemapFallbackQueue: [],
    basemapErrorCount: 0,
    basemapErrorRemove: null,
    clampCallback: null,
    pickPointMode: false,
    routePickMode: false,
    entityIndex: new Map(),
  })
  return { engine, line, volume, lineMaterial, volumeMaterial }
}

const road = (id: string): SelectedObject => ({ kind: 'road', id, name: `Line ${id}` })
const station: SelectedObject = { kind: 'station', id: 'S1', name: 'Station' }

describe('Map3DEngine selection state', () => {
  it('gives selected road priority and falls back to context road', () => {
    const { engine, line, volume, lineMaterial, volumeMaterial } = roadEntities('R1')

    engine.setContextRoad(road('R1'))
    const contextHighlight = line.polyline.material
    expect(contextHighlight).not.toBe(lineMaterial)

    engine.setSelected(road('R1'))
    expect(line.polyline.material).not.toBe(lineMaterial)
    expect(volume.polylineVolume.material).not.toBe(volumeMaterial)

    engine.setSelected(station)
    expect(line.polyline.material).not.toBe(lineMaterial)
    expect(volume.polylineVolume.material).not.toBe(volumeMaterial)

    engine.setContextRoad(null)
    expect(line.polyline.material).toBe(lineMaterial)
    expect(volume.polylineVolume.material).toBe(volumeMaterial)
  })

  it('restores the selected route before applying a different selected route', () => {
    const { engine, line, volume, lineMaterial, volumeMaterial } = roadEntities('R1')

    engine.setSelected(road('R1'))
    expect(line.polyline.material).not.toBe(lineMaterial)

    engine.setSelected(null)
    expect(line.polyline.material).toBe(lineMaterial)
    expect(volume.polylineVolume.material).toBe(volumeMaterial)
  })

  it('clears highlighted materials and business IDs on destroy', () => {
    const { engine, line, volume, lineMaterial, volumeMaterial } = roadEntities('R1')
    engine.setContextRoad(road('R1'))
    engine.setSelected(road('R1'))

    engine.destroy()

    expect(line.polyline.material).toBe(lineMaterial)
    expect(volume.polylineVolume.material).toBe(volumeMaterial)
    expect((engine as unknown as { selectedRoadId: string | null }).selectedRoadId).toBeNull()
    expect((engine as unknown as { contextRoadId: string | null }).contextRoadId).toBeNull()
  })
})
