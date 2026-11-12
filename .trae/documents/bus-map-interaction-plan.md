# 公交地图交互实施计划

## Context

用户要求公交线路取消选中后立即清除 3D 管道，并统一地图点击查询、线路/站点定位与管道渲染行为，同时保持 2D/3D 地图选择互不干扰。当前 3D 取消管道已有即时实体清理和异步代次保护；2D 有 WMS 空白点击反查，但 3D 尚未接入；公交对象定位分支缺失；异步点击可能乱序覆盖选择。

## Current State Analysis

- `Map3DEngine.selectBusRoute(null)` 先更新请求代次并删除 `bus-route:` 实体，迟到详情响应会被忽略。
- `MapContainer.vue` 把 `selectedBusRoute` 同步到当前引擎；取消操作已有状态到实体的清理链路。
- 2D `Map2DEngine.bindInteractions` 在公交模式、未命中矢量要素时调用 `busApi.pickRoute`；3D `bindPicking` 目前只拾取 Cesium entities。
- store 的 `selectedByMode` 用于引擎选择回放，但共享 `selected` 供属性面板使用；`focus` 目前也会更新当前模式选择。
- `PropertyPanel.vue` 的定位动作通过 `focusSeq` 调用 `flyToObject`；两引擎对 `busRoute`、`busStop` 缺少完整定位分支。

## Proposed Changes

1. `smarttran/src/map3d/Map3DEngine.ts`
   - 扩展 Cesium 点击拾取：保留选点模式、已有实体优先级；只有公交网络模式下点击未命中对象且公交线路图层可见时，转换点击位置为经纬度并调用现有 `busApi.pickRoute`，命中时发出 `busRoute` 选择事件。
   - 为点击反查增加递增请求序号；任何新地图点击（包含空结果）使旧请求失效，只允许最新响应更新选择。
   - 保持 `selectBusRoute(null)` 现有同步移除顺序和迟到请求保护，补测试证明取消调用后立即没有管道实体。
   - 补 `flyToObject` 对公交线路和公交站点的定位；线路定位需触发对应公交线路选择，使单线管道在 3D 显示。站点定位需保持所属线路选择并定位到站点坐标。

2. `smarttran/src/map2d/Map2DEngine.ts`
   - 为现有 `pickBusRouteAt` 增加相同的请求序号保护。无命中也必须使此前进行中的请求失效；失败仍保持静默。
   - 补齐公交线路及公交站点 `flyToObject` 分支，并遵循与 3D 一致的线路选择、站点定位语义。

3. `smarttran/src/stores/mapStore.ts` 与 `smarttran/src/components/map/MapContainer.vue`
   - 让引擎选择事件继续按事件来源模式只更新对应 `selectedByMode`，共享 `selected` 继续驱动属性面板。
   - 校正面板 `focus` 与模式切换同步，避免定位其他模式的对象时写入或残留为当前地图选择；定位请求由当前模式引擎处理。
   - 公交线路/站点 focus 应更新业务详情和线路关系，但不得因定位站点清除所属线路选择/管道。

4. 测试
   - 扩展 `smarttran/src/map3d/__tests__/busSelection.spec.ts`：取消立即清理、迟到详情不会复建；线路与站点定位；点击公交 WMS 命中、非公交模式及实体命中不请求、乱序响应只接受最新请求。
   - 扩展 `smarttran/src/map2d/__tests__/selection.spec.ts`：点击查询乱序与空结果失效、公交对象定位语义。
   - 扩展 `smarttran/src/components/__tests__/MapContainerSelection.spec.ts`：模式切换与 focus 不污染另一模式的地图选择，属性详情和当前模式保持一致。

## Assumptions & Decisions

- “地图任意位置点击查询公交线路”仅在公交网络模式、公交线路图层可见、且点击未命中优先级更高的对象/选点工具时生效，沿用现有 2D 交互语义。
- 复用现有 `GET /api/bus/pick` 及 `busApi.pickRoute(lon, lat, tolerance)`，不新增后端接口。
- 公交站点定位使用站点自身坐标；若数据模型提供所属线路 ID，则保持/选中该线路以保证管道可见，否则不凭站点名称猜测线路。
- 60fps 是性能目标，不可由单元测试证明；本次避免全量实体化，点击反查与单线路详情仍按需请求，并以浏览器交互验证无明显掉帧/残留。

## Verification

- 运行公交选择、2D 选择、MapContainer 选择相关 Vitest。
- 运行 `npm run type-check`、完整 `npm run test:unit -- --run`、`git diff --check`。
- 启动应用与 GeoServer，在 2D/3D 分别验证：点击公交 WMS 查询并选中、连续点击乱序、取消后管道立即消失、定位线路生成/定位管道、定位点位保留线路选择，切换地图模式后各自状态恢复且互不串扰。
