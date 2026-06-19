# AGENTS.md

## 项目约定

- 本仓库使用 `pnpm`。
- 修改代码后，优先运行与改动范围匹配的检查；如果改的是 Web 界面，运行 `pnpm --filter @open-token-board/web typecheck`。
- 改动完成并验证后，需要启动项目再交付：
  - 默认启动命令：`pnpm dev`
  - 如果默认端口被占用，使用下一个可用端口，并告知访问地址。
- 改动影响官网或用户可见行为时（尤其是 `apps/web`），默认在同一次改动里同步更新 `README.md`。
  - 官网会在 push 到 `main` 时自动部署到 GitHub Pages，但 `README.md` 不会自动更新、官网也不读取它，需手动维护。
- 不要覆盖无关的本地改动。
