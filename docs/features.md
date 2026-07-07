# Open Token Board 功能导览

这份文档面向使用者和自托管维护者，按实际代码行为整理。页面路径以默认 Next.js 前端为准，API 路径以 `apps/token-board-api/src/server.ts` 为准。

## 榜单与个人看板

榜单页 `/board` 读取 `GET /api/usage/stats`，支持 `1D`、`7D`、`30D`、`90D` 滚动窗口，`week`、`month`、`lastweek`、`lastmonth` 日历区间，以及 `from=YYYY-MM-DD&to=YYYY-MM-DD` 自定义区间。网页指标卡包括 `tokens`、`cost`、`sessions`、`users`，服务端 API 还支持 `messages`。页面会展示总量、活跃人数、主力模型/工具、排行榜、趋势、效率指标和登录用户的个人消耗看板。

使用方法：部署 API 后设置前端环境变量 `NEXT_PUBLIC_TOKEN_BOARD_API_URL=https://your-api`，打开 `/board`。点击时间范围和指标切换榜单；登录 GitHub 后，页面会额外读取 `/api/usage/me` 展示自己的排名、百分位、等级、徽章、PB、项目/会话/活跃热力图。

## 荣誉系统

荣誉系统来自 `packages/token-board-core/src/token-achievements.ts`。等级按累计 token 计算，共 10 级：火花、燃灯、炉心、熔炉、星火工坊、等离子、日冕、脉冲星、星门、超新星。个人看板和榜单用户卡会展示当前等级、到下一级进度、榜单排名变化箭头。

使用方法：正常上报即可自动计算。徽章包括深夜节奏、周末节奏、缓存命中、GPT/o 系模型偏好、Opus 偏好、连续 7/30/100 天、10M/100M/1B Club。PB 包括单日最高、滚动 7 天最高、最长连续活跃天数，以及今天是否刷新单日 PB。

## 公开个人主页

公开主页 `/u?login=xxx` 读取 `GET /api/usage/user?login=xxx`，不要求登录。服务端按 GitHub login 匹配用户事件，返回 365 天日序列、总量、模型/工具 Top8 和 `1D/7D/30D/90D` 排名。前端展示 GitHub 风格年度热力图、近 30 天趋势、模型/工具分布、用户分享卡和 Markdown 徽章复制入口。

使用方法：从榜单用户名进入，或直接访问 `/u?login=github_login`。点击“生成分享卡”后可以保存 PNG 或复制图片；点击“复制徽章 Markdown”可得到 `[![Open Token Board](https://your-api/api/badge?login=github_login&style=weekly)](...)`。若 API 返回 404，说明当前后端还没有这个 login 的上报数据；徽章接口会返回 unknown SVG。

## Wrapped 战报

Wrapped 页面 `/wrapped?login=&period=` 读取 `GET /api/usage/wrapped`，`period` 支持 `YYYY-MM` 或 `YYYY`，缺省为当前月。它按周期过滤该用户事件，生成五屏叙事：周期总消耗、峰值日、主力模型/项目、节奏与荣誉、分享卡。

使用方法：打开 `/wrapped?login=github_login&period=2026-07` 或 `/wrapped?login=github_login&period=2026`。页面内快捷入口支持本月、上月、今年；分享区可导出 PNG 或复制图片。

## 四分类 token 与费用估算

Open Token Board 的费用估算按四类 token 计算：普通输入、缓存写入 `cacheCreationInputTokens`、缓存读取 `cachedInputTokens`、输出 `outputTokens`。`reasoningOutputTokens` 会保留并展示，但费用估算按输出总量计算。未命中的模型使用 fallback 单价，并会记录到 `GET /api/usage/health` 的 `pricing.unmatchedModels`。

使用方法：默认价格表在 `token-leaderboard.ts` 内置。自托管时可设置 `TOKEN_BOARD_PRICING_FILE=/data/pricing.json` 覆盖或补充，文件支持 `models` 和 `fallback`。模型匹配支持精确别名 `aliases`、前缀 `startsWith`、包含项 `includes`。

## 效率指标

效率指标只用于个人看板和荣誉系统，不参与排行榜排序。`GET /api/usage/stats` 和 `GET /api/usage/me` 会返回增量的 `efficiency` 字段；网页只在登录后的“我的 Token 消耗”中展示本人效率，不在公开个人主页展示他人效率明细。

当前口径包含三项：

- 工具错误率：`errorCount / toolCallCount`。分母只统计日志中明确带成功/失败布尔值的工具结果，例如 Claude Code 的 `tool_result.is_error`、Codex MCP 工具结束事件的 `result.Ok.isError`；没有结构化错误标志的工具输出不会当作成功计入分母。
- 中断率：`interruptedSessions / interruptionSignalSessions`。Claude Code 使用用户消息中的显式中断标记，Codex 使用 `turn_aborted` 事件；同一会话只计一次。
- Tokens / 会话：当前窗口内 `inputTokens + outputTokens` 除以会话数，作为任务粒度参考值。

