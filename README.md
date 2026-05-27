# Open Token Board

独立部署的 AI 编码 Token 排行榜前端。

- Website: <https://ffffhx.github.io/open-token-board/>
- API: <https://8-218-149-148.anyip.dev/token-board>
- Source Garden: <https://github.com/ffffhx/garden-lab>

## Local Development

```bash
pnpm install
NEXT_PUBLIC_TOKEN_BOARD_API_URL=https://8-218-149-148.anyip.dev/token-board pnpm dev
```

## Deploy

GitHub Pages 由 `.github/workflows/deploy.yml` 在 `main` 推送后自动部署。
