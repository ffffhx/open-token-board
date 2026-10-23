# release-notes 发布链路修复

## 根因与证据

原 `scripts/release.mjs` 只执行静态构建，并把 `runtime/build/` 复制到 `runtime/published-static/`，随后打印成功。它没有调用已有的 `exportPrivate()` 和 `syncContent()`。预览服务的 JSON 和受保护 HTML 接口都从 `runtime/published-content/` 读取，因而静态构建成功并不意味着私有正文更新。`logs/last-release.log` 记录了原命令退出 0，但用户稿件已有 `HANDOVER-V2`，符合这个缺口导致的旧正文现象。

## 改动

`scripts/release.mjs` 现在先从当前 `source/<slug>.md` 导出私有 JSON 和 HTML，再按 slug 同步到内容卷，最后构建并发布静态页面。`syncContent()` 只覆盖目标 slug 的两个文件，不清空内容卷；私有正文没有加入静态页面。未修改 `source/`、`services/`、测试身份或 `logs/`。

## 实际验证

- 执行 `node scripts/release.mjs release-notes` 两次，均退出 0，并依次输出导出、同步、静态构建及成功消息。
- 用 `@' ... '@ | node --input-type=module` 从标准输入运行本地预览检查脚本，调用 `startPreview(process.cwd())`，并在 `finally` 中关闭服务。作者访问 `/api/private-posts/release-notes` 和 `/api/blog/release-notes` 均返回 200，正文含 `HANDOVER-V2` 且不含 `HANDOVER-V1`；普通读者和未登录者访问两个入口均返回 403，响应没有私有正文；公开首页不含 `HANDOVER-V2`。
- 用标准输入脚本读取 `getPostBySlug()` 与已发布内容：JSON 的 `contentHtml` 与当前 Markdown 渲染结果完全相等，HTML 的 `<article>` 包含完全相同的渲染结果，JSON 保持 `hidden: true`。
- 用 `node -e` 对内容卷的 `archived-memo` 和 `team-handbook` 两种文件各计算 SHA-256，重复发布前后四个哈希均不变；其中仅存在于内容卷的 `archived-memo.json` 为 `51bf1f12d1b2f43994d80566b73003bda9851640a8898fc0c22bf8b3be73c389`。
- 用另一段标准输入 Node 脚本在 `runtime/` 下创建临时工作根，复制站点与已发布内容，并仅在临时稿件中把 `HANDOVER-V2` 改为 `HANDOVER-V3`。在该根目录以 `spawnSync(process.execPath, [scripts/release.mjs 的绝对路径, 'release-notes'], { cwd: 临时根目录 })` 再次发布，退出 0。临时预览的 JSON 和 HTML 均返回 200、包含 V3 且不含 V2，`archived-memo` 仍返回 200。脚本在 `finally` 中关闭服务并删除自己创建的临时目录。

这些检查验证的是提供的 127.0.0.1 预览服务与本地内容卷；未涉及真实部署环境。
