# Open Token Board

独立部署的 AI 编码 Token 排行榜项目，包含静态站点、后端 API、共享 core、Docker 部署包和本地同步 agent。

- Website: <https://ffffhx.github.io/open-token-board/>
- API: <https://8-218-149-148.anyip.dev/token-board>
- Agent package: <https://ffffhx.github.io/open-token-board/token-board-agent.tgz>

## Workspace

- `apps/web`：Next.js 静态站点和榜单 UI
- `apps/token-board-api`：Token Board API、GitHub OAuth、Device Flow、上传和查询接口
- `packages/token-board-core`：排行榜聚合、采集清洗、鉴权、存储和共享模型
- `deploy/token-board`：PostgreSQL + API 的 Docker Compose 部署包
- `tools/token-board-agent-npx`：给朋友安装的轻量 `npx` agent
- `scripts/pack-agent.mjs`：把 agent 打包为 `apps/web/public/token-board-agent.tgz`，由 Pages 一起发布

## Local Development

```bash
pnpm install
NEXT_PUBLIC_TOKEN_BOARD_API_URL=https://8-218-149-148.anyip.dev/token-board pnpm dev
```

启动本地后端：

```bash
TOKEN_BOARD_HOST=127.0.0.1 TOKEN_BOARD_PORT=8787 pnpm token:server
```

打包 agent：

```bash
pnpm pack:agent
```

本地安装命令示例：

```bash
npx --yes --package https://ffffhx.github.io/open-token-board/token-board-agent.tgz?v=0.4.11 -- token-board-agent install
```

## Deploy Backend

```bash
cd deploy/token-board
cp .env.example .env
docker compose up -d --build
```

`TOKEN_BOARD_DATABASE_URL` 优先使用 PostgreSQL；没有配置时会回退到 `TOKEN_BOARD_DATA_FILE` JSON 文件存储。

## Deploy

GitHub Pages 由 `.github/workflows/deploy.yml` 在 `main` 推送后自动部署。构建会先生成 `apps/web/public/token-board-agent.tgz`，所以站点和 agent 包使用同一个 Pages 发布入口。
