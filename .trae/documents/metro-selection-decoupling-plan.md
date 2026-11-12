# 地铁线路选择逻辑解耦计划

## Context

当前业务选中状态由 Pinia 保存，经 `MapContainer` 桥接至当前地图引擎；2D 与 3D 的选中渲染实现本身不同，但 2D 选中 ID 保存在模块级 `styleState`，而 3D 直接管理 Cesium 实体材质快照。销毁/重建、上下文线路与普通选中之间的生命周期不一致，可能造成高亮残留或状态恢复异常。

目标是让 2D/3D 的拾取与渲染状态各自归属其引擎，同时保留共享业务 DTO、Pinia 状态和视图切换时的业务状态回放，不让一种视图的渲染状态污染另一种视图。

## 推荐方案

1. **明确共享边界**
   - 保留 `SelectedObject`、`MapEngine` 事件契约和 Pinia 中的业务选择状态。
   - 保留 `MapContainer` 对引擎 `select` 事件及 `store.selected` 的桥接职责。
   - 2D 样式状态仅由 2D 引擎维护；Cesium 材质/属性快照仅由 3D 引擎维护。避免把渲染属性放进 store 或建立跨引擎样式状态。

2. **隔离并清理 2D 选择生命周期**
   - 在 `Map2DEngine` 内统一处理选中状态更新及清除：同步 2D 私有 `styleState.selectedId`、站点缓冲区选中态和相关图层重绘。
   - `destroy()` 时清除 2D 私有选中样式状态及其关联的站点缓冲区选择，避免模块级值残留到后续实例。
   - 保持 2D 的 `forEachFeatureAtPixel` 与公交线路反查流程只在 2D 引擎中。

3. **隔离并清理 3D 选择生命周期**
   - 保留 Cesium `drillPick`、`road-volume` 到业务线路 ID 的归一化、实体高亮及快照恢复都在 `Map3DEngine` 内。
   - 将选择切换、取消、上下文线路恢复及销毁顺序作为单一 3D 生命周期处理，保证各实体材质快照准确对应 `polyline` 或 `polylineVolume`，避免将高亮材质再次快照为普通态。
   - 保持 3D 自身的拾取优先级和站点/线路交互，不引入 2D 样式状态。

4. **保持容器桥接精简且可预测**
   - `MapContainer` 继续负责当前引擎创建/销毁、事件绑定和业务状态回放，不加入地图库专属拾取或高亮分支。
   - 视图切换保留 `selected`、`contextMetroRoute` 和路线方案选中 ID；新引擎按自身实现重建高亮。网络切换仍按现有 store 语义清理无关业务选择。
   - 只在测试证明存在重复/过期同步时调整回放顺序，避免无必要改变用户交互语义。

5. **增加分层测试**
   - Vitest 引擎单测分别覆盖 2D 点击命中/空点清选、选中对象切换、取消、销毁后无残留；3D 覆盖圆管与贴地线路命中归一化、选择/取消时各自材质恢复、上下文线路切换以及销毁清理。
   - Vue Test Utils 桥接测试 mock 两种引擎，验证 `select` 回写 store、store 变更只下发当前引擎，以及 2D↔3D 重建时业务选择和上下文状态回放正确。
   - 保留现有 Playwright 基础 E2E，并补充可稳定执行的视图切换与选择面板路径；避免将外部瓦片成功作为唯一断言。

## 关键文件

- `smarttran/src/common/types/engine.ts`：共享业务选择 DTO 与引擎契约，原则上只在测试暴露的契约问题确有需要时调整。
- `smarttran/src/stores/mapStore.ts`：跨视图业务选择与网络切换清理语义。
- `smarttran/src/components/map/MapContainer.vue`：引擎生命周期、事件桥接和状态回放。
- `smarttran/src/map2d/Map2DEngine.ts`、`smarttran/src/map2d/styles/shared.ts`：2D 私有选中状态、拾取及销毁清理。
- `smarttran/src/map3d/Map3DEngine.ts`：3D 拾取、材质快照、高亮切换与销毁清理。
- `smarttran/src/map2d/**/__tests__/**`、`smarttran/src/map3d/**/__tests__/**`、`smarttran/src/components/map/__tests__/**`：新增 Vitest 回归测试，按仓库现有目录约定落位。

## 验证

1. 运行 `npm run test:unit -- --run`，确认新增 2D/3D 引擎测试及容器桥接测试通过。
2. 运行 `npm run type-check` 与 `git diff --check`。
3. 运行 `npm run test:e2e`，验证选择、2D↔3D 切换后属性面板与高亮保持、取消选择后无残留。
4. 若真实 Cesium WebGL/外部瓦片环境导致 E2E 不稳定，明确区分单元测试结论与浏览器实测结果，不把 mock 测试描述为真实渲染验证。
