import * as Cesium from 'cesium'

import type { LngLat } from '@/common/types/geo'
import type { SimulationSnapshot, SimulationTrackPoint } from '@/common/types/simulation'

const MIN_SEGMENT_METERS = 0.5

function validPoint(point: LngLat | undefined): point is LngLat {
  return Boolean(point && Number.isFinite(point[0]) && Number.isFinite(point[1]))
}

function dedupePath(path: LngLat[]): LngLat[] {
  const result: LngLat[] = []
  for (const point of path) {
    if (!validPoint(point)) continue
    const previous = result[result.length - 1]
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) result.push(point)
  }
  return result
}

export class RouteTrack {
  readonly points: SimulationTrackPoint[]
  readonly totalDistanceM: number

  constructor(path: LngLat[]) {
    const cleanPath = dedupePath(path)
    const points: SimulationTrackPoint[] = []
    let distanceM = 0

    cleanPath.forEach((position, index) => {
      if (index > 0) {
        const previous = cleanPath[index - 1]!
        const geodesic = new Cesium.EllipsoidGeodesic(
          Cesium.Cartographic.fromDegrees(previous[0], previous[1]),
          Cesium.Cartographic.fromDegrees(position[0], position[1]),
        )
        const segment = geodesic.surfaceDistance
        if (Number.isFinite(segment) && segment >= MIN_SEGMENT_METERS) distanceM += segment
      }
      const previous = cleanPath[Math.max(0, index - 1)] ?? position
      const next = cleanPath[Math.min(cleanPath.length - 1, index + 1)] ?? position
      points.push({ position, distanceM, headingRad: headingBetween(previous, next, position) })
    })

    this.points = points
    this.totalDistanceM = distanceM
  }

  get start(): LngLat | null {
    return this.points[0]?.position ?? null
  }

  get end(): LngLat | null {
    return this.points[this.points.length - 1]?.position ?? null
  }

  sample(distanceM: number): SimulationSnapshot | null {
    if (!this.points.length) return null
    const distance = Math.min(this.totalDistanceM, Math.max(0, distanceM))
    if (this.points.length === 1 || this.totalDistanceM === 0) {
      return { position: this.points[0]!.position, headingRad: this.points[0]!.headingRad, progress: 1, elapsedSec: 0 }
    }

    let right = this.points.findIndex((point) => point.distanceM >= distance)
    if (right <= 0) right = 1
    const left = this.points[right - 1]!
    const upper = this.points[right]!
    const span = upper.distanceM - left.distanceM
    const ratio = span > 0 ? (distance - left.distanceM) / span : 0
    return {
      position: interpolate(left.position, upper.position, ratio),
      headingRad: interpolateAngle(left.headingRad, upper.headingRad, ratio),
      progress: this.totalDistanceM > 0 ? distance / this.totalDistanceM : 1,
      elapsedSec: 0,
    }
  }
}

function interpolate(a: LngLat, b: LngLat, ratio: number): LngLat {
  const start = Cesium.Cartographic.fromDegrees(a[0], a[1])
  const end = Cesium.Cartographic.fromDegrees(b[0], b[1])
  const geodesic = new Cesium.EllipsoidGeodesic(start, end)
  const cartographic = geodesic.interpolateUsingFraction(Math.min(1, Math.max(0, ratio)), new Cesium.Cartographic())
  return [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude)]
}

function headingBetween(previous: LngLat, next: LngLat, fallback: LngLat): number {
  const start = Cesium.Cartographic.fromDegrees(previous[0], previous[1])
  const end = Cesium.Cartographic.fromDegrees(next[0], next[1])
  if (previous[0] === fallback[0] && previous[1] === fallback[1] && next[0] === fallback[0] && next[1] === fallback[1]) return 0
  const geodesic = new Cesium.EllipsoidGeodesic(start, end)
  return geodesic.startHeading
}

function interpolateAngle(a: number, b: number, ratio: number): number {
  let delta = b - a
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return a + delta * ratio
}