数据不足时不会显示误导性的 `0%`：工具错误率要求至少 50 次明确工具结果，中断率要求至少 10 个有中断信号口径的会话，低于阈值显示“数据不足”；旧 agent 或旧数据缺少新增字段时按“暂无数据”处理，并在团队中位数计算中跳过。

隐私边界：agent 只上报 `errorCount`、`interruptedCount`、`toolCallCount` 这类计数字段，不上传错误内容、工具输出正文、用户指令文本或完整 transcript。服务端 JSON 存储和 PostgreSQL 存储都把这些字段作为可选字段保存，缺省为无质量信号。

## 上报校验

服务端在 `/api/usage/ingest` 和 `/api/usage/replace` 入口做反作弊与误报保护：token 数必须是非负数，`totalTokens` 要与 `inputTokens + outputTokens` 自洽，缓存读写合计不能超过输入，`reasoningOutputTokens` 不能超过输出，时间不能超出允许范围，单事件默认上限 50,000,000 token，单用户单日默认上限 500,000,000 token。

使用方法：正常使用 agent 不需要手动处理。自托管可通过 `TOKEN_BOARD_MAX_EVENT_TOTAL_TOKENS`、`TOKEN_BOARD_MAX_USER_DAILY_TOTAL_TOKENS`、`TOKEN_BOARD_MAX_EVENT_AGE_DAYS` 调整边界。若批次被拒，响应会返回 `errors[]` 指明第几条记录失败。

## 榜单图表

榜单日趋势优先使用服务端返回的 `summary.trends.model`。除 `users` 指标外，趋势会按模型堆叠，默认分组为 Top5 + 其他；图例点击一次高亮，再点隐藏，隐藏后可恢复。点击最近 7 天内的某一天，会展开 24 小时分布；更早日期会提示仅最近 7 天支持小时下钻。

使用方法：在 `/board` 切换顶部指标卡或排行榜指标，趋势图会跟随当前 metric 显示 token、费用、会话或消息。点击日期柱查看小时分布，点击图例聚焦某个模型。

## 飞书日报与周报

API 服务可以向飞书自定义机器人发送 interactive card。日报由 `TOKEN_BOARD_DAILY_REPORT_AT` 控制，周报由 `TOKEN_BOARD_WEEKLY_REPORT_AT` 控制，周报固定按本地时区的周一触发。日报“今日事件”依赖 `TOKEN_BOARD_DAILY_REPORT_STATE_FILE` 的上次快照，包含单日 PB、升级、新徽章、日榜/7 天榜 Top5 内超越。周报包含周冠军、周总量、环比上周、7 天趋势、本周荣誉和周榜 Top5。

使用方法：配置 `TOKEN_BOARD_FEISHU_WEBHOOK_URL` 后自动调度；如机器人启用签名校验，配置 `TOKEN_BOARD_FEISHU_WEBHOOK_SECRET`。手动测试用 `POST /api/internal/daily-report/run?kind=daily|weekly`，必须带 `Authorization: Bearer $TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN`。未配置 trigger token 时该路由返回 404。

## 额度面板与团队墙

`/limits` 页面包含 Codex、Claude Code、团队三个标签。Codex 额度来自 agent 上传的 `~/.codex` 解析结果；未登录或没有个人快照时，`GET /api/usage/rate-limits` 会回退读取 API 服务所在机器。Claude Code 额度来自 statusLine 捕获脚本落盘的 `~/.token-board-agent/claude-rate-limits.json`，没有快照时返回 `available:false`。团队墙读取所有用户配置中的 Codex/Claude 快照，按每周剩余百分比从低到高排序，超过 2 小时未更新标记为 stale。

使用方法：安装并登录 `token-board-agent` 后等待后台同步，打开 `/limits`。团队墙 `/api/usage/rate-limits/team` 需要网页 GitHub 登录；未登录只能看个人公开/回退接口。

## MCP、导出与 statusline

`token-board-agent mcp` 启动 stdio MCP server，复用 `~/.token-board-agent.json` 中的 API 地址和 agent token。工具包括 `get_leaderboard`、`get_my_usage`、`get_user_profile`、`get_rate_limits`。网页导出使用 `GET /api/usage/export`，支持 `csv|json` 和 `leaderboard|me`。`token-board-agent statusline` 会在 800ms 内读取当天个人导出，输出类似 `🏆#3 · 12.4M` 的短文本。

使用方法：

```bash
claude mcp add token-board -- npx --yes token-board-agent mcp
npx --yes token-board-agent statusline
```

