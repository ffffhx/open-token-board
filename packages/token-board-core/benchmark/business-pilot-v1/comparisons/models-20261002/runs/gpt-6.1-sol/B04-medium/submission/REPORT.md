# 修复报告

## 原因

名称输入只存在于 DOM；状态或 busy 改变时，根节点 innerHTML 会重新生成，历史 modal 又从已保存名称初始化输入，因此覆盖未提交草稿。保存 adapter 已在提交前读取 FormData，并在成功后清空 modal；本次不推断历史截图中弹窗残留的唯一原因。

目录列表此前完全依赖运行快照，并在快照缺失或超过 30 秒时直接返回空列表，导致已登记、未运行 Profile 消失，也跳过了它们的租约检查。

## 改动

- render-root.mjs 在同一个 modal 编辑会话重绘前读取当前输入，重绘后通过 value 属性恢复，支持空字符串和 HTML 特殊字符。modal 对象或 Profile ID 改变时重新初始化，取消、离开主界面及重新配置时清除旧草稿。保留 HTML 内容相同即跳过 innerHTML 写入的缓存路径，并在该路径处理新编辑会话的输入初始化。
- profile-catalog.mjs 读取平台注册表候选及显式 input.env / process.env.CPM_DATA_DIR，注册表读取或解析失败时尝试下一候选。按必需字段、整数端口及 profiles/ 目录包含关系过滤，优先合法 fixedCdpPort，再回退 lastCdpPort。
- 新鲜快照按 profileId 与注册表合并，注册表决定名称、端口和 Agent 连接限制，保留运行信息；缺失或过期快照时登记项 running=false。仍保留新鲜快照里的其他运行条目。每项继续核对有效租约，保留同 session 复用、excludedPort、按端口排序及候选过滤行为。

## 实际验证

使用 Node 和标准输入脚本执行断言，没有新增测试文件：

- node --check 检查两个修改后的模块，均通过。
- node demo.mjs --once：busy 重绘后输出用户输入；没有快照时输出登记候选且 running=false。
- 内存目录 fixture 分别模拟 Windows、macOS、Linux：默认路径、显式 CPM_DATA_DIR、读取错误回退、缺失/过期/新鲜快照、注册表名称和连接限制覆盖、端口排序、excludedPort、其他 session 占用及同 session 复用均通过。
- 校验缺少必要字段、非法端口、字符串端口、端口回退、相对越界及 Windows 绝对目录被过滤。
- 进程存活 adapter 验证已失效租约、未到期无 daemon 租约和死亡 daemon 租约的候选行为。
- DOM adapter 验证状态重绘、busy 重绘、保存失败保留草稿及再次提交、HTML 特殊字符、保存成功关闭 modal、模拟重新配置后恢复保存名称、切换 Profile、原地修改 modal.profileId、取消再打开、同 ID 新 modal 对象重开，以及无变化时不重复 innerHTML 写入。最终修改后重新运行保存/失败/模拟重启回归，全部通过。
- 启动 node demo.mjs 的隔离 localhost 服务，通过 HTTP 请求得到 200 且页面含登记名称，然后停止该服务；没有遗留自启动服务。

## 未覆盖边界

DOM adapter 不是浏览器端到端测试；未验证真实浏览器的焦点、选区或输入法行为。目录校验是词法包含关系，未进行真实文件系统符号链接解析。未穷举 delegatedToUser Gateway 状态组合。模拟重启使用内存 backend 和 configureUi，并非真实桌面应用重启。完整 Electron/IPC、真实磁盘持久化、浏览器启动及历史截图中的弹窗残留不在此次验证范围。没有访问实际 Chrome Profile、凭据、外部网络或其他仓库。
