/**
 * 三维车站实体
 *
 * - 普通车站：点符号 + 注记
 * - 换乘车站：
 *   1) 若通过 registerStationModel(stopId, modelUrl) 注册了 3D 模型资源（glTF/glb），
 *      则加载该模型（model: { uri }）替代程序化体块，后续只需传入模型文件即可，
 *      无需修改核心渲染逻辑。
 *   2) 未注册模型时，渲染为 LOD-2 体块（顶棚 / 站体 / 站台三段盒子）作为占位。
 */

import * as Cesium from 'cesium'

import { PALETTE } from '@/common/constants/colors'
import { MODEL_COLORS } from '../config/viewer'
import type { GeoJSONFeature } from '@/common/types/geo'
import type { MetroStopProps } from '@/common/types/metro'

const ACCENT = Cesium.Color.fromCssColorString(PALETTE.accent)
const ACCENT_LIGHT = Cesium.Color.fromCssColorString(PALETTE.accentLight)

/* ---------------- 3D 模型导入接口（换乘站） ---------------- */

/**
 * 换乘站 3D 模型注册表：stop_id → 模型资源 URL（.gltf / .glb）。
 * 外部只需调用 registerStationModel 传入模型文件地址，createStationEntities
 * 会自动用 model entity 替换程序化体块，无需改动核心渲染逻辑。
 */
const stationModelRegistry = new Map<string, string>()

/** 注册 / 更新指定换乘站的 3D 模型资源 */
export function registerStationModel(stopId: string, modelUrl: string): void {
  stationModelRegistry.set(stopId, modelUrl)
}

/** 注销指定换乘站的 3D 模型（回退为程序化体块） */
export function unregisterStationModel(stopId: string): void {
  stationModelRegistry.delete(stopId)
}

/** 清空全部模型注册 */
export function clearStationModelRegistry(): void {
  stationModelRegistry.clear()
}

/** 查询指定换乘站是否已注册模型资源 */
export function getStationModelUrl(stopId: string): string | undefined {
  return stationModelRegistry.get(stopId)
}

/** 按朝向构造实体姿态（heading 单位：度，顺时针） */
function orientedPosition(lon: number, lat: number, height: number, headingDeg: number) {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height)
  const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0)
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr)
  return { position, orientation }
}

interface BoxPart {
  /** 东西向长度（m） */
  length: number
  /** 南北向宽度（m） */
  width: number
  /** 高度（m） */
  height: number
  /** 底部离地高度（m） */
  bottom: number
  color: Cesium.Color
}

/** LOD-2 简化体块：站台 → 站体 → 顶棚 */
const LOD2_PARTS: BoxPart[] = [
  { length: 46, width: 13, height: 0.6, bottom: 0.2, color: MODEL_COLORS.platform },
  { length: 32, width: 8, height: 6.4, bottom: 0.8, color: MODEL_COLORS.core },
  { length: 58, width: 24, height: 0.8, bottom: 8.2, color: MODEL_COLORS.canopy },
]

function addLabel(
  container: Cesium.EntityCollection,
  bizId: string,
  text: string,
  lon: number,
  lat: number,
  height: number,
  emphasized: boolean,
): void {
  container.add({
    id: `station:${bizId}:label`,
    position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    label: {
      text,
      font: `${emphasized ? 600 : 500} 13px "PingFang SC", "Microsoft YaHei", sans-serif`,
      fillColor: emphasized ? ACCENT_LIGHT : Cesium.Color.fromCssColorString(PALETTE.textPrimary),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0A101C').withAlpha(0.85),
      backgroundPadding: new Cesium.Cartesian2(8, 5),
      pixelOffset: new Cesium.Cartesian2(0, -18),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000),
    },
  })
}

/** 创建单个车站实体组 */
export function createStationEntities(
  container: Cesium.EntityCollection,
  feature: { properties: MetroStopProps; geometry: { coordinates: [number, number] } },
): Cesium.Entity[] {
  const s = feature.properties
  const [lon, lat] = feature.geometry.coordinates
  const created: Cesium.Entity[] = []
  const isTransfer = s.line_count >= 2

  if (isTransfer) {
    const modelUrl = getStationModelUrl(s.stop_id)
    if (modelUrl) {
      // 已注册 3D 模型：直接加载 glTF/glb，替代程序化体块
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0)
      created.push(
        container.add({
          id: `station:${s.stop_id}:model`,
          position,
          model: {
            uri: modelUrl,
            scale: 1,
            minimumPixelSize: 64,
            maximumScale: 20000,
            runAnimations: false,
          },
        }),
      )
    } else {
      // 未注册模型：LOD-2 体块占位（同一站点的体块 id 必须唯一，否则 EntityCollection.add 抛 DeveloperError）
      const heading = 0
      LOD2_PARTS.forEach((part, index) => {
        const { position, orientation } = orientedPosition(lon, lat, part.bottom + part.height / 2, heading)
        created.push(
          container.add({
            id: `station:${s.stop_id}:part:${index}`,
            position,
            orientation,
            box: {
              dimensions: new Cesium.Cartesian3(part.length, part.width, part.height),
              material: new Cesium.ColorMaterialProperty(part.color.withAlpha(0.92)),
              outline: true,
              outlineColor: ACCENT.withAlpha(0.55),
            },
          }),
        )
      })
    }
    addLabel(container, s.stop_id, `${s.stop_cn}（换乘）`, lon, lat, 14, true)
  } else {
    created.push(
      container.add({
        id: `station:${s.stop_id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 1),
        point: {
          pixelSize: 11,
          color: Cesium.Color.fromCssColorString('#0E1626'),
          outlineColor: ACCENT,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    )
    addLabel(container, s.stop_id, s.stop_cn, lon, lat, 3, false)
  }

  return created
}

/** 创建全部车站实体 */
export function createAllStations(
  container: Cesium.EntityCollection,
  stationFeatures: { features: GeoJSONFeature<MetroStopProps>[] },
): void {
  for (const feature of stationFeatures.features) {
    createStationEntities(container, {
      properties: feature.properties,
      geometry: { coordinates: feature.geometry.coordinates as [number, number] },
    })
  }
}

/** 清除车站实体 */
export function removeStations(container: Cesium.EntityCollection): void {
  container.values
    .filter((e) => typeof e.id === 'string' && e.id.startsWith('station:'))
    .forEach((e) => container.remove(e))
}
