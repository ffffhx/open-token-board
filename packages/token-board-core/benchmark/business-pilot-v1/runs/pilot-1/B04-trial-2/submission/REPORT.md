# 修复报告

只修改了 `src/render-root.mjs`、`src/profile-catalog.mjs` 和本报告；未修改 TASK、adapter、demo 或运行接口。全部检查仅使用本题目录、内存 fixture 和本地隔离服务，没有访问真实 Chrome Profile、产品仓库或外部网络。

## 原因与复现

修改前运行 `node demo.mjs --once`，输出的 `draftAfterBusyRender` 为 `Before`，`availableProfilesWithoutSnapshot` 为 `[]`。

名称输入只存在于当前 DOM 中。主视图的状态或 busy 内容改变后，`appRoot.innerHTML` 会整体替换，而改名输入框来自尚未保存的 `profile.name`，从而覆盖用户输入。这可以解释已复现的输入丢失；本修复不推断历史截图中“成功后弹窗仍在”的唯一原因。

目录原先只使用运行快照，并在快照缺失、时间无效或超过 30 秒时直接返回空列表，因此已登记但未启动的 Profile 无法出现，也没有机会检查它们的占用租约。

## 改动

- 重绘前，仅当当前改名 Profile 与上一轮渲染一致且现有表单的 Profile ID 匹配时，读取输入框草稿；替换 HTML 后用 DOM `value` 属性恢复，包括空字符串及 HTML 特殊字符。关闭、切换 Profile、载入和 mini 模式会结束该连续编辑会话。保留原 HTML 相同即跳过重绘的逻辑；浏览器支持时同时尝试恢复焦点和选区。
- 注册表读取沿用已有平台候选路径，接受显式 `input.env.CPM_DATA_DIR`，否则使用进程环境。缺失、不可读、JSON 损坏或顶层结构错误时尝试后续路径；第一份合法注册表是权威来源，空注册表也有效。
- 校验必需字符串、整数端口及 `profiles/` 内的相对目录。注册表端口优先合法 `fixedCdpPort`，其次合法 `lastCdpPort`；过滤绝对路径、驱动器路径、目录越界和无效条目，并处理重复 ID/端口。
- 已登记条目默认 `running=false`。新鲜快照按 `profileId` 合并，保留运行信息，名称与 Agent 连接权限始终采用注册表；既有新鲜快照中的仅运行时条目仍保留。快照过期不再抹掉注册表条目。
- 合并后统一应用 `excludedPort`、有效租约检查、同 session 复用、禁用连接限制及端口排序，继续使用原有进程存活和 Gateway 所有权判断。

## 实际验证

环境为 Node `v22.14.0`。以下命令及断言均通过：

1. `node --check src/render-root.mjs`、`node --check src/profile-catalog.mjs`：语法检查通过。
2. `node demo.mjs --once`：修复后草稿为 `After user input`，无快照的 `isolated:demo` 出现在可用列表，`running=false`。
3. 使用 `node --input-type=module` 执行题包 `node-dom.mjs` 和 `fixture-ui.mjs` 上的断言：状态与 busy 重绘保留草稿；空草稿保留；无内容改变时不增加 HTML 写入；失败保留表单及准确草稿并可重试；单次成功保存只调用一次后端、提交正确名称并关闭弹窗；切换 Profile 与取消后重开不串草稿；HTML 字符保持原文；mini 模式转换清理旧编辑状态；缺失表单时不报错。用内存后端保存状态重新 `configureUi`，确认模拟重启后的名称。
4. 使用相同命令方式执行 `catalog-fixture.mjs` 断言，共 7 组目录场景：Windows/macOS/Linux 默认路径、显式数据目录、读取错误回退、空注册表优先、必需字段、合法端口上下界与非法端口回退、目录越界、新鲜/恰好 30 秒/超过 30 秒/无效快照、名称和权限覆盖、运行信息保留、排除端口、排序、同 session 复用和其他 session 占用。租约检查覆盖缺失/过期/新鲜快照，以及存活 holder、死亡且过期 holder、未过期租约、存活/死亡 daemon 和损坏租约。
5. 补充断言通过：三个平台的旧注册表目录、Windows `APPDATA`、Linux `XDG_CONFIG_HOME`；委托给用户时的 Gateway 不可用、无有效归属、有效归属及 Chrome 进程死亡。进程存活结果全部来自固定 adapter。
6. 启动 `node demo.mjs`，通过 HTTP 请求检查隔离页面、修改后的模块及未允许路径的 404。页面正确显示 `Registry candidates: Fixture Work`。本次地址为 `http://127.0.0.1:61284/`，检查完成后已停止该服务并收到 `SIGTERM` 退出结果；该地址不是持续运行的交付服务。

临时断言程序通过标准输入执行，没有新增或修改测试文件。

## 未覆盖边界

上述表单验证使用最小 DOM adapter，HTTP 验证仅检查本地页面及资源响应，并非真实浏览器端到端或视觉测试。实际浏览器的焦点、选区和输入法行为未验证。目录边界检查是路径规范化后的词法检查；题包内存文件系统不模拟符号链接。

保存和“重启”使用固定内存后端及 UI 重新配置，不是实际磁盘持久化或真实桌面应用重启。没有验证完整 Electron/IPC、浏览器启动、真实进程、生产环境租约竞争，也没有复现或宣称解决历史截图中的弹窗残留。未启动真实 Profile；自己启动的隔离预览服务已关闭。
