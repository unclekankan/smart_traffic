import * as Cesium from 'cesium'

import { PALETTE } from '@/common/constants/colors'
import type { LngLat } from '@/common/types/geo'
import type { TransitAlternative, TransitPlanResult } from '@/common/types/transit'

const PREFIX = 'transit-plan:'
const ACTIVE = Cesium.Color.fromCssColorString(PALETTE.accentLight)
const WALK = Cesium.Color.fromCssColorString('#F0B429')
const TRANSIT = Cesium.Color.fromCssColorString(PALETTE.accent)
const MUTED = Cesium.Color.fromCssColorString('#738092').withAlpha(0.28)

export function removeRoutePlanEntities(collection: Cesium.EntityCollection): void {
  collection.values
    .filter((entity) => typeof entity.id === 'string' && entity.id.startsWith(PREFIX))
    .forEach((entity) => collection.remove(entity))
}

export function createRoutePlanEntities(
  collection: Cesium.EntityCollection,
  result: TransitPlanResult | null,
  selectedId: string | null,
  origin: LngLat | null,
  destination: LngLat | null,
): Cesium.Entity[] {
  removeRoutePlanEntities(collection)
  if (!result) return createEndpointEntities(collection, origin, destination)
  const created: Cesium.Entity[] = []
  const alternatives = result.alternatives
  for (const alternative of alternatives) {
    const active = alternative.id === selectedId || (!selectedId && alternative === alternatives[0])
    alternative.segments.forEach((segment, segmentIndex) => {
      if (segment.polyline.length > 1) {
        created.push(collection.add({
          id: `${PREFIX}route:${alternative.id}:${segmentIndex}`,
          polyline: {
            positions: segment.polyline.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
            width: active ? 7 : 4,
            material: (active ? (segment.type === 'walk' ? WALK : ACTIVE) : MUTED),
            clampToGround: true,
          },
        }))
      }
      segment.stops.forEach((stop, stopIndex) => {
        created.push(collection.add({
          id: `${PREFIX}node:${alternative.id}:${segmentIndex}:${stopIndex}`,
          position: Cesium.Cartesian3.fromDegrees(stop.lng, stop.lat, 2),
          point: {
            pixelSize: active ? 8 : 5,
            color: active ? TRANSIT : MUTED,
            outlineColor: Cesium.Color.WHITE.withAlpha(active ? 0.9 : 0.25),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: stop.name,
            font: '12px sans-serif',
            fillColor: active ? Cesium.Color.WHITE : MUTED,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }))
      })
    })
  }
  created.push(...createEndpointEntities(collection, origin ?? result.origin, destination ?? result.destination))
  return created
}

function createEndpointEntities(
  collection: Cesium.EntityCollection,
  origin: LngLat | null,
  destination: LngLat | null,
): Cesium.Entity[] {
  const created: Cesium.Entity[] = []
  for (const [name, point, color] of [
    ['起', origin, Cesium.Color.fromCssColorString('#2E7D32')],
    ['终', destination, Cesium.Color.fromCssColorString('#D32F2F')],
  ] as const) {
    if (!point) continue
    created.push(collection.add({
      id: `${PREFIX}endpoint:${name}`,
      position: Cesium.Cartesian3.fromDegrees(point[0], point[1], 3),
      point: { pixelSize: 13, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: name, font: 'bold 12px sans-serif', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL, pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }))
  }
  return created
}

export function routePlanPositions(alternative: TransitAlternative): Cesium.Cartesian3[] {
  return alternative.segments.flatMap((segment) => segment.polyline.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)))
}
