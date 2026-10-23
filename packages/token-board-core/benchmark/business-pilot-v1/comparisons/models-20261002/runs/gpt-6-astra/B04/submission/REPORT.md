# 修复报告

## 原因与修改

- `render-root.mjs` 通过替换根节点 HTML 刷新界面，改名弹窗 HTML 每次来自已保存的 Profile 名称，因此 busy 或状态变化会覆盖 DOM 中尚未提交的输入。现在仅在相同 Profile 的弹窗连续显示时，在替换前读取当前输入并在替换后恢复；关闭、切换 Profile、载入和 mini 状态会结束这段编辑生命周期。使用 input.value 恢复而不拼接 HTML，并在真实 DOM 支持下保留当前输入焦点和选择区。HTML 未变化时仍直接返回，不产生额外重绘。
- `profile-catalog.mjs` 原先仅使用 30 秒内的运行快照，缺少或过期时直接返回空列表。现在读取注册表，将合法登记条目作为未运行 Profile 合并到目录；同 ID 的新鲜快照保留运行信息，名称与 Agent 连接限制由注册表覆盖。无新鲜快照时，登记条目仍以 running=false 列出。
- 注册表沿用显式 CPM_DATA_DIR 优先、各平台候选路径顺序；读取/解析失败继续尝试后续候选。验证必要字符串、整数端口（合法 fixed 优先，否则 last）、profiles 子目录边界，跳过不合法记录及重复 ID。保留可选元数据。所有合并后的条目仍核对有效租约，保留同 session 复用、禁用限制、excludedPort 和按端口排序。

## 实际验证

使用标准输入执行 Node 自测，没有添加或修改测试 adapter：

- 32 组断言通过。覆盖 Windows、macOS、Linux 默认注册表路径，显式 CPM_DATA_DIR，缺失快照、30001ms 过期快照、30000ms 边界快照，登记名称和连接限制覆盖快照，运行状态保留，非法/字符串端口、fixed 无效回退 last、必要字段缺失、目录越界过滤，注册表 JSON 错误回退。
- 租约断言覆盖其他 session 占用、同 session 复用、禁用 Agent 的条目、excludedPort、候选排序，以及持有进程已退出且租约过期的释放。
- UI 断言覆盖未变化时不重绘、状态重绘保留草稿、保存失败后保留草稿并再次提交、成功保存关闭弹窗、fixture 内存后端模拟重启保留名称、切换 Profile 不带入草稿、取消后重新打开重置草稿、空字符串草稿及 HTML 特殊字符。
- `node demo.mjs --once` 通过：busy 重绘后仍为 `After user input`；无快照返回 `Fixture Work`，running=false。
- 两个修改模块的 `node --check` 通过。
- 启动 `node demo.mjs` 隔离 localhost 服务，HTTP 检查页面和 renderer 返回 200，页面包含注册表候选；随后停止该服务，无遗留测试服务。

## 未覆盖边界

- DOM adapter 是最小表单生命周期模拟，未运行真实浏览器交互/E2E；焦点与选区恢复代码未通过浏览器验证。HTTP 启动检查不等同于浏览器交互验证。
- 未逐项测试所有 gateway delegated ownership 分支；这些租约判定函数保持原样。未测试符号链接实际解析；目录校验是路径层级校验，输入来自内存 fixture。
- 未访问真实 Chrome Profile、凭据、外网或生产仓库。模拟重启仅重新初始化 UI 并从 fixture 内存后端读取，不代表真实桌面应用重启或磁盘持久化。
- 完整 Electron/IPC、真实浏览器启动、真实磁盘持久化及历史截图中“保存成功后弹窗残留”的根因不在本次验证范围。后端与 UI 配套 adapter 未修改。
