<div align="center">

# 🏆 Open Token Board

**朋友间的 AI 编码 Token 排行榜 —— 自托管、隐私优先、自动上报。**

把 Codex CLI、Claude Code、Cursor、Trae、Gemini CLI 这些工具的本地用量，
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

- 🔌 **多工具采集** — 一个 agent 同时识别 Codex CLI、Claude Code、Cursor、Trae、Gemini CLI 的本地用量日志
- 🏅 **实时公共榜单** — 按 1D / 7D / 30D / 90D 滚动窗口，按总消耗 / 费用 / 会话排序，含每日趋势与份额
- 📊 **个人消耗看板** — 排名、百分位、缓存命中率、模型 / 工具 / 项目分布、分时活跃热力图、Session 明细
- 🔐 **GitHub 登录** — OAuth + Device Flow，agent 与网页用同一身份；可用白名单限制谁能上报
- 🕵️ **隐私优先** — 只上报 token 数、模型、工具、项目 basename 与会话短标题，**绝不上传 prompt 正文**
- 🧾 **费用估算** — 按公开模型单价估算成本（非实际账单），帮你横向比较
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

## 🧩 支持的工具

| 工具 | 来源标识 | 默认采集路径 |
| --- | --- | --- |
| Codex CLI | `codex` | `~/.codex/sessions`、`~/.codex/projects` |
| Claude Code | `claude-code` | `~/.claude/projects` |
| Cursor | `cursor` | `~/Library/Application Support/Cursor`、`~/.config/Cursor` |
| Trae / Trae CN | `trae` | `~/Library/Application Support/Trae*`、`~/.trae*` |
| Gemini CLI | `gemini-cli` | `~/.gemini` |

> agent 只读取这些工具自己写下的用量日志，不修改任何文件，也不访问网络上的其它内容。

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

### 前端（GitHub Pages）

`main` 分支推送后，`.github/workflows/deploy.yml` 自动构建并部署到 GitHub Pages。构建会先生成 `apps/web/public/token-board-agent.tgz`，因此站点与 agent 包共用同一个发布入口。

## 🤝 贡献

欢迎 Issue 和 PR。提交前请跑一遍：

```bash
pnpm typecheck
```

## 📄 License

[MIT](./LICENSE) © 冯鸿鑫
