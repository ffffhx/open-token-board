# 完整榜单快照刷新优化

最终服务：<http://127.0.0.1:51319/api/usage/leaderboard?range=today&metric=tokens>，健康检查：<http://127.0.0.1:51319/api/usage/health>。

由本目录的 `pnpm dev` 启动，使用独立环回 PostgreSQL 和 3,905 条合成事件。此任务不含 Web 工程。最终服务保留运行；测量和自测数据库/服务已停止。

## 定位与实现

原 API 在九个范围中逐一执行六种指标查询。`readPostgresLeaderboardSummary` 的 SQL、原始事件转换、荣誉、效率、趋势、团队、项目和分布计算都不依赖指标，但重复执行六遍。实测完整合成数据的存储计算从 486 次 SQL 降到 81 次，累计查询调用等待从 4,065.10 ms 降到 706.58 ms；完整存储计算从 7,578.92 ms 降到 1,499.23 ms。查询计时包含驱动接收和解码等开销，不等同于 PostgreSQL 执行计划计时。数据来自 `tests/replay/verification.json`，不是估算的查询次数。

- Core 新增可选 `getLeaderboardSummaries`，同一范围只准备一次数据，再生成六种指标结果；原单指标接口仍可用。
- 保留原 SQL、边界、事件顺序和业务构建函数；六种指标各自执行原排序、上期排名、rankDelta 和按排序后的用户顺序累加，避免改变浮点费用精度及并列排序。
- 共享范围统计仅在本次调用中存在，每次刷新重新查询数据库，不依赖追加水位或永久事件缓存，历史修正可生效。
- 在统计阶段间让出事件循环，允许已有快照读取继续处理。没有新增子进程或把统计字段移出结果。
- API 逐范围填充新的 54 项 Map，快照文件临时写入并原子改名成功后才发布整个 Map；查询或持久化失败拒绝刷新、记录错误，并保留之前完整快照。
- 重叠刷新共用 promise；上传写入在刷新期间触发失效时，会再刷新一次，避免丢失该次失效通知。文件存储原有统计路径保留。

修改业务文件：`packages/token-board-core/src/token-board-storage.ts`、`apps/token-board-api/src/server.ts`。没有修改 replay、fixture、依赖清单、锁文件或控制接口。

## 完整统计兼容性验证

`tests/replay/baseline-storage.ts` 是修改前保存的所提供存储源码，仅将相对 import 指向现有 Core 源文件，作为自测参考实现。它不是生产路径。未改动其余统计模块。

`node --import tsx tests/replay/verify.mjs` 已通过。对九种范围 × 六种指标的整个 `{records, summary}` 做严格深比较，覆盖空库、原合成数据、所有行数缺失、相同值和相同显示名排序、非二进制精确费用、上海边界、多用户及历史更新。没有删除字段、取整或重排数组再比较。

HTTP/IPC 边界使用完整 JSON 结果比较或规范化对象键后的 SHA-256；仅遵循 JSON 对 undefined 的正常序列化，不变更数字和数组顺序。检查内容包括：

1. 原始基线测量中的全部 54 项快照与候选完全相等；所有范围/指标 HTTP summary 和用户列表一致。
2. 临时重命名数据库表后，刷新拒绝，lastError 有值，全部旧快照仍为 200 且完整；恢复表后刷新成功并清除错误。
3. 更改 45 天前事件的 tokens 和 cost，再并发触发三次刷新，全部统计与参考重新计算一致。
4. 制造快照目标路径写入失败，同时让数据库已有更新，刷新拒绝并仍保留旧快照；恢复文件路径后新统计发布并与参考一致。
5. 关闭并重启 API，使用原持久化目录和数据库，全部 54 项仍一致。

最终结果见 `tests/replay/verification.json`。早期自测曾有参考 import 路径错误、错误假定 HTTP 返回 records，以及对 JSON 边界 undefined 差异生成巨量断言输出而导致测试进程 OOM；这些是测试代码问题，已修正并完整重跑通过，遗留自测数据库已停止。没有把这些失败算作通过。

## 刷新外部计时

同一机器、同一公开 fixture、冻结时间 `2026-09-14T12:00:00.000Z`、Asia/Shanghai，按公开 `pnpm measure` 预热后测七轮。基线在任何源码修改前采集。这里是先基线、后候选的顺序测量，**没有声称完成独立验收的交替配对实验或 MAD 判定**。

| 轮次 | 基线 ms | 最终候选 ms |
| --- | ---: | ---: |
| 1 | 7864.5554 | 1488.9187 |
| 2 | 8041.4480 | 1502.9023 |
| 3 | 7772.6193 | 1471.5472 |
| 4 | 7694.3003 | 1503.7565 |
| 5 | 7769.4830 | 1454.1522 |
| 6 | 7941.0953 | 1507.8675 |
| 7 | 7844.3464 | 1417.9790 |
| 中位数 | 7844.3464 | 1488.9187 |

中位数改善 **81.02%**。刷新期间基线 939 次、候选 173 次读取全部为 200，source 为 snapshot，完整 summary 摘要与参考一致。读取 P95 为 69.835 → 81.049 ms，候选低于 `max(100, 69.835×1.3)=100 ms`；最大读取延迟为 219.881 → 174.425 ms。没有声称每一次读取都低于 100 ms。

基线 API CPU 每轮 7,093–7,797 ms，候选 1,344–1,578 ms。API 进程 maxRSS 原始值及各轮数据保留在日志中；不将 API CPU/RSS 解释为 PostgreSQL 或整机资源消耗。

原始日志：`tests/replay/baseline-measurement.json`、`artifacts/measurement.json`。摘要及完整读取/快照一致性断言：`tests/replay/measurement-summary.mjs`，输出 `tests/replay/measurement-summary.json`。

## 执行命令与限制

在本任务目录依次执行过：

```text
pnpm measure
pnpm typecheck
node --import tsx tests/replay/verify.mjs
pnpm measure
node --import tsx tests/replay/measurement-summary.mjs
pnpm typecheck
pnpm dev
```

基线命令之后先复制原始日志，再修改代码；最后两项检查均成功。最终源码还经过一次补充 measure，表中使用最终版本七轮结果。

统计仍在 API 进程内执行；本次没有验证任意大数据规模下的延迟上界。SQL 延续原先逐查询读取方式，未新增跨九个范围的数据库事务隔离保证。独立交替七轮验收仍需外部执行，本交付没有调用隐藏验收或将自身测量当作独立判定。文件存储路径未改变，但本次性能与故障重放主要覆盖 PostgreSQL。
