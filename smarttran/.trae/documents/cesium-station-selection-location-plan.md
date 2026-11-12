# Cesium 站点选中与定位修复计划

## Context

当前 Cesium 站点选中通过新增 `highlight:station` 点实体实现；普通站点还带有 `scaleByDistance`，会随相机距离改变屏幕尺寸。站点定位使用固定纬度偏移、固定 heading 和倾斜俯仰，未对准线路方向。此次改造需让站点选中只修改已有对象，确保屏幕像素尺寸稳定，并将站点定位改为业务习惯的俯视线路方向视角。

## 实施方案

1. 在 `src/map3d/entities/stations.ts` 移除普通站 Point 的 `scaleByDistance`，使用固定像素尺寸；保留换乘站现有 model/box 实体。
2. 在 `src/map3d/Map3DEngine.ts` 调整站点选中样式生命周期：普通站只修改原 Point 的颜色/轮廓和小幅 pixelSize；换乘模型修改原 ModelGraphics 的 silhouetteColor/silhouetteSize，程序化 box 修改已有 material/outlineColor。切换或清除时恢复原始属性。移除 `highlight:station` 的创建逻辑，选中操作不增删 Entity 或 Primitive，也不触发相机移动。线路原有选择反馈保持不变。
3. 复用 `getStopFeature`、站点 `lines` 与线路 GeoJSON 几何，计算站点附近线路切向的 Cesium heading。仅更新显式详情对象定位的 `flyToObject` 站点分支：相机以站点为目标采用垂直俯视角，并按线路 heading 对准，不再使用固定纬度偏移。
4. 不修改 `flyToPoint` 契约和附近站点列表定位；该入口本次明确不纳入线路朝向定位范围。
5. 验证普通站、换乘站模型、程序化 box 站点的选中/清除样式均可恢复；整个点击选择过程不增加/删除 Cesium Entity 或 Primitive。

## 关键文件

- `src/map3d/Map3DEngine.ts`：选中样式生命周期、线路方向计算、站点相机定位。
- `src/map3d/entities/stations.ts`：固定像素尺寸的站点基础样式。
- `src/common/types/engine.ts`：附近站点定位的可选业务上下文。
- `src/components/map/MapContainer.vue`：将附近站点身份传递给引擎。

复用 `src/common/data/metroRepository.ts` 的 `getStopPoint`、`getStopFeature`、`allRouteFeatures`，以及站点属性 `MetroStopProps.lines`。无需引入新实体、Primitive 或外部依赖。

## 验证

- 执行 `npm run type-check` 和 `npm run build-only`。
- 浏览器运行 3D 模式，分别点击普通站、换乘站并点击空白清除；核对选中前后 Entity/Primitive 数量不变、尺寸变化幅度有限且相同相机距离下符号像素尺寸稳定。
- 通过详情面板显式定位站点：核对相机垂直俯视、目标站点处于画面焦点、heading 与局部线路走向一致；换乘站重复验证方向选择稳定。附近站点列表定位保持现状，不作为此次验收项。
- 快速连续切换站点/空白，确认普通站点、模型站点和 box 站点高亮边框均恢复，且点击不改变相机；通过浏览器交互观测选中反馈在 100ms 内生效，定位指令在 100ms 内启动（相机动画完整结束时间不作为输入响应延迟）。