<div align="center">

# 🏆 Open Token Board

**朋友间的 AI 编码 Token 排行榜，支持自托管、自动上报和公开战报。**

把 Codex CLI、Claude Code、Gemini CLI、opencode 等本地用量，
聚合成一个可以和朋友、团队一起看的实时榜单。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/token-board-agent?label=token-board-agent)](https://www.npmjs.com/package/token-board-agent)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

[在线 Demo](https://ffffhx.github.io/open-token-board/) · [安装 Agent](https://www.npmjs.com/package/token-board-agent) · [快速开始](#-快速开始) · [功能导览](./docs/features.md) · [自托管](#-部署)

<img src="./docs/screenshot.png" alt="Open Token Board 排行榜界面" width="860">

</div>

---

## 简介

Open Token Board 是一套可以自己部署的 AI 编码用量榜单。

本机安装 `token-board-agent` 后，它会读取编码工具写在本地的用量日志，清洗脱敏后上报到你自己的后端；网页端按 GitHub 账号展示公共榜单、个人看板、额度面板、公开主页和 Wrapped 战报。核心数据、API、数据库、前端和 agent 都在这个仓库里，适合朋友小组或团队自托管。

适合这些场景：

- 分开看“今天（上海自然日）”与 1D / 7D / 30D / 90D 滚动窗口里谁烧的 token 多、费用高、会话多。
- 对比模型、工具、项目、缓存命中和活跃节奏。
- 给群里自动推送日报/周报，记录 PB、升级、新徽章和排名变化。
- 把个人主页或周期 Wrapped 导出成 PNG 分享卡。

## ✨ 功能特性

- 🔌 **多工具采集**：一个 agent 默认识别 Codex CLI、Claude Code、Gemini CLI、opencode，并 best-effort 检查 Cursor。
- 🏅 **荣誉系统**：10 级能量主题等级、等级进度条、行为徽章、个人 PB 和榜单排名变化箭头。
- 🏆 **实时公共榜单**：支持今天（上海自然日）、1D / 7D / 30D / 90D、周/月日历区间和自定义 from/to，网页按总消耗、费用、会话、活跃人数切换，API 另支持消息排序。
- 📊 **榜单图表升级**：模型堆叠日趋势默认取 Top5+其他，图例可高亮/隐藏；点击最近 7 天日期可下钻 24 小时分布。
- 👤 **公开个人主页**：`/u?login=xxx` 展示 365 天贡献热力图、近 30 天趋势、模型/工具分布和 PNG 分享卡。
- 🎬 **Wrapped 战报**：`/wrapped?login=&period=YYYY-MM|YYYY` 生成五屏周期叙事和分享卡。
- 🧾 **四分类计价**：输入、缓存写入、缓存读取、输出分别计价，支持 `TOKEN_BOARD_PRICING_FILE` 自定义价格表。
- 🛡️ **上报校验**：服务端拒绝负数、加总不自洽、非法质量计数和超出允许范围的时间。
- 📨 **飞书日报/周报**：日报包含今日事件，周一周报包含周冠军、7 天趋势、荣誉高光和 Top5。
- 📟 **额度面板**：Codex 与 Claude Code 支持红黄绿状态、burn rate、预计耗尽；`/limits` 提供团队额度墙。
- ⚡ **速度趋势**：本机用稳健回归估算模型解码速度、固定开销与抖动，只上传日聚合；`/speed` 展示个人历史和工具时间构成。
- 🧰 **MCP / 导出 / statusline**：agent 内置 stdio MCP server、CSV/JSON 导出和 Claude Code statusLine 短状态。
- 🔐 **GitHub 登录**：网页 OAuth 与 agent Device Flow 共用身份，可用 GitHub login 白名单限制访问。
- 🕵️ **隐私优先**：默认只上报 token 数、模型、工具、项目 basename、会话短标题和时间戳，不上传 prompt 正文。
- 🐳 **开箱即用部署**：Docker Compose 启 API + PostgreSQL；未配置数据库时 API 回退到 JSON 文件存储。

更详细的页面说明、使用方法和完整 API 表见 [docs/features.md](./docs/features.md)。

## 🚀 快速开始

### A. 加入朋友已经搭好的榜单

只要对方把后端地址告诉你，本机运行：

```bash
npx --yes token-board-agent install
```

`install` 会引导 GitHub Device Flow 登录，并在 macOS 注册 LaunchAgent、在 Windows 注册 Task Scheduler。之后后台默认每 5 分钟同步一次。常用命令：

```bash
npx --yes token-board-agent status      # 查看安装、配置、最近同步和采集源发现状态
npx --yes token-board-agent upload      # 采集并上报一次
npx --yes token-board-agent resync      # 忽略本地上传 checkpoint，重新同步扫描窗口内事件
npx --yes token-board-agent collect     # 只采集并打印将要上报的 JSON
npx --yes token-board-agent speed       # 本地估算各模型速度与 Agent 时间构成，不上传结果
npx --yes token-board-agent uninstall   # 卸载后台任务，保留本地授权和状态文件
```

给 Claude Code 或其他 MCP 客户端接入 Token Board：

```bash
claude mcp add token-board -- npx --yes token-board-agent mcp
```

如果 MCP 客户端读取项目内 `.mcp.json`，也可以写成：

```json
{
  "mcpServers": {
    "token-board": {
      "command": "npx",
      "args": ["--yes", "token-board-agent", "mcp"]
    }
  }
}
```

本地短状态适合放进 Claude Code statusLine：

```bash
npx --yes token-board-agent statusline
```

实际长期使用建议指向 `install` 复制到本机的脚本，避免每次 statusLine 都启动 `npx`：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/you/.token-board-agent/token-board-agent.mjs statusline"
  }
}
```

### B. 自己跑起来（本地开发）

```bash
pnpm install

