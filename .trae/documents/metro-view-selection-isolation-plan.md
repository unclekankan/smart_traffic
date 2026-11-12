# 地铁线路视图选中状态隔离

## Context

当前 `mapStore.selected` 同时承担业务详情对象和地图引擎高亮状态。`MapContainer` 在任一模式点选后写回这份共享状态，并在创建另一模式引擎时将其回放，导致 2D/3D 选择互相覆盖。目标是让两种视图各自保留选中对象和线路高亮，模式切换不复制选择；业务面板仍可显示最近一次的业务对象。

## 推荐实现

1. 在 `mapStore.ts` 增加 `selectedByMode: Record<MapMode, SelectedObject | null>`，区分业务详情 `selected` 与地图视图选择。新增按模式更新视图选择的 action；引擎点选同时更新对应模式槽位和现有业务 `selected`，不更新另一槽位。
2. `MapContainer.vue` 创建引擎时仅回放 `selectedByMode[mode]`。引擎 `select` 事件按绑定引擎的 `mode` 写入对应槽位。将选择 watcher 改为只观察当前模式槽位并下发当前引擎，切换时通过初始化回放恢复目标模式自己的高亮。保留现有异步初始化 generation 防护。
3. 保持 `contextMetroRoute` 作为站点详情的独立上下文高亮，通过 `setContextRoad` 单独回放；不得将其复制进任一视图选择槽位。站点返回来源线路时，仍更新业务选择，并只更新当前模式的视图选择。
4. 盘点 `focus()`、`focusNearbyStop()`、`runStationBuffer()`、公交线路/站点选择、`backToMetroRoute()` 等程序化选择入口。凡是会在当前地图表达对象选中/高亮的入口，统一更新当前模式槽位；仅坐标定位而非对象选择的操作保持原行为。网络切换按现有语义清理业务选择及两种模式中与旧网络不兼容的选择，模式切换本身不清理槽位。
5. `PropertyPanel` 和其他读取 `store.selected` 的消费者继续使用业务详情状态，避免面板因视图切换而跳变；地图渲染只读取视图槽位。无需修改 `MapEngine` 契约或引擎内部独立的渲染状态。

## 关键文件

- `smarttran/src/stores/mapStore.ts`：增加按模式选择状态与统一更新入口，迁移程序化选择及清理语义。
- `smarttran/src/components/map/MapContainer.vue`：引擎初始化回放、当前模式状态 watcher、事件回写。
- `smarttran/src/components/panels/PropertyPanel.vue`：核对站点返回线路流程，确保通过 store action 更新当前模式选择。
- `smarttran/src/components/__tests__/MapContainerSelection.spec.ts`：替换原共享选择回放断言，新增模式隔离和往返切换测试。
- `smarttran/src/stores/__tests__`（如已有 store 测试位置则沿用）：覆盖 store action 的模式槽位与业务状态行为；若无合适测试文件则在现有测试组织中放置。

## 验证

- 单元测试：模拟 2D 选线路 A、3D 选线路 B，反复切换并断言每次新引擎只收到自身模式选择，且另一槽位未变；验证引擎点击只写入对应模式、程序化选择只更新当前模式、站点上下文不被当作视图选择、网络切换清理行为正确。
- 运行 `npm run test:unit -- --run`、`npm run type-check`、`git diff --check`。
- 若 Playwright 浏览器已安装，再运行相关 E2E；否则明确报告环境阻塞，不将其记为交互验证通过。