榜单导出不需要登录；个人导出需要网页登录 cookie 或 agent Bearer token。

## Agent 采集源

agent 默认扫描 Codex CLI、Claude Code、Gemini CLI、opencode、Cursor，并用 Trae sampled 对 Trae 累计计数做差分采样。它会按文件 mtime 限制扫描窗口，按 inode 去重 Codex 多个 home 的硬链接，并维护上传 checkpoint 防止重复上报。

使用方法：运行 `npx --yes token-board-agent status` 查看各采集源发现了多少近期文件。用 `TOKEN_BOARD_USAGE_PATHS=/path/a,/path/b` 追加自定义目录；用 `TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES=false` 只扫自定义目录；用 `TOKEN_BOARD_TRAE_SAMPLER=false` 关闭 Trae sampled。

## API 一览

通用参数：

- `range`：`1D`、`7D`、`30D`、`90D`、`week`、`month`、`lastweek`、`lastmonth`，未传默认 `7D`。`GET /api/usage/stats` 还支持 `from`/`to` 自定义区间，最长 366 天。
- `metric`：`tokens`、`cost`、`sessions`、`messages`、`users`，未传默认 `tokens`。MCP 的 `get_leaderboard` 只开放 `tokens/cost/sessions/messages`。
- `now`：可选 ISO 时间，用于调试或回放；传入后多数榜单接口走 live 计算而不是快照缓存。
- Web 登录：GitHub OAuth 成功后写入 `token_board_session` HttpOnly cookie。
- Agent 鉴权：`Authorization: Bearer <agent token>`，或 legacy `X-Token-Board-Token`。

| 方法 | 路径 | 参数 / Body | 鉴权要求 | 说明 |
| --- | --- | --- | --- | --- |
| `OPTIONS` | 任意路径 | 无 | 无 | CORS preflight。 |
| `GET` | `/api/usage/health` | 无 | 无 | 服务状态、记录数、存储类型、计价 override 文件、未匹配模型、榜单快照状态。 |
| `POST` | `/api/internal/daily-report/run` | Query `kind=daily|weekly` | Bearer `TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN` | 手动触发飞书日报/周报；未配置 trigger token 时返回 404。 |
| `GET` | `/api/usage/rate-limits` | Query `days`，最大 90 | 可选网页登录 | 有登录用户快照时返回该用户 Codex 快照，否则回退 API 服务所在机器。 |
| `GET` | `/api/usage/claude-rate-limits` | 无 | 可选网页登录 | 有登录用户快照时返回 Claude Code 快照，否则 `available:false`。 |
| `GET` | `/api/usage/rate-limits/team` | 无 | 网页 GitHub 登录 | 团队 Codex/Claude 额度墙。 |
| `GET` | `/api/snapshots/health` | 无 | 无 | snapshot 分享存储健康状态。 |
| `GET` | `/api/explain-selection/health` | 无 | 无 | AI 解释服务健康状态、白名单、Kimi key 是否配置。 |
| `POST` | `/api/explain-selection` | JSON 选词解释 payload | 网页 GitHub 登录且在解释白名单 | 调 Kimi/Moonshot 生成选词解释。 |
| `POST` | `/api/chat-article` | JSON 文章问答 payload | 网页 GitHub 登录且在解释白名单 | 调 Kimi/Moonshot 生成文章问答。 |
| `POST` | `/api/snapshots` | JSON snapshot，支持 `expiresInDays`、`siteUrl`、`shareId` | Agent Bearer 或 legacy token | 发布脱敏 snapshot 分享；默认拒绝未 redacted 的 snapshot。 |
| `GET` | `/api/snapshots/:id` | Path `id` | 无 | 读取 snapshot 分享。 |
| `DELETE` | `/api/snapshots/:id` | Path `id` | Agent Bearer 或 legacy token | 删除自己发布的 snapshot。 |
| `GET` | `/api/auth/me` | 无 | 可选网页登录 | 返回 `{ authenticated, user }`。 |
| `GET` | `/api/benchmark/access` | 无 | 可选网页登录 | 返回当前用户是否在 benchmark 白名单。 |
| `GET` | `/api/auth/logout` | Query `returnTo` | 无 | 清除网页 cookie 并跳回允许 origin。 |
| `GET` | `/api/auth/github/start` | Query `returnTo` | 无 | 发起 GitHub OAuth，要求 `GITHUB_CLIENT_ID`。 |
| `GET` | `/api/auth/github/callback` | Query `code`、`state` | GitHub 回调 | 交换 token，校验白名单，写入网页 cookie。 |
| `POST` | `/api/auth/device/start` | 空 JSON | 无，需配置 `GITHUB_CLIENT_ID` | GitHub Device Flow 起点，返回 device/user code。 |
| `POST` | `/api/auth/device/poll` | JSON `{ "deviceCode": "..." }` | 无，需配置 `GITHUB_CLIENT_ID` | 轮询 Device Flow，成功后返回 agent token。 |
| `GET` | `/api/usage/stats` | Query `range` 或 `from`/`to`、`metric`、`now` | 无 | 榜单主接口，返回 `summary` 与记录数。 |
| `GET` | `/api/usage/user` | Query `login`、`now` | 无 | 公开个人主页数据。 |
| `GET` | `/api/usage/wrapped` | Query `login`、`period`、`now` | 无 | Wrapped 周期战报数据，`period` 支持 `YYYY-MM` 或 `YYYY`。 |
| `GET` | `/api/badge` | Query `login`、`style=flat|weekly`、`now` | 无 | 公开 SVG 徽章；缺省 flat，用户不存在或 login 无效时返回 unknown。 |
| `GET` | `/api/usage/me` | Query `range`、`now` | 网页 GitHub 登录 | 当前网页登录用户个人看板数据。 |
| `GET` | `/api/usage/summary` | Query `now`、`userId` | 无 | 全局或指定 `userId` 的 snapshot 汇总。 |
| `GET` | `/api/usage/leaderboard` | Query `range`、`metric`、`limit`、`now` | 无 | 榜单 Top N，`limit` 范围 1 到 100，默认 50。 |
| `GET` | `/api/usage/export` | Query `format=csv|json`、`scope=leaderboard|me`、`range`、`metric`、`now` | `leaderboard` 无；`me` 需要网页登录或 agent Bearer | 导出榜单或个人数据。 |
| `POST` | `/api/usage/ingest` | JSON `{ events: [], userConfig }` | Agent Bearer 或 legacy token | 增量写入事件和用户配置。 |
| `POST` | `/api/usage/replace` | JSON `{ events: [], userConfig }` | Agent Bearer 或 legacy token | 删除当前用户旧事件后写入本批事件；空事件只更新配置。 |

