# 修复报告

## 原因

名称输入只有 DOM 中的临时值；busy/status 变化使根节点重新生成，改名弹窗再次使用已保存名称，覆盖尚未提交的输入。候选目录原先完全来自运行快照，缺失或超过 30 秒即返回空列表，因此已登记但未启动的 Profile 被遗漏。

## 改动

仅修改 `src/render-root.mjs`、`src/profile-catalog.mjs` 和本报告。

渲染前读取同一 Profile 当前表单的草稿，在实际替换 HTML 时转义并恢复输入值。切换 Profile 或退出改名模式清空草稿；保存失败保留，成功由既有 adapter 关闭弹窗。保留原始生成 HTML 的缓存比较，因此没有内容变化时不额外重绘。

目录读取平台对应的 `profiles.json`，优先显式 CPM_DATA_DIR，然后使用既有平台路径；读取失败或格式错误继续尝试后续路径。过滤必要字段缺失、非法端口及越界目录，合法 fixedCdpPort 优先，否则回退 lastCdpPort。登记项生成 isolated:id。新鲜快照补充运行信息，登记名称、端口及连接限制优先；缺失或过期快照使登记项 running=false。保留新鲜快照中的额外运行条目。所有合并后的条目仍检查有效租约、同 session 复用、禁止连接、excludedPort，并按端口排序。

## 实际验证

运行 `node demo.mjs --once`：busy 重绘后名称为 After user input；无快照时 Fixture Work 列为候选且 running=false。

运行两个修改模块的 `node --check`，均通过。

通过标准输入运行 Node assert 自测，全部通过：

- Windows、macOS、Linux 默认路径及显式 CPM_DATA_DIR（后者通过 fixture 的源码注入设置，未读取真实环境）。
- 无快照、30,001 毫秒过期快照、新鲜快照运行状态及登记名称/连接限制覆盖。
- 非法 fixed 端口回退 last 端口、缺少字段、非整数端口、目录越界过滤及损坏 JSON 容错。
- 其他 session 的存活租约阻止候选、同 session 可复用、禁止 Agent 连接、排除端口。
- 状态重绘与保存 busy 重绘保留 HTML 特殊字符；保存失败保留并重试，两次实际提交均为正确名称；成功关闭弹窗。
- adapter 模拟重启后恢复保存名称；切换 Profile、取消后重新打开清除草稿；无内容变化不增加 DOM 写入次数。

## 未覆盖边界

使用本目录的内存文件系统、固定时钟、进程存活及最小 DOM adapter，没有访问真实 Chrome Profile、外部网络或用户凭据。没有启动服务，故无待停止服务。未进行真实浏览器 E2E、Electron/IPC、真实磁盘持久化、真实桌面应用重启或浏览器启动验证；历史截图的弹窗残留不据此推断唯一原因。未额外测试 delegatedToUser/Gateway 租约分支及全部租约过期组合，沿用既有租约判断实现。
