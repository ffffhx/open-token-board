完整快照优化已完成。同库预热后交替七轮的刷新中位数从 9047.63ms 降至 1713.46ms，改善 81.06%；7/7 配对改善。九范围、六指标的全部 54 个快照与原实现逐字段深比较一致，包括完整 summary 和记录数。

本地服务已通过 pnpm dev 启动并保留：

- http://127.0.0.1:57357/api/usage/leaderboard?range=today&metric=tokens
- http://127.0.0.1:57357/api/usage/health
- 数据目录：C:\Users\aa182\Documents\Codex\2026-08-22\new-chat-2\repositories\open-token-board\tests\.tmp\business-replay-v2\B02\runtime\runs\run-W7xo3t
- 此导出只有 API/Core，没有网页工程。服务仅绑定本机 loopback，3905 条合成事件，不连接真实服务。已实际请求 health 和 leaderboard：200，缓存 54 个 entry，lastError 为空。

实际定位依据是 tests/replay/profile.mjs 和 artifacts/profile.json。单次完整原刷新实测 486 次查询：324 次聚合、54 次全历史荣誉事件读取、108 次当前/上期事件读取。查询完成时间合计 5240.57ms（含传输及 pg 行解码，并非 PostgreSQL 服务器执行时间），完整存储统计耗时 9935.38ms，Node CPU 9515ms。荣誉函数调用 54 次耗时 2104.52ms，趋势函数调用 54 次耗时 334.98ms。主要开销是按六个 metric 重复读取/解码历史和重复计算相同范围的统计；计算在 HTTP 主线程执行也阻塞响应。profile 单独运行，含轻量插桩，不作为正式性能验收计时。

修改源码及行为：

- packages/token-board-core/src/token-board-storage.ts 新增完整批量快照接口。保留原 SQL、事件顺序和全部统计算法，每个范围只读取并计算一次不依赖 metric 的输入。六个 metric 独立执行原排序、previousRank/rankDelta、总计和 share；保留按排序后的用户顺序累加浮点费用。统计查询减少至 81 次，加 BEGIN/COMMIT 共 83 次；所有范围在一个 PostgreSQL REPEATABLE READ READ ONLY 事务内构建，异常回滚并释放连接。
- apps/token-board-api/src/leaderboard-snapshot-runner.ts 和 leaderboard-snapshot-worker.ts 复用一个 Worker，将 SQL 结果解码、荣誉/效率/趋势/维度计算及 JSON 序列化、持久化移出 HTTP 事件循环。Worker 故障拒绝挂起任务，后续请求可重新创建；查询异常不会谎报成功。
- apps/token-board-api/src/server.ts 在全部结果和临时文件写入、原子 rename 成功后才一次性替换缓存、清除错误。重叠刷新继续共用 promise；写入触发在活跃刷新后补做一次，避免提交写入被当前事务遗漏。加载持久化文件要求完整 54 种组合。HTTP 继续读上一份有效快照，replay 控制接口保留。

兼容口径保留 today/1D/7D/30D/90D/week/month/lastweek/lastmonth 与 tokens/cost/sessions/messages/users/lines，使用原窗口函数、上海业务日边界及原包容端点。未截断历史荣誉输入或范围，未省略 level、badges、personalBests、效率、趋势、daily、models、tools、teams、projects、distribution、记录数、上期变化等字段。费用沿用 PostgreSQL double precision 和原 JavaScript 求和，无新增舍入。lines 的 NULL 与零、匿名 session 去重、并列排序和前期无行数用户过滤均沿用原逻辑。文件后端仍读取一次事件并调用原 buildTokenLeaderboard，保留原 records 口径。

首次修改前执行 pnpm measure，保存为 artifacts/baseline-measurement.json；最终重复结果在 artifacts/candidate-measurement.json 和 artifacts/measurement.json。这两次独立运行不是同库交替配对，外部计时如下（ms）：

| 轮 | 修改前 | 最终候选 |
| --- | ---: | ---: |
| 1 | 8685.59 | 2110.31 |
| 2 | 8265.34 | 2178.90 |
| 3 | 8292.71 | 2486.67 |
| 4 | 9076.72 | 2783.68 |
| 5 | 8721.93 | 2510.10 |
| 6 | 8989.83 | 2107.37 |
| 7 | 9114.55 | 2122.73 |

单独运行中位数为 8721.93ms / 2178.90ms，改善约 75.02%。原服务 963 次读取全部 200，P95 80.43ms；最终候选 410 次读取全部 200，P95 35.28ms，最大 64.78ms。最终两份 artifacts 的 54 个 entries 全量精确相等。机器同时存在其他任务，单独运行有波动，故采用下面同库交替结果判断收益。