# 启动本地后端。正式部署请改用强随机 TOKEN_BOARD_AUTH_SECRET。
TOKEN_BOARD_ALLOW_DEV_AUTH_SECRET=true TOKEN_BOARD_HOST=127.0.0.1 TOKEN_BOARD_PORT=8787 pnpm token:server

# 启动网页端，指向本地后端。
NEXT_PUBLIC_TOKEN_BOARD_API_URL=http://127.0.0.1:8787 pnpm dev
```

打开这些页面：

- 榜单：<http://localhost:3000/board/>
- 额度面板：<http://localhost:3000/limits>
- 公开个人主页：<http://localhost:3000/u?login=github_login>
- Wrapped：<http://localhost:3000/wrapped?login=github_login>

本地 agent 指向本地后端：

```bash
TOKEN_BOARD_API_URL=http://127.0.0.1:8787 pnpm token:agent login
TOKEN_BOARD_API_URL=http://127.0.0.1:8787 pnpm token:agent upload
```

GitHub 登录和 Device Flow 需要 API 服务配置 `GITHUB_CLIENT_ID`，网页 OAuth 还需要 `GITHUB_CLIENT_SECRET`。

### C. 嵌入公开主页徽章

公开个人主页支持复制 Markdown 徽章，也可以手写：

```md
[![Open Token Board](https://your-token-board.example/api/badge?login=your-github-login&style=weekly)](https://your-token-board.example/u?login=your-github-login)
```

`style=weekly` 展示本周 token 与排名；缺省 `style=flat` 展示等级与累计 token。找不到用户或未传 `login` 时会返回 unknown SVG，不会暴露错误细节。

## 🧩 支持的采集源

| 工具 | 来源标识 | 默认采集路径 |
| --- | --- | --- |
| Codex CLI | `codex` | `~/.codex/sessions`、`~/.codex/archived_sessions`、`~/.codex/projects`，以及 `$CODEX_HOME`、Orca runtime home |
| Claude Code | `claude-code` | `~/.claude/projects`、`~/.claude/history.jsonl` |
| Gemini CLI | `gemini-cli` | `${GEMINI_DATA_DIR}`、`${GEMINI_CLI_HOME}/tmp`、`~/.gemini/tmp` |
| opencode | `opencode` | `${OPENCODE_DATA_DIR}`、`~/.local/share/opencode`，识别 `opencode*.db` 和 legacy `storage/message/**/*.json` |
| Cursor | `cursor` | 各平台 Cursor `globalStorage` 与 `logs` 目录 |

可用 `TOKEN_BOARD_USAGE_PATHS` 追加自定义路径；可用 `TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES=false` 只扫描自定义路径。agent 只读取这些工具已经落盘的日志，不修改它们的原始文件。

Codex/Claude 的扫描没有文件数量上限；请求 30 天就完整发现这 30 天内的候选文件，并按 inode 去重多 home 的硬链接。全量重同步采用 `start → append → commit` 协议，只有文件解析完整、事件数和摘要都一致时才原子替换旧历史；中途失败会保留旧数据。

要和独立工具对账，建议选择已经结束的上海自然日窗口（当天仍在写入时，各扫描器读到的快照会漂移）：

```bash
pnpm reconcile:usage -- --since 2026-07-01 --until 2026-07-07
pnpm reconcile:usage -- --since 2026-07-01 --until 2026-07-07 --kaboo ./kaboo-export.json
```

脚本分别调用 ccusage 的 Codex/Claude 报告、Tokscale，并可读取 Kaboo 导出的 JSON/CSV。它只报告同窗差值，不把“数值更高”直接判定为某个平台出错。

## 📟 额度面板

Codex CLI 会把限额状态写进 `~/.codex` 会话日志，包含 `used_percent`、`window_minutes` 和 `resets_at`。Open Token Board 会解析 5 小时与每周两个窗口，并展示：

- 剩余百分比、重置倒计时和红黄绿状态。
- burn rate（百分比/小时和估算 token/小时）。
- 预计耗尽时间，以及是否早于重置。
- token 容量与剩余额度估算。

三种用法：

```bash
pnpm codex:limits
pnpm codex:limits -- --json --days=30
pnpm codex:limits:serve
```

网页端：

- `/limits`：Codex、Claude Code、团队额度墙三个标签。
- `/claude-limits`：兼容旧链接，默认打开 Claude Code 标签。
- `/board`：登录用户个人区域内嵌 Codex 额度摘要。

Claude Code 不在本地持久化订阅额度，精确 5h / weekly 数据只出现在 statusLine JSON。`token-board-agent install` 会生成 `~/.token-board-agent/claude-statusline-capture.sh`，把 `rate_limits` 离线保存到 `~/.token-board-agent/claude-rate-limits.json`，再由后台任务上传。接入方式见 [agent README](./tools/token-board-agent-npx/README.md#claude-code-订阅额度statusline-捕获)。

## 🔒 隐私与口径

默认上报：

- token 计数：`inputTokens`、`cacheCreationInputTokens`、`cachedInputTokens`、`outputTokens`、`reasoningOutputTokens`。
- 元数据：模型、工具、项目 basename、会话短标题、时间戳、估算费用。
- 额度快照：Codex 本地日志解析结果，和可选 Claude Code statusLine 捕获结果。

默认不上报：

- prompt / 回复正文。
- 文件内容、完整路径、环境变量、密钥。
- 原始本地日志文件。

服务端隐私开关：

```bash
TOKEN_BOARD_PROJECT_MODE=basename      # basename | hash | none
TOKEN_BOARD_INCLUDE_MODEL=true
TOKEN_BOARD_INCLUDE_SOURCE=true
TOKEN_BOARD_HASH_SESSION_ID=true
TOKEN_BOARD_INCLUDE_SESSION_TITLE=true
TOKEN_BOARD_MAX_EVENT_AGE_DAYS=120
TOKEN_BOARD_BLOCKED_SOURCES=trae,trae-sampled
TOKEN_BOARD_FILE_RETENTION_EVENTS=0                # JSON 存储保留数；0 表示不截断
```

所有用户上报来源默认可信，不设置单事件或单用户单日 token 上限。服务端只校验字段格式、加总关系和时间范围；已明确无可靠逐调用数据的来源仍可通过 `TOKEN_BOARD_BLOCKED_SOURCES` 整体禁用。

费用是公开单价估算，不代表实际账单。四分类计价会先把输入拆成普通输入、缓存写入、缓存读取，再加输出 token；未匹配模型会出现在 `GET /api/usage/health` 的 `pricing.unmatchedModels` 中。

## 🔗 API 一览

常用公开端点如下，完整端点、参数和鉴权要求见 [docs/features.md#api-一览](./docs/features.md#api-一览)。

| 方法 | 路径 | 主要参数 | 鉴权 |
| --- | --- | --- | --- |
| `GET` | `/api/usage/stats` | `range` 或 `from`/`to`、`metric`、`now` | 无 |
| `GET` | `/api/usage/leaderboard` | `range`、`metric`、`limit`、`now` | 无 |
| `GET` | `/api/usage/user` | `login`、`now` | 无 |
| `GET` | `/api/usage/wrapped` | `login`、`period`、`now` | 无 |
| `GET` | `/api/badge` | `login`、`style=flat|weekly`、`now` | 无 |
| `GET` | `/api/usage/export` | `format=csv|json`、`scope=leaderboard|me`、`range`、`metric` | `leaderboard` 无；`me` 需要网页登录或 agent Bearer |
| `GET` | `/api/usage/rate-limits` | `days` | 可选网页登录，未登录回退 API 服务所在机器 |
| `GET` | `/api/usage/rate-limits/team` | 无 | 网页 GitHub 登录 |
| `GET` | `/api/agent-speed/history` | `days=7|30|90` | 网页 GitHub 登录或 agent Bearer |
| `POST` | `/api/agent-speed/history` | JSON `snapshots[]` 日聚合 | agent Bearer 或 `X-Token-Board-Token` |
| `POST` | `/api/usage/ingest` | JSON `events[]` / `userConfig` | agent Bearer 或 `X-Token-Board-Token` |
| `POST` | `/api/internal/daily-report/run` | `kind=daily|weekly` | `Authorization: Bearer TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN` |

## 🏗️ 项目结构

pnpm workspace 单仓库：

```text
apps/
  web/                     Next.js 静态站点与榜单 UI
  token-board-api/         API：GitHub OAuth/Device Flow、上报、查询与飞书推送
packages/
  token-board-core/        排行榜聚合、采集清洗、荣誉系统、计价、存储与共享模型
deploy/
  token-board/             PostgreSQL + API 的 Docker Compose 部署包
tools/
  token-board-agent-npx/   面向朋友的轻量 npx agent、MCP server、statusline
  codex-limits/            Codex 额度面板命令行（report / watch / serve）
scripts/
  pack-agent.mjs           将 agent 打包进站点静态资源一起发布
```

## 🛠️ 本地开发

```bash
pnpm install
pnpm dev
pnpm token:server
pnpm agent:help
pnpm codex:limits
pnpm typecheck
pnpm pack:agent
```

网页端通过 `NEXT_PUBLIC_TOKEN_BOARD_API_URL` 指向后端；未配置时页面不会回退到示例数据，而是提示连接后端。

## 📦 部署

### 后端（Docker Compose）

```bash
cd deploy/token-board
cp .env.example .env
docker compose up -d --build
```

`deploy/token-board/compose.yaml` 会启动 PostgreSQL 17 与 API 服务，并把 `TOKEN_BOARD_DATABASE_URL` 指向 compose 内的 PostgreSQL。未配置数据库时，API 会回退到 `TOKEN_BOARD_DATA_FILE` 指定的 JSON 文件。

关键环境变量：

| 变量 | 用途 |
| --- | --- |
| `TOKEN_BOARD_PUBLIC_URL` | API 对外访问地址，用于 OAuth callback 与 agent 配置。 |
| `TOKEN_BOARD_ALLOWED_ORIGINS` | CORS 允许的前端 origin。 |
| `TOKEN_BOARD_ALLOWED_RETURN_ORIGINS` | OAuth/logout `returnTo` 允许跳回的前端 origin。 |
| `TOKEN_BOARD_AUTH_SECRET` | 签发网页 session 和 agent token 的强随机密钥，正式环境必须配置。 |
| `TOKEN_BOARD_COOKIE_SAMESITE` / `TOKEN_BOARD_COOKIE_SECURE` | 跨站部署时常用 `None` + `true`。 |
| `TOKEN_BOARD_ALLOWED_GITHUB_LOGINS` | 可选 GitHub login 白名单，限制登录和 agent 上报。 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth 与 Device Flow。Device Flow 只需要 client id，网页 OAuth 需要 secret。 |
| `TOKEN_BOARD_DATA_FILE` | JSON 文件存储回退路径。 |
| `TOKEN_BOARD_JSON_BACKUP_ENABLED` | JSON 文件存储每日首次写入前备份；设为 `false` 可关闭，默认保留最近 3 份。 |
| `TOKEN_BOARD_JSON_BACKUP_DIR` | JSON 备份目录；默认与 `TOKEN_BOARD_DATA_FILE` 同目录。 |
| `TOKEN_BOARD_LEADERBOARD_SNAPSHOT_FILE` | 榜单快照缓存文件。 |
| `TOKEN_BOARD_LEADERBOARD_SNAPSHOT_REFRESH_MS` | 榜单快照刷新间隔。 |
| `SNAPSHOT_SHARE_DATA_FILE` | snapshot 分享存储文件。 |
| `TOKEN_BOARD_POSTGRES_DB` / `TOKEN_BOARD_POSTGRES_USER` / `TOKEN_BOARD_POSTGRES_PASSWORD` / `TOKEN_BOARD_POSTGRES_SCHEMA` | Docker Compose PostgreSQL 配置。 |
| `TOKEN_BOARD_MIGRATE_JSON_ON_START` | 为 `true` 时启动后把 JSON 事件导入当前存储。 |
| `TOKEN_BOARD_PRICING_FILE` | 可选自定义计价 JSON 文件，路径需在 API 容器内可读。 |

JSON 文件存储会在单进程内串行化写入，并用临时文件 + rename 原子替换；启动时如果发现主文件损坏，会尝试从最近可读备份恢复，否则降级为空事件结构并输出告警。这个互斥只覆盖单个 Node 进程，多实例或多副本部署仍应使用 PostgreSQL。

自定义价格表示例：

```json
{
  "models": [
    {
      "id": "custom-model",
      "startsWith": ["custom-model"],
      "input": 1,
      "cacheCreationInput": 1.25,
      "cacheReadInput": 0.1,
      "output": 5,
      "source": "custom"
    }
  ],
  "fallback": {
    "input": 1,
    "cacheCreationInput": 1.25,
    "cacheReadInput": 0.1,
    "output": 5
  }
}
```

### 飞书日报 / 周报

后端可以向飞书自定义机器人 webhook 发送 interactive card，不需要飞书应用凭证。配置 `TOKEN_BOARD_FEISHU_WEBHOOK_URL` 后，日报和周报默认启用；未配置 webhook 时不调度。

```bash
TOKEN_BOARD_FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/...
TOKEN_BOARD_FEISHU_WEBHOOK_SECRET=
TOKEN_BOARD_DAILY_REPORT_AT=09:00
TOKEN_BOARD_WEEKLY_REPORT_AT=10:00
TOKEN_BOARD_DAILY_REPORT_TZ_OFFSET=480
TOKEN_BOARD_DAILY_REPORT_RANGE=1D
TOKEN_BOARD_DAILY_REPORT_SITE_URL=https://your-site/board
TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN=replace-with-random-token
TOKEN_BOARD_DAILY_REPORT_STATE_FILE=/data/daily-report-state.json
TOKEN_BOARD_QUOTA_ALERT_THRESHOLD=25
TOKEN_BOARD_DAILY_REPORT_ENABLED=true
TOKEN_BOARD_WEEKLY_REPORT_ENABLED=true
```

日报“今日事件”包括单日 PB、等级升级、新徽章，以及日榜/7 天榜 Top5 内超越。事件依赖 `TOKEN_BOARD_DAILY_REPORT_STATE_FILE` 保存的轻量快照，首次运行通常还没有可对比事件。日报还会读取团队 Codex / Claude Code 周额度快照，剩余低于 `TOKEN_BOARD_QUOTA_ALERT_THRESHOLD`（默认 25%）时追加“额度预警”；超过 24 小时未更新的快照只做“数据过旧”提示，不计入预警。

手动触发：

```bash
curl -X POST "https://your-api/api/internal/daily-report/run?kind=daily" \
  -H "Authorization: Bearer $TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN"

curl -X POST "https://your-api/api/internal/daily-report/run?kind=weekly" \
  -H "Authorization: Bearer $TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN"
```

### 前端（GitHub Pages）

`main` 分支推送后，`.github/workflows/deploy.yml` 会构建并部署到 GitHub Pages。构建会先生成 `apps/web/public/token-board-agent.tgz`，因此站点与 agent 包共用同一个发布入口。

## 🤝 贡献

欢迎 Issue 和 PR。提交前按改动范围运行检查；全量检查为：

```bash
pnpm typecheck
```

## 📄 License

[MIT](./LICENSE) © 冯鸿鑫
