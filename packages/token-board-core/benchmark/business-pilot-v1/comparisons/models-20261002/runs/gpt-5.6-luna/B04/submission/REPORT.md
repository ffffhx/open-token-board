# B04 修复报告

## 原因

渲染器在 busy 或状态更新时会重新生成 rename 表单，直接把输入值恢复成旧 state 中的名称，因此未提交的草稿会丢失。Profile catalog 原先只在运行快照新鲜时读取快照；快照缺失或过期就返回空列表，导致已登记但未运行的 Profile 消失。

## 改动

- `src/render-root.mjs` 为当前 rename 表单保存按 Profile 区分的草稿，在同一编辑会话的重绘后恢复；切换 Profile、取消或关闭后清理草稿，并继续对名称使用 HTML 转义。
- `src/profile-catalog.mjs` 增加跨 Windows、macOS、Linux 及 `CPM_DATA_DIR` 的注册表读取，校验必填字段、端口和 `profiles/` 目录边界。
- 以注册表为配置来源，合法 fixed 端口优先于 last 端口；快照新鲜时仅合并对应 Profile 的运行信息，快照缺失或过期时保留条目并标记 `running: false`。
- 保留排除端口、端口排序、有效租约占用、禁止 Agent 连接和同 session 复用规则。

## 已运行验证

- `node demo.mjs --once`：确认 busy 重绘后的 `draftAfterBusyRender` 保留为 `After user input`，无快照时返回注册表 Profile 且 `running: false`。
- `node --check src/profile-catalog.mjs; node --check src/render-root.mjs`：语法检查通过。
- 通过内存 fixture 断言注册表 fallback、fixed/last 端口选择、非法目录过滤、快照名称以注册表为准、运行状态合并、其他 session 占用和同 session 复用。

## 未覆盖

验证使用题目提供的内存文件系统、进程存活 adapter 和模拟重启边界；未覆盖真实 Electron/IPC、真实 Chrome Profile、磁盘持久化、浏览器启动及截图中的弹窗表现。
