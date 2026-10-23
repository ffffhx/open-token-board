# 修复报告

## 原因与改动

- 主界面在 busy 或状态变化后整体重建 DOM，改名框原本总从已保存的 `profile.name` 生成，覆盖了尚未提交的输入。现在仅在同一 Profile 的改名弹窗连续打开时，重绘前读取当前输入并在重绘后恢复。关闭、切换 Profile 后不传递草稿；HTML 仍由原有转义函数生成。无内容变化时仍跳过重绘。
- 目录原本以 30 秒内的运行快照为唯一来源，缺失或过期就返回空列表。现在从 `profiles.json` 建立已配置条目，按 `fixedCdpPort`、`lastCdpPort` 顺序选择合法端口；新鲜快照只补充同一 Profile 的运行信息，名称及 Agent 连接限制保持注册表值。没有新鲜快照时 `running=false`。每次查询仍读取有效租约并计算占用状态，保留同 session 复用、禁用连接、`excludedPort` 和端口排序。
- 注册表候选路径支持显式 `CPM_DATA_DIR` 以及 Windows、macOS、Linux 的默认路径。读取或解析失败时尝试下一候选路径。缺少必要字段、端口非法、重复 ID 或 `dirName` 越出 `profiles/` 的条目会被跳过。

## 实际验证

- `node --check src/render-root.mjs` 与 `node --check src/profile-catalog.mjs` 均通过。
- `node demo.mjs --once` 显示 busy 重绘后的草稿仍为 `After user input`，缺少快照时登记的 Profile 仍可用且 `running=false`。
- 使用目录内的内存文件系统和虚拟时钟 adapter，从标准输入运行断言：Windows、macOS、Linux 路径；合法端口回退、无效端口和越界目录过滤；新鲜及过期快照；注册表名称和连接限制优先；有效租约的其他 session 占用与同 session 复用；禁用连接、排除端口及排序。另验证显式 `CPM_DATA_DIR` 优先和注册表读取失败后的默认路径回退，均通过。
- 使用目录内的 DOM 与保存 adapter，从标准输入运行断言：HTML 字符保留、无变化时不重绘、状态变化后草稿保留、保存失败后再次提交正确名称、成功关闭弹窗、切换和取消后草稿不串用，以及模拟重启后的名称保留，均通过。

## 未覆盖

这些验证使用固定 fixture，不覆盖完整 Electron/IPC、真实磁盘持久化、浏览器启动或历史截图中弹窗残留现象的根因。这里的“模拟重启”只是重新配置内存 UI 和保存 adapter，并非真实桌面应用重启。未启动本地页面服务，因此没有待停止的服务。