tests/replay/verify.mjs 从修改前保存的 tests/replay/reference/*.original.txt 生成原服务和原存储测试副本，仅改变导入路径。原服务与候选运行在同一个独立 PostgreSQL、同一张表上，双方先预热一轮，再交替先后顺序。进程外 performance.now 计时包含完整计算、54 个快照持久化及 IPC 往返；两个刷新不同时执行，客户端连续读取实际 HTTP summary 并校验摘要。逐轮原始耗时、每次 HTTP 状态/时延/摘要、CPU/RSS、场景结果在 artifacts/verification.json。

| 轮 | 顺序 | 原服务 ms | 候选 ms | 配对差值 ms |
| --- | --- | ---: | ---: | ---: |
| 1 | baseline,candidate | 7397.47 | 1499.91 | 5897.56 |
| 2 | candidate,baseline | 9047.63 | 1422.23 | 7625.39 |
| 3 | baseline,candidate | 8652.23 | 1713.46 | 6938.77 |
| 4 | candidate,baseline | 8597.76 | 1541.99 | 7055.77 |
| 5 | baseline,candidate | 10533.11 | 2258.28 | 8274.83 |
| 6 | candidate,baseline | 9558.77 | 2328.35 | 7230.42 |
| 7 | baseline,candidate | 9321.61 | 1921.54 | 7400.07 |

配对差值中位数 7230.42ms，差值 MAD 291.64ms，三倍 MAD 874.93ms，满足噪声门槛。原服务 999 次读取、候选 376 次读取全部 200。原 P95 84.13ms，候选 P95 22.76ms，满足 max(100ms, baseline P95×1.3)。这些值仅描述本机合成重放，不是历史生产指标。API 进程 CPU/RSS 包含 Worker 所在线程进程的资源，不代表数据库资源。

实际通过的兼容性场景（逐次深比较 54 个 entry，并通过 /leaderboard 和 /stats 校验完整 summary；后者额外校验 records）：

- 原 fixture：多用户、缺失行数、并列、上海日/月/周边界、前期独有及新加入用户。
- 历史事件修正：旧事件 tokens、messages、lines 和小数费用修正后，两实现全部一致。
- 三个重叠刷新请求，同时实际读取 90D/cost，返回有效完整快照。
- 数据库查询故障：临时重命名数据表，刷新拒绝，lastError 非空、refreshing 为 false，旧缓存和文件不变，HTTP 仍 200。
- 查询恢复：恢复表后刷新成功、清除错误，与原实现重新逐字段一致。
- 重启：从持久化完整快照启动后结果一致。
- 小数据：完全相同显示名和值的并列、上海边界前后 1ms、缺失 session、NULL/零行数、小数费用。
- 空数据：54 个完整 summary 与原实现一致，records 为零。

另有 tests/replay/lifecycle.mjs 和 artifacts/lifecycle.json 验证文件写入故障拒绝、旧缓存和有效文件保留、54 个 HTTP summary 仍 200、恢复及重启。tests/replay/consistency.mjs 和 artifacts/consistency.json 在 pg_stat_activity 观察到刷新事务已取得 MVCC 快照后提交修正，证明正在生成的全部 54 个结果都属于旧视图，下一次刷新完整纳入修正。最终全部脚本及类型检查通过。

复现命令（仓库根目录）：

```text
pnpm measure
node --import tsx tests/replay/verify.mjs
node --import tsx tests/replay/profile.mjs
node --import tsx tests/replay/lifecycle.mjs
node --import tsx tests/replay/consistency.mjs
pnpm typecheck
pnpm measure
pnpm dev
```

运行条件：已预装依赖、PostgreSQL 16.14、Windows x64、本机隔离数据库、业务参考时间 2026-09-14T12:00:00.000Z、Asia/Shanghai。所有临时自测 API/数据库已关闭，最终 pnpm dev 的服务及数据库保留。重新 dev 会选择新的空闲端口和独立数据目录。

验证限制：初版自测错误地在 /leaderboard 响应中断言 records，因该字段原本只由 /stats 返回而失败；按原 API 约定分别校验后最终通过，未将初次失败计为通过。未测试真实生产规模、跨机网络、操作系统断电、长时间数据库连接黑洞、计算中 Worker 硬终止、文件后端全量等价重放，以及活跃事务内实际 HTTP 上传触发追赶刷新这一特定分支。文件持久化保留原子 rename 语义，未额外宣称断电 fsync 保证。独立验收仍需在其同机、同数据条件下重新外部计时。

