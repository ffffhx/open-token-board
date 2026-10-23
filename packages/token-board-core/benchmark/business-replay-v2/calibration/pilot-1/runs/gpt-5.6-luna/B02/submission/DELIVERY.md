# Snapshot refresh optimization

##定位依据

`pnpm measure` 的基线刷新约 7.7–8.3 秒。源码追踪显示 PostgreSQL 快照路径为每个范围/指标组合重复读取和聚合；完整刷新串行构建 54 个结果。刷新期间 HTTP 读取由外部测量，基线读取 P95 为 66.803 ms。

##修改

- 快照刷新现在从存储读取一次一致的完整事件集，再使用现有 `buildTokenLeaderboard` 为九种范围和六种指标构建完整结果。
- 保留 SQL 路径的响应字段形状：模型和工具的兼容字段按历史 API 形状整理，关闭范围的上海时区日序列补齐到当前冻结参考日。
- 计算每个结果后让 HTTP 服务获得事件循环调度机会；只有 54 项全部成功后才发布新缓存，因此失败时保留此前有效快照。
- PostgreSQL 连接池为刷新期间的读取保留连接余量。

##兼容性验证

`artifacts/measurement-baseline.json` 保存修改前七轮原始测量，`artifacts/measurement.json` 保存最终七轮测量。使用同一合成数据、冻结时间 `2026-09-14T12:00:00Z`、Asia/Shanghai、本机 PostgreSQL 16.14 和预热流程比较：

| 项目 | 基线 | 候选 |
| --- | ---: | ---: |
| 刷新中位数 | 7751.409 ms | 4681.756 ms |
| 读取 P95 | 66.803 ms | 95.637 ms |
| 完整快照项数 | 54 | 54 |

七轮配对刷新差值中位数为 3060.621 ms，差值 MAD 为 194.062 ms，前者大于后者三倍。54 个范围/指标组合的摘要和记录数逐项与基线相同。

##命令和服务

已执行：

```text
pnpm typecheck
pnpm measure
```

最终服务由 `pnpm dev` 启动，地址和隔离数据目录见交付回复；可访问 `/api/usage/leaderboard?range=today&metric=tokens` 与 `/api/usage/health`。测量只使用任务提供的本机隔离数据库和合成数据；外部验收仍需在其指定机器和预热条件下复测。
