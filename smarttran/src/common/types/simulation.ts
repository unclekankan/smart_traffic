import type { LngLat } from './geo'

export type MetroSimulationPhase = 'idle' | 'preparing' | 'running' | 'paused' | 'completed' | 'error'
export type SimulationModelPhase = 'idle' | 'loading' | 'ready' | 'error'
export type SimulationTilesStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SimulationModelState {
  phase: SimulationModelPhase
  progress: number
  error: string | null
}

export interface MetroSimulationState {
  session: number
  phase: MetroSimulationPhase
  routeId: string | null
  routeName: string | null
  tilesEnabled: boolean
  otherRoutesVisible: boolean
  speedMultiplier: number
  model: SimulationModelState
  tilesStatus: SimulationTilesStatus
  error: string | null
}

export interface SimulationTrackPoint {
  position: LngLat
  distanceM: number
  headingRad: number
}

export interface SimulationSnapshot {
  position: LngLat
  headingRad: number
  progress: number
  elapsedSec: number
}
