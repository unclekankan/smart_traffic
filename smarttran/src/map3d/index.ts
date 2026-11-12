/**
 * map3d 模块出口：Cesium 三维引擎
 * widgets.css 提供 .cesium-widget 的尺寸与交互样式，缺失会导致画布不随容器缩放
 */
import 'cesium/Build/Cesium/Widgets/widgets.css'

export { Map3DEngine } from './Map3DEngine'
export { DEFAULT_ROAD_RENDER_OPTIONS } from './entities/roads'
export type { RoadRenderOptions } from './entities/roads'
export {
  clearStationModelRegistry,
  getStationModelUrl,
  registerStationModel,
  unregisterStationModel,
} from './entities/stations'
