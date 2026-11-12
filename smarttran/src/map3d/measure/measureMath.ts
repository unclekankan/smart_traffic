/**
 * 3D 测量数学（Cesium 原生测地计算）
 *
 * - 距离：Cesium.EllipsoidGeodesic 的 WGS84 椭球面测地距离
 * - 面积：以多边形质心建立 ENU 局部切平面（Cesium.Transforms），
 *   投影后用鞋带公式求面积；城市尺度下与 2D 的 ol/sphere 结果一致
 *
 * 纯函数实现，便于单测验证与 2D 结果的一致性。
 */

import * as Cesium from 'cesium'

import type { LngLat } from '@/common/types/geo'
import type { MeasureResult } from '@/common/types/measure'

const WGS84 = Cesium.Ellipsoid.WGS84

/** 两点间 WGS84 椭球面测地距离（米） */
export function geodesicDistance(from: LngLat, to: LngLat): number {
  const start = Cesium.Cartographic.fromDegrees(from[0], from[1])
  const end = Cesium.Cartographic.fromDegrees(to[0], to[1])
  return new Cesium.EllipsoidGeodesic(start, end, WGS84).surfaceDistance
}

/** 距离测量结果（折线各段 + 总长） */
export function computeDistanceResult(points: LngLat[]): MeasureResult {
  const segments: number[] = []
  for (let i = 1; i < points.length; i++) {
    segments.push(geodesicDistance(points[i - 1]!, points[i]!))
  }
  return {
    mode: 'distance',
    value: segments.reduce((sum, segment) => sum + segment, 0),
    segments,
    perimeter: 0,
    vertexCount: points.length,
    points: points.map((point) => [...point] as LngLat),
  }
}

/** 面积测量结果（面积 + 闭合周长） */
export function computeAreaResult(points: LngLat[]): MeasureResult {
  if (points.length < 3) {
    return {
      mode: 'area',
      value: 0,
      segments: [],
      perimeter: 0,
      vertexCount: points.length,
      points: points.map((point) => [...point] as LngLat),
    }
  }

  let lonSum = 0
  let latSum = 0
  for (const [lon, lat] of points) {
    lonSum += lon
    latSum += lat
  }
  const origin = Cesium.Cartesian3.fromDegrees(lonSum / points.length, latSum / points.length)
  const toLocal = Cesium.Matrix4.inverse(
    Cesium.Transforms.eastNorthUpToFixedFrame(origin),
    new Cesium.Matrix4(),
  )
  const projected = points.map(([lon, lat]) =>
    Cesium.Matrix4.multiplyByPoint(
      toLocal,
      Cesium.Cartesian3.fromDegrees(lon, lat),
      new Cesium.Cartesian3(),
    ),
  )

  let twiceArea = 0
  for (let i = 0; i < projected.length; i++) {
    const current = projected[i]!
    const next = projected[(i + 1) % projected.length]!
    twiceArea += current.x * next.y - next.x * current.y
  }

  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    perimeter += geodesicDistance(points[i]!, points[(i + 1) % points.length]!)
  }

  return {
    mode: 'area',
    value: Math.abs(twiceArea) / 2,
    segments: [],
    perimeter,
    vertexCount: points.length,
    points: points.map((point) => [...point] as LngLat),
  }
}

/** 按模式计算（绘制中与完成后共用） */
export function computeMeasure3D(mode: 'distance' | 'area', points: LngLat[]): MeasureResult {
  return mode === 'area' ? computeAreaResult(points) : computeDistanceResult(points)
}
