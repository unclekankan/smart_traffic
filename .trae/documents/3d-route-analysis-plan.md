# 3D 路径分析实施计划

## Context

当前路线规划状态在 `mapStore` 中由 2D/3D 共享，地图容器也把同一结果回放给两种引擎，不满足严格隔离要求。用户确认本阶段只做高德路线3D展示，使用现有线路分析 API，不考虑地形。API 提供经纬度路线、方案及服务端距离/耗时，不提供高程或障碍物数据；3D 以 Cesium 地表路线表达，不增加虚构的高差/避障能力。

## 实施方案

1. 在 `src/stores/mapStore.ts` 建立 `routeByMode: Record<MapMode, RouteState>`，分别保存起终点、选点目标、策略、结果、选中方案、加载及错误状态。当前模式 getter/action 供面板使用；选点事件和规划请求锁定其引擎模式，使用按模式请求代次丢弃过期响应。两种模式可以独立调用同一无状态 API 客户端，但不得共享业务状态。
2. 在 `src/components/map/MapContainer.vue` 按 `e.mode` 写入路线切片；引擎初始化只回放该模式缓存，监听仅驱动当前引擎。模式切换继续销毁离开模式的引擎实例并在返回时由对应切片完整恢复。调整离开路线面板的取消行为，使其只取消当前模式的选点。
3. 扩展 `src/common/types/engine.ts` 的模式专属路线交互契约。保持 OpenLayers 现有 `renderRoutePlan` 行为不变；3D 使用独立的 Cesium 路径选点、渲染和交互入口，不调用 2D 图层或业务逻辑。
4. 新增 Cesium 专属路线实体渲染模块并集成到 `src/map3d/Map3DEngine.ts`：使用独立 EntityCollection/实体索引渲染 API 分段路线，提供方案切换高亮、起终点与途经/换乘节点标注、相机视角下路线范围定位及实体清理。路线按地表语义渲染，不增加地形采样或高差计算。
5. 在 `src/components/panels/RoutePlanPanel.vue` 读取当前模式路线切片，支持地图选点、API 规划、策略选择、方案切换及服务端距离/耗时展示；保持2D现有表现。此阶段不包含3D顶点编辑、真实障碍物避让或高程统计，避免超出 API 数据能力。
6. 测试覆盖 store 双模式状态与异步隔离、MapContainer 回放/事件按模式隔离，以及 Cesium 路线实体创建、方案高亮、节点标注、清除和销毁。

## 关键现有实现

- API 与返回类型：`src/common/services/transit.ts`、`src/common/types/transit.ts`
- 2D 路线渲染：`src/map2d/layers/transit.ts`、`src/map2d/Map2DEngine.ts`
- Cesium 引擎与地图事件：`src/map3d/Map3DEngine.ts`
- 引擎桥接：`src/components/map/MapContainer.vue`
- 路线 UI：`src/components/panels/RoutePlanPanel.vue`
- 现有桥接测试模式：`src/components/__tests__/MapContainerSelection.spec.ts`

## 验证

- 增加并运行 store、MapContainer、Cesium 路径模块的 Vitest 单测，验证 2D/3D 状态与渲染调用互不交叉。
- 运行 `npm run type-check`、`npm run test:unit`、`git diff --check`。
- 手动运行应用，分别在 2D/3D 选择起终点、请求高德路线、切换方案并核对统计；反复切换模式确认各自路线状态恢复且 Cesium 路线实体无残留。
