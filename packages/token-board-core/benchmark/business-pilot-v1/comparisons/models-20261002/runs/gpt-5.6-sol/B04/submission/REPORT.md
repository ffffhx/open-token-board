# 修复报告

## 原因

- 改名弹窗包含在主区域整段 HTML 中。busy 或状态变化触发重绘时，`innerHTML` 会重建表单，输入框因而重新取用 `store.state` 中尚未保存的旧名称。
- Profile 目录此前只读取 30 秒内的运行快照，并在快照缺失或过期时直接返回空数组。运行快照实际只适合补充运行态，不能替代已配置 Profile 的注册表。

## 改动

- `src/render-root.mjs` 在重绘前按 Profile ID 捕获当前改名输入，在确实重建 DOM 后恢复输入值。弹窗关闭或切换到另一 Profile 时会清除/隔离草稿，因此取消后重新打开不会带回旧草稿；恢复通过 input 的 `value` 属性完成，不把用户文本拼入 HTML。原有 HTML 未变化时跳过写入的行为保持不变。
- `src/profile-catalog.mjs` 从平台注册表路径（以及显式 `CPM_DATA_DIR` 候选）读取 `profiles.json`，校验必需字符串、端口、重复 ID/端口和 profiles 子目录边界。合法 `fixedCdpPort` 优先，缺失或非法时回退 `lastCdpPort`。
- 注册表现在是目录基线。缺失或过期快照下，登记项仍以 `running=false` 返回；新鲜快照仅为相同 `isolated:<id>` 补充运行态，注册表继续决定名称、端口及 Agent 连接限制。未登记的快照项不会进入目录。
- 每个候选仍读取有效租约：其他 session 的租约会占用候选，同 session 租约允许复用；禁用 Agent 连接、`excludedPort`、端口排序和读取错误降级均保留。

## 实际验证

- `node demo.mjs --once`：草稿在 busy 重绘后仍为 `After user input`；无运行快照的登记项以 `running=false` 返回。
- 通过 Node 标准输入运行 UI 生命周期断言：覆盖状态重绘、无变化不重复写 DOM、切换 Profile、取消后重开、HTML 特殊字符、首次保存失败后保留并重试、一次提交使用当前草稿、成功关闭弹窗，以及重新 `configureUi` 的模拟重启后名称仍在。
- 通过 Node 标准输入和内存 fixture 在 Windows、macOS、Linux 三个平台分支运行目录断言：覆盖固定端口优先与历史端口回退、非法端口、缺字段、目录越界、快照缺失/新鲜/过期、注册表覆盖快照名称和连接限制、未登记快照项、禁用连接、排除端口、其他 session 占用、同 session 复用及端口排序。
- `node --check src/render-root.mjs` 与 `node --check src/profile-catalog.mjs` 均通过。
- 启动 `node demo.mjs` 后，请求隔离的 localhost 页面得到 HTTP 200，页面包含 fixture 标题及注册候选；验证后已停止服务。

## 未覆盖

- 未覆盖完整 Electron/IPC、真实磁盘持久化、真实浏览器启动、真实 Chrome Profile 或用户凭据，也未访问外部网络。
- “重启”验证仅是 fixture 中重新配置 UI 状态的模拟重启，不代表真实桌面应用重启。
- 未验证历史截图中的弹窗残留现象，因为该现象不在本题稳定复现和验收范围内。