## 常用环境变量

| 变量 | 默认值 / 行为 | 说明 |
| --- | --- | --- |
| `TOKEN_BOARD_HOST` / `TOKEN_BOARD_PORT` | `127.0.0.1` / `8787` | API 监听地址。 |
| `TOKEN_BOARD_PUBLIC_URL` | 从请求推断 | OAuth callback 与对外 URL。 |
| `TOKEN_BOARD_ALLOWED_ORIGINS` | `*` | CORS origin。 |
| `TOKEN_BOARD_ALLOWED_RETURN_ORIGINS` | 继承 allowed origins + 当前请求 origin | OAuth/logout 跳转白名单。 |
| `TOKEN_BOARD_AUTH_SECRET` | 无 | 正式环境必须配置；本地可临时设 `TOKEN_BOARD_ALLOW_DEV_AUTH_SECRET=true`。 |
| `TOKEN_BOARD_DATABASE_URL` / `DATABASE_URL` | 无 | PostgreSQL 连接串；缺省用 JSON 文件。 |
| `TOKEN_BOARD_DATA_FILE` | `.token-board/usage-events.json` | JSON 存储路径。 |
| `TOKEN_BOARD_PRICING_FILE` | 无 | 自定义价格表。 |
| `TOKEN_BOARD_ALLOWED_GITHUB_LOGINS` | 空，表示不限制 | 登录/上报白名单。 |
| `TOKEN_BOARD_DAILY_REPORT_AT` | `09:00` | 日报本地时间。 |
| `TOKEN_BOARD_WEEKLY_REPORT_AT` | `10:00` | 周一周报本地时间。 |
| `TOKEN_BOARD_DAILY_REPORT_TZ_OFFSET` | `480` | 报告时区偏移分钟。 |
| `TOKEN_BOARD_FEISHU_WEBHOOK_URL` | 空 | 飞书 webhook；为空则不调度。 |
| `TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN` | 空 | 手动触发日报/周报的 Bearer token。 |
| `TOKEN_BOARD_PROJECT_MODE` | `basename` | 服务端项目名脱敏，支持 `basename/hash/none`。 |
| `TOKEN_BOARD_INCLUDE_MODEL` / `TOKEN_BOARD_INCLUDE_SOURCE` / `TOKEN_BOARD_INCLUDE_SESSION_TITLE` | `true` | 服务端 ingest 隐私开关。 |
| `TOKEN_BOARD_HASH_SESSION_ID` | `true` | 服务端默认 hash 会话 ID。 |
| `TOKEN_BOARD_MAX_EVENT_TOTAL_TOKENS` | `50000000` | 单事件 token 上限。 |
| `TOKEN_BOARD_MAX_USER_DAILY_TOTAL_TOKENS` | `500000000` | 单用户单日 token 上限。 |
