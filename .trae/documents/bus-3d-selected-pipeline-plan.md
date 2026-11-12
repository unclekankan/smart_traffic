# 3D 选中公交线路管道实施计划

## Context

3D 模式需要在公交线路被选中时呈现立体管道，但不应将全市公交线路全部转成 Cesium 实体造成性能负担。全量公交仍由 WMS 承担；复用现有 `getRouteDetail(id)` 按需获取单条公交线路 GeoJSON，选中时创建管道，取消或替换选择时及时清理。

## 实施方案

1. 在 `src/map3d/entities/roads.ts` 增加公交专用管道创建和清理逻辑，复用坐标转换与现有 polylineVolume 截面构造。仅处理有效 LineString/MultiLineString 路径，公交实体采用独立 ID 前缀与公交专属颜色/管径，不进入地铁道路索引，也不被地铁 `removeRoads` 清理。
2. 在 `src/map3d/Map3DEngine.ts` 实现 `selectBusRoute(id)`：选择变化时使旧请求失效、先清理现有公交管道，再通过 `getRouteDetail(id)` 按需获取详情。响应返回后校验请求代次及当前 ID，仅将仍有效的选择创建为实体。取消选择、替换线路、引擎销毁均清理公交实体；失败时不留下旧管道。
3. 将公交管道可见性与公交网络模式及道路图层开关同步，但不因切换模式重新请求详情。全量公交仍不创建 Cesium 实体；不添加公交站点/站名实体。
4. 检查 `MapContainer` 现有 `selectedBusRoute` 初始化回放和 watch 桥接，保持共享业务选择流不变；仅在必要时修正桥接，不把公交状态混入地铁线路选择/高亮机制。
5. 增加实体工厂及 3D 引擎测试，覆盖有效/无效几何、选中后加载、取消和销毁清理、快速更换线路的迟到响应、网络/图层可见性，并确认公交实体与地铁实体隔离。

## Critical Files

- `smarttran/src/map3d/entities/roads.ts`
- `smarttran/src/map3d/Map3DEngine.ts`
- `smarttran/src/components/map/MapContainer.vue`（仅在现有桥接不足时）
- `smarttran/src/map3d/__tests__/selection.spec.ts` 或新增同目录公交测试
- `smarttran/src/common/data/busRepository.ts`（复用既有 `getRouteDetail`，预计不需修改）

## Verification

- 运行 3D 引擎及实体相关单测，并执行完整 `npm run test:unit -- --run`。
- 执行 `npm run type-check`、`npm run build-only` 与 `git diff --check`。
- 手动验证：3D 公交模式下切换选中线路时仅当前线路出现管道；清除选择或切换到非公交模式后管道不可见/被清理；WMS 全量公交显示不变；地铁线路及高亮不受影响。
