# 榜单快照重放

这是历史 Open Token Board 的 API/Core 子系统，不含网页工程。全部输入由 replay/fixture.mjs 生成，没有真实客户数据。

业务源码起点是历史提交 `cd20aef5e0f75f0aec5bd14b29fe0befce22e77c`。本工作区导出该提交的完整 API/Core 必要模块；原始依赖锁保存在 `provenance/historical-pnpm-lock.yaml`。另外加入的 replay/ 文件、IPC 控制接口与工作区依赖配置用于独立重放，并未把后续业务修复放进起始源码。

环境预备完成后运行：

```text
pnpm measure
pnpm typecheck
pnpm dev
```

`pnpm measure` 启动临时 PostgreSQL 16.14、写入确定性合成数据，启动完整历史 API，先预热再测七轮，写入 `artifacts/measurement.json`。文件含每轮刷新外部耗时、刷新期间 HTTP 读取、API CPU/RSS。CPU/RSS 指 API 进程，不代表全部数据库和子进程开销；退出子进程的资源数据另存在运行目录 process-metrics。不要只摘最快一轮。

`pnpm dev` 生成独立临时数据并输出服务地址和数据目录。访问 `/api/usage/leaderboard?range=today&metric=tokens` 或 `/api/usage/health`。端口自动选可用端口，关闭进程后停止该隔离数据库。数据库使用本机 127.0.0.1 的独立端口；不要修改为真实服务地址。

新机器首次需先 `node replay/bootstrap.mjs <短缓存目录>`。该脚本按 pnpm-lock.yaml 安装依赖，并将固定 PostgreSQL 平台包复制到短目录，解决 Windows 长路径；这一步不计入测量。正式评测由准备脚本预先执行，无需模型下载。支持 Windows x64；Linux x64 需要普通用户运行 PostgreSQL。`.replay-runtime.json` 只保存中立二进制与临时目录地址。每次运行都新建数据库；不会使用系统已有数据库。

业务参考时间固定为 2026-09-14T12:00:00Z；统计口径使用源码中的上海时区。54 种结果通过原 PostgreSQL 存储模块及 HTTP 服务构建。replay/clock.mjs 冻结业务时钟，performance.now 保持真实计时。源码末尾的受环境变量保护 IPC 接口只触发原有刷新、读取原有缓存并返回进程资源，不替换存储、SQL、统计或 HTTP。默认生产入口和业务源码仍可直接阅读。

评测前后数据、时钟和环境必须一致；新增验证可以放 tests/replay/。请在修改前保留 artifacts/measurement.json 为基线，然后交付 DELIVERY.md。
