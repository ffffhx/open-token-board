# B04 修复报告

## 原因

- 改名弹窗的输入值只来自 `store.state` 中的 Profile 名称；主视图每次 busy/status 刷新都会重建 `appRoot.innerHTML`，因此用户尚未提交的输入会被旧名称覆盖。
- Profile 候选列表只读取新鲜的运行快照；快照缺失或超过 30 秒时直接返回空数组，导致已登记但未启动的 Profile 消失。

## 改动

- `src/render-root.mjs`
  - 在重绘前捕获当前改名表单的 `profileId` 和输入值。
  - 仅当重绘后仍是同一个 Profile 的改名弹窗时恢复草稿。
  - 切换 Profile、关闭/取消后重新打开时不会复用旧草稿；原有 `lastMainHtml` 相同则跳过重绘的行为保留。

- `src/profile-catalog.mjs`
  - 接入 `profiles.json` 注册表读取，支持显式 `env.CPM_DATA_DIR` 以及 Windows/macOS/Linux 默认路径。
  - 将登记条目规范化为 `isolated:<id>`，优先使用合法 `fixedCdpPort`，否则使用合法 `lastCdpPort`。
  - 忽略缺少必要字符串字段、端口非法、`dirName` 越出注册表 `profiles/` 子目录的条目。
  - 有可读注册表时以注册表作为已配置 Profile 来源；新鲜运行快照只为同一 Profile 补充 `running` 状态，名称、端口和 `agentAccessDisabled` 以注册表为准。
  - 没有可读注册表时保留原先基于新鲜运行快照的兜底行为。
  - 保留 `excludedPort`、端口排序、租约检查、同 session 复用、其他 session 占用排除、禁止 Agent 连接排除，以及注册表读取错误跳过处理。

## 验证

- `node demo.mjs --once`
  - busy 重绘后改名输入保持为 `After user input`。
  - 无运行快照时，注册表中的 `Fixture Work` 仍列为可用候选，且 `running:false`。

- 标准输入 Node 断言脚本
  - 覆盖保存失败后保留草稿并可再次提交、保存成功后弹窗关闭、模拟重启后名称保留。
  - 覆盖 HTML 字符名称不破坏输入值。
  - 覆盖切换到另一个 Profile、取消后重新打开不会带入旧草稿。
  - 覆盖新鲜快照只保留同一 Profile 的运行态，登记名称/端口/连接限制优先。
  - 覆盖过期快照时登记 Profile 仍列出并标记 `running:false`。
  - 覆盖其他 session 租约占用不可用、同 session 租约可复用、`excludedPort` 排除、禁止 Agent 连接不可用。
  - 覆盖 Windows/macOS/Linux 默认注册表路径、显式 `CPM_DATA_DIR`、非法端口和目录越界过滤。

- `node demo.mjs`
  - 最终版本本地隔离服务成功启动到 `http://127.0.0.1:65360/`，随后已停止。

## 未覆盖

- 未覆盖完整 Electron/IPC 行为、真实磁盘持久化、真实浏览器启动和截图中“保存成功后弹窗仍在”的历史现象。
- 验证中的重启是 fixture 提供的模拟重启，不是真实桌面应用重启。
