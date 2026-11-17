# 3D 地铁线路车辆模拟实施计划

## Context

当前工作台以 OpenLayers/Cesium 双引擎分别承载 2D/3D。3D 已具备地铁线路实体、线路选择、相机飞行和统一销毁流程，但没有车辆动画、相机输入锁、3D Tiles 生命周期或模拟控制面板。本需求只增加 3D 地铁线路模拟，不修改任何 2D 渲染与业务逻辑。

已确认资源：`public/model/subway.glb`、`public/3dtiles/tileset.json`。已确认产品行为：相机由程序跟随车辆但禁止用户平移/旋转/缩放；车辆到终点后停止，手动结束模拟才解除锁定。3D Tiles 默认关闭；其他线路默认关闭并真实销毁其实体，开启时按需重建，结束模拟后恢复完整线路集合。

## 1. 增加 3D 专属状态与接口

- 在 `src/common/types/simulation.ts` 定义模拟阶段、模型加载进度、瓦片状态和引擎回调 DTO，不引用 Cesium 类型。
- 在 `src/stores/mapStore.ts` 增加独立的 `simulation3d` 状态：当前线路、会话序号、启动/停止序号、运行/暂停/完成/错误状态、模型下载进度、3D Tiles 与其他线路开关。
- 启动仅允许 `mode === '3d'`、`networkMode === 'metro'` 且目标为有效地铁路线。每次启动默认关闭其他线路，生成新 session。
- `setMode` 离开 3D、`setNetworkMode` 切到公交、选择另一条线路时先使旧 session 失效并停止模拟；旧异步回调不得写入新状态。
- 在 `src/common/types/engine.ts` 只增加可选的 3D 模拟方法，2D 引擎无需实现。

## 2. 实现独立的 3D 模拟控制器

新增 `src/map3d/simulation/MetroSimulationController.ts`，集中管理本次模拟的模型、动画监听、相机锁、飞行、3D Tiles 和异步 generation，退出与引擎销毁统一走幂等 `destroy/stop`。

- 从 `metroRepository.getRoutePath()` 获取目标线路坐标；无效或不足两个点时显示错误，不启动动画。
- 启动后保存 `ScreenSpaceCameraController` 全部输入开关，关闭平移、旋转、缩放、倾斜和注视；平滑飞到线路起点附近，飞行完成后再次应用锁定。
- 使用 `camera.lookAt`/`HeadingPitchRange` 让相机跟随车辆；暂停时车辆与相机一起停住。结束或销毁时先恢复世界坐标变换，再逐项恢复原始输入开关。
- 模拟期间屏蔽引擎的视角复位、`flyToObject`、`flyToPoint` 和路线规划自动飞行，避免外部命令绕过锁定；切换模式仍允许，但会先停止模拟。
- 默认匀速沿线路运行，到终点进入 `completed`，不自动循环；终点仍保持视角锁定，直到用户结束模拟。

新增 `src/map3d/simulation/RouteTrack.ts`：将经纬度路径编译为累计测地距离，按距离采样位置和 heading，处理重复点、起终点夹取及跨段插值，便于独立测试。

新增 `src/map3d/simulation/SimulationModelLoader.ts`：

- 使用可取消的 `fetch` 下载 `/model/subway.glb`，通过响应流报告真实已下载字节和有 `Content-Length` 时的百分比；无长度时显示不确定进度，不伪造百分比。
- 用 `Cesium.Model.fromGltfAsync` 准备模型，区分“下载中”和“模型准备中”，捕获 HTTP、流读取、GLB 解析及运行时错误。
- 停止后 abort 下载；迟到的模型不得加入场景并应立即销毁；Blob URL、primitive 和监听均成对释放。

3D Tiles 由控制器按需调用 `Cesium3DTileset.fromUrl('/3dtiles/tileset.json')` 加载：打开时显示加载状态，关闭时移除并销毁本次 tileset；结束模拟时统一清理；加载中停止的迟到结果直接销毁，瓦片错误在面板显示且不伪造全局百分比。

## 3. 接入 Map3DEngine 和线路资源隔离

在 `src/map3d/Map3DEngine.ts` 持有唯一的 `MetroSimulationController`，暴露可选启动、停止、暂停、瓦片和其他线路开关方法，并确保 `destroy()` 首先停止模拟。

- 在 `src/map3d/entities/roads.ts` 增加按线路 ID 删除/补缺重建的辅助逻辑，覆盖 `road:`、`road:<id>:segment:`、`road-volume:`，不能使用会连同当前线路一起删除的 `removeRoads()`。
- 其他线路关闭时，从 `viewer.entities` 和 `entityIndex` 同步移除非当前线路并解除高亮引用；开启时利用 `allRouteFeatures()` 与 `createRoadEntities()` 补缺，避免重复 ID。
- 结束模拟时恢复完整线路集合，再复用 `applyNetworkVisibility()` 和既有高亮逻辑；不修改车站、路线规划、覆盖分析、测量或公交资源。
- 模型资源加载失败时清理半成品并恢复相机/线路，保留错误面板供重试或结束。

## 4. 增加入口和右上悬浮控制面板

- 在 `src/components/panels/PropertyPanel.vue` 的地铁线路操作区增加“开始模拟”，仅 3D 地铁线路显示；点击显式传入当前线路 ID。模拟中禁用普通定位按钮，2D 不出现该入口。
- 新增 `src/components/panels/MetroSimulationPanel.vue`，在 `src/views/WorkbenchView.vue` 的 `map-stage` 挂载，定位于右上工具栏下方，避免遮挡线路主体。
- 面板显示当前线路、模型进度/准备状态、错误；提供 3D Tiles 开关、其他线路开关、车辆暂停/继续、结束模拟。加载期间禁止重复启动，完成态允许重新模拟或结束。
- 在 `src/components/map/MapToolbar.vue` 模拟期间禁用“视角复位”，保留模式切换和全屏。
- 在 `src/components/map/MapContainer.vue` 监听 3D 模拟启动/停止和开关状态，只对 `engine.mode === '3d'` 调用模拟接口；桥接进度、完成和异常回调，并以 engine generation + session 丢弃过期异步结果。切回 3D 不自动恢复旧模拟。

## 5. 验证

新增或增量更新 Vitest：

- `RouteTrack`：起终点、半距离、多段路径、重复/非法点、heading 和到终点停止。
- 模型加载：真实进度、无 Content-Length、HTTP/解析异常、abort、迟到模型销毁、Blob URL 释放。
- Controller/引擎：相机输入锁定与恢复、跟随与暂停、其他线路真实删除/重建、3D Tiles 开关与销毁、结束/切模式/引擎 destroy 幂等清理。
- Store：2D/公交不能启动，session 隔离，暂停/完成/错误状态及切模式清理。
- `MapContainerSelection.spec.ts` 等现有 mock 增量补模拟状态，验证 2D 引擎不接收任何模拟调用，旧事件不跨会话写回。

执行 `npm run type-check`、全量 `npm run test:unit -- --run --no-file-parallelism --maxWorkers=1`、`npm run build` 和 `git diff --check`。随后启动前端进行浏览器冒烟：选择线路开始模拟，确认 glb 加载进度、跟随锁定、暂停/继续、两个资源开关、终点完成及结束恢复；再验证模拟中切 2D 后无模拟面板和资源残留，2D 全程不请求车辆模型或模拟瓦片。
