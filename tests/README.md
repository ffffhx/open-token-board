# Open Token Board Regression Tests

本目录固化 open-token-board 的 API 与 Web 冒烟回归测试。

## 本地运行

首次运行 Playwright 前安装 Chromium：

```bash
pnpm install
pnpm exec playwright install chromium
```

常用命令：

```bash
pnpm test:api
pnpm test:e2e
```

`pnpm test:api` 使用 `node:test` 与原生 `fetch`，不会引入额外断言框架。`pnpm test:e2e` 使用 `@playwright/test`，当前只跑 Chromium。

## 测试基建

共享启动逻辑在 `tests/support/harness.ts`：

- 为 `token:server` 分配随机本地端口。
- 使用临时目录写入 JSON 存储文件，设置 `TOKEN_BOARD_DATA_FILE`、快照文件和分享文件。
- 使用测试专用 `TOKEN_BOARD_AUTH_SECRET` 程序化签发 Web session cookie 与 agent Bearer token。
- 通过 ingest 接口灌入确定性的额度配置。
- 测试结束后关闭服务并删除临时目录。

fixture 在 `tests/support/fixtures.ts`：

- 覆盖 2 个自然月。
- 覆盖 3 个 team 与 4 个用户。
- 覆盖多模型、多来源、多项目、多量级数据。
- 包含 `cacheCreationInputTokens`、`cachedInputTokens`、`reasoningOutputTokens`。
- 额外提供月度、年度、from/to、自定义登录用户与额度墙数据。

## E2E 策略

Web 应用当前是 Next `output: "export"` 静态导出模式。E2E 因此采用 `build + static serve`，而不是 `next dev`：

- 更接近 Pages/静态站点部署形态。
- `NEXT_PUBLIC_TOKEN_BOARD_API_URL` 在构建时固定到测试 API 服务。
- 避免 dev server 的 HMR 与运行时差异影响冒烟断言。

Playwright 全局 setup 会启动 API、构建 `@open-token-board/web`，再用 `tests/support/static-server.ts` 服务 `apps/web/out`。
