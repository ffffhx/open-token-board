<div align="center">

# 🏆 Open Token Board

**朋友间的 AI 编码 Token 排行榜 —— 自托管、隐私优先、自动上报。**

把 Codex CLI、Claude Code、Gemini CLI、opencode 这些工具的本地用量，
聚合成一个可以和朋友们一起较劲的实时榜单。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/token-board-agent?label=token-board-agent)](https://www.npmjs.com/package/token-board-agent)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

[在线 Demo](https://ffffhx.github.io/open-token-board/) · [安装 Agent](https://www.npmjs.com/package/token-board-agent) · [快速开始](#-快速开始) · [自托管](#-部署)

<img src="./docs/screenshot.png" alt="Open Token Board 排行榜界面" width="860">

</div>

---

## 简介

Open Token Board 是一个**自己就能部署一套**的 AI 编码 Token 排行榜。

你在本机安装一个轻量 agent，它会读取各家编码工具留下的用量日志，清洗脱敏后上报到你自己的后端；网页端按 GitHub 账号展示公共榜单和个人消耗看板。整套东西没有任何第三方依赖服务——榜单、API、数据库、agent 全部在这个仓库里，部署在你自己的机器上。

适合：一群朋友 / 一个团队，想看看谁烧的 token 多、谁的缓存命中率高、钱都花在哪些模型和项目上。

## ✨ 功能特性

- 🔌 **多工具采集** — 一个 agent 同时识别 Codex CLI、Claude Code、Gemini CLI、opencode 的本地用量日志
- 🏅 **实时公共榜单** — 按 1D / 7D / 30D / 90D 滚动窗口，按总消耗 / 费用 / 会话排序，含每日趋势与份额
- 📊 **个人消耗看板** — 排名、百分位、缓存命中率、模型 / 工具 / 项目分布、分时活跃热力图、Session 明细
- 📨 **飞书日报 / 周报** — 自定义机器人推送排行榜、今日荣誉事件、周冠军和 7 天趋势
- 📟 **Codex 额度面板** — agent 安装后定时同步本机 `~/.codex` 的 5 小时 / 每周额度快照，展示剩余、重置倒计时与预计耗尽时间；也支持命令行本地查看
- 🔐 **GitHub 登录** — OAuth + Device Flow，agent 与网页用同一身份；可用白名单限制谁能上报
- 🕵️ **隐私优先** — 只上报 token 数、模型、工具、项目 basename 与会话短标题，**绝不上传 prompt 正文**
- 🧾 **费用估算** — 按输入 / 缓存写入 / 缓存读取 / 输出四分类公开单价估算成本（非实际账单），帮你横向比较
- 🧰 **一行命令加入** — 朋友只需 `npx token-board-agent install`，无需克隆仓库
- 🐳 **开箱即用的自托管** — Docker Compose 一把起 API + PostgreSQL；无数据库时自动回退到 JSON 文件存储

## 🚀 快速开始

### A. 加入朋友已经搭好的榜单

只要对方把后端地址告诉你，本机跑一条命令即可：

```bash
npx --yes token-board-agent install
```

它会引导你完成 GitHub 登录、采集本机用量并自动上报。常用命令：

```bash
npx --yes token-board-agent login     # GitHub 登录
npx --yes token-board-agent upload     # 采集并上报一次
npx --yes token-board-agent watch      # 常驻后台，定时上报
npx --yes token-board-agent status     # 查看当前状态
npx --yes token-board-agent uninstall  # 卸载
```

### B. 自己跑起来（本地开发）

```bash
pnpm install

# 启动本地后端（API + 存储）
TOKEN_BOARD_HOST=127.0.0.1 TOKEN_BOARD_PORT=8787 pnpm token:server

# 启动网页端，指向本地后端
NEXT_PUBLIC_TOKEN_BOARD_API_URL=http://127.0.0.1:8787 pnpm dev
```

打开 <http://localhost:3000/board/> 即可访问。用本地 agent 上报：

```bash
pnpm token:agent login
pnpm token:agent upload
```

## 📟 Codex 额度面板

Codex CLI 会把每次请求的限额状态写进 `~/.codex` 的会话日志（`rate_limits`，含 `used_percent`、`window_minutes`、`resets_at`）。这个面板直接读这些日志，算出 5 小时与每周两个窗口的剩余额度、重置倒计时和预计耗尽时间。

- **百分比与重置时间是精确的**（Codex 自己上报的）；消耗速度与预计耗尽由最近一段未被重置打断的斜率推算。
- **token 容量是估算值**：百分比按整数取整，且额度按账号跨设备共享，本机日志看不到网页版 / 其它机器的用量，所以容量只能给下界。
- **已计入提前充值**：窗口边界以重置点切分，Codex 提前刷新额度也不会把旧用量算进来。

三种用法：

```bash
# 1) 命令行
pnpm codex:limits            # 跑一次
pnpm codex:limits:watch      # 实时刷新的终端面板
pnpm codex:limits:serve      # 启动本地小网页（默认 http://127.0.0.1:4747）
pnpm codex:limits -- --json --days=30   # 输出原始 JSON / 指定回看天数

# 2) 项目网页（需本机已启动 token:server）
#    独立页：http://localhost:3000/limits
#    榜单内嵌：http://localhost:3000/board 的个人区域
```

网页面板通过后端的 `GET /api/usage/rate-limits` 取数。登录用户安装 `token-board-agent` 后，agent 会像 token 统计一样定时上传本机额度快照，公网 `/limits` 也能直接显示；没有登录用户快照时才回退读取 **API 服务所在机器** 的 `~/.codex`。命令行的 `--serve` 完全自包含，不依赖后端。

**Claude Code 订阅额度（`/claude-limits`）**：Claude Code 不在本地落盘额度，精确的 5h / 每周用量只出现在它注入给 statusLine 的 JSON 里（Pro/Max 账号、首个 API 响应后）。`token-board-agent install` 会生成捕获脚本 `~/.token-board-agent/claude-statusline-capture.sh`，把额度落盘成快照（零网络/零认证）并原样透传给你原有的 statusLine；在 `~/.claude/settings.json` 把 `statusLine.command` 指向该脚本即可启用，之后随后台同步上传，登录后在 `/claude-limits` 查看。详见 [agent 包 README](tools/token-board-agent-npx/README.md)。

## 🧩 支持的工具

| 工具 | 来源标识 | 默认采集路径 |
| --- | --- | --- |
| Codex CLI | `codex` | `~/.codex/sessions`、`~/.codex/projects` |
| Claude Code | `claude-code` | `~/.claude/projects` |
| Gemini CLI | `gemini-cli` | `~/.gemini/tmp`（可用 `GEMINI_DATA_DIR` / `GEMINI_CLI_HOME` 覆盖） |
| opencode | `opencode` | `~/.local/share/opencode`（`opencode*.db` 或 `storage/message/**/*.json`，可用 `OPENCODE_DATA_DIR` 覆盖） |

> agent 只读取这些工具自己写下的用量日志，不修改任何文件，也不访问网络上的其它内容。

### README 徽章

公开个人主页支持复制 Markdown 徽章，也可以手写：

```md
[![Open Token Board](https://your-token-board.example/api/badge?login=your-github-login&style=weekly)](https://your-token-board.example/u?login=your-github-login)
```

## 🔒 隐私

读取本地编码日志是件敏感的事，所以默认上报内容经过严格收敛，可在 agent 配置里进一步收紧：

- ✅ 上报：token 计数、模型名、工具名、项目 basename、会话短标题、时间戳
- 🚫 不上报：prompt / 回复正文、文件内容、完整路径、环境变量、密钥
- 🎛️ 可配置：`projectMode`（`basename` / `hash` / `none`）、`hashSessionId`、`includeSessionTitle`、`maxEventAgeDays`

配置文件位于 `~/.token-board-agent.json`。

## 🏗️ 项目结构

pnpm workspace 单仓库：

```
apps/
  web/                     Next.js 静态站点与榜单 UI
  token-board-api/         API：GitHub OAuth/Device Flow、上报与查询接口
packages/
  token-board-core/        排行榜聚合、采集清洗、鉴权、存储与共享模型
deploy/
  token-board/             PostgreSQL + API 的 Docker Compose 部署包
tools/
  token-board-agent-npx/   面向朋友的轻量 npx agent
  codex-limits/            Codex 额度面板命令行（report / watch / serve）
scripts/
  pack-agent.mjs           将 agent 打包进站点静态资源一起发布
```

## 🛠️ 本地开发

```bash
pnpm install        # 安装依赖
pnpm dev            # 启动网页端（apps/web）
pnpm token:server   # 启动后端 API
pnpm typecheck      # 全量类型检查
pnpm pack:agent     # 打包 npx agent 为静态资源
pnpm codex:limits   # 查看本机 Codex 额度（额度面板命令行）
```

> 网页端通过 `NEXT_PUBLIC_TOKEN_BOARD_API_URL` 指向后端；未配置时页面不会回退到示例数据，而是提示连接后端。

## 📦 部署

### 后端（Docker Compose）

```bash
cd deploy/token-board
cp .env.example .env     # 填入 GitHub OAuth、密钥、数据库密码等
docker compose up -d --build
```

- 配置了 `TOKEN_BOARD_DATABASE_URL` / PostgreSQL 时优先使用数据库；否则回退到 `TOKEN_BOARD_DATA_FILE` 的 JSON 存储。
- 通过 `TOKEN_BOARD_ALLOWED_GITHUB_LOGINS` 可限制允许上报的 GitHub 账号。
- AI 评测页默认仅 `ffffhx` 可见；可用 `TOKEN_BOARD_BENCHMARK_ALLOWED_GITHUB_LOGINS` 指定逗号分隔的 GitHub login 白名单。

### 飞书日报 / 周报

后端可以直接向飞书自定义机器人 webhook 发送 interactive card，不需要飞书应用凭证。配置 `TOKEN_BOARD_FEISHU_WEBHOOK_URL` 后默认启用日报和周报；未配置 webhook 时不会调度发送。

常用变量：

```bash
TOKEN_BOARD_FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/...
TOKEN_BOARD_FEISHU_WEBHOOK_SECRET=        # 机器人开启签名校验时填写
TOKEN_BOARD_DAILY_REPORT_AT=09:00         # 本地时间，默认 Asia/Shanghai
TOKEN_BOARD_WEEKLY_REPORT_AT=10:00        # 每周一 10:00
TOKEN_BOARD_DAILY_REPORT_TZ_OFFSET=480
TOKEN_BOARD_DAILY_REPORT_RANGE=1D
TOKEN_BOARD_DAILY_REPORT_SITE_URL=https://your-site/board
TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN=replace-with-random-token
TOKEN_BOARD_DAILY_REPORT_STATE_FILE=/data/daily-report-state.json
```

日报会展示“今日事件”：个人单日 PB、等级升级、新徽章、日榜 / 7 天榜 Top5 内超越；没有事件时显示兜底文案。事件对比依赖 `TOKEN_BOARD_DAILY_REPORT_STATE_FILE` 中的轻量快照，兼容 JSON 与 PostgreSQL 存储，不会写入用户配置。

手动触发用于测试或补发：

```bash
curl -X POST "https://your-api/api/internal/daily-report/run?kind=daily" \
  -H "Authorization: Bearer $TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN"

curl -X POST "https://your-api/api/internal/daily-report/run?kind=weekly" \
  -H "Authorization: Bearer $TOKEN_BOARD_DAILY_REPORT_TRIGGER_TOKEN"
```

### 前端（GitHub Pages）

`main` 分支推送后，`.github/workflows/deploy.yml` 自动构建并部署到 GitHub Pages。构建会先生成 `apps/web/public/token-board-agent.tgz`，因此站点与 agent 包共用同一个发布入口。

## 🤝 贡献

欢迎 Issue 和 PR。提交前请跑一遍：

```bash
pnpm typecheck
```

## 📄 License

[MIT](./LICENSE) © 冯鸿鑫
