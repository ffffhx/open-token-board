# 修复报告

## 原因

- 改名弹窗每次主界面重绘都会从状态里的旧名称重新生成输入框。忙碌状态或无关状态刷新因而覆盖用户尚未提交的输入。
- Profile 候选目录只读取运行快照；快照缺失或超过 30 秒时直接返回空列表，使已登记但尚未运行的 Profile 消失。

## 改动

- `src/render-root.mjs` 在同一个改名 Profile 的重绘期间保存输入草稿，切换弹窗/Profile 或关闭弹窗时清掉草稿。输入值仍通过 HTML 转义写入属性；状态内容没有变化时继续跳过重复渲染。
- `src/profile-catalog.mjs` 从受支持平台路径或 `CPM_DATA_DIR` 读取 `profiles.json`，以合法注册条目构造候选项；新鲜运行快照只补充匹配 Profile 的运行信息。注册表名称、端口及 Agent 连接限制保持权威。保留端口排除、占用租约判断、同 session 复用和端口排序，并过滤必需字段缺失、非法端口及越出 `profiles/` 的目录。

## 验证

- `node demo.mjs --once`：输出忙碌重绘后仍为 `After user input`，且没有运行快照时仍列出 `isolated:demo` 并标示 `running: false`。
- 通过标准输入执行 Node fixture 断言：Windows、macOS、Linux 路径；无快照和新鲜快照的合并；注册表名称/端口优先；非法字段、端口与越界目录过滤；其他 session 租约不可用、同 session 可复用、`excludedPort` 生效；HTML 特殊字符名称在保存失败后保留并成功重试，模拟重新载入后仍存在。所有断言通过。

## 未覆盖

以上验证使用题目提供的内存文件系统、虚拟时钟和模拟 API。没有验证真实 Electron/IPC、磁盘持久化、浏览器启动或真实桌面重启；截图中保存后弹窗残留也未作根因判断。
