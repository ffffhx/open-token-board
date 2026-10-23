# 发布链路修复报告

## 根因与证据

`scripts/release.mjs` 原来只调用 `build()`，再把 `runtime/build` 复制到 `runtime/published-static`。它没有调用私有文章导出器，也没有把导出结果同步到 `runtime/published-content`。因此发布命令虽然退出成功，预览服务读取的 `release-notes.json` 和 `release-notes.html` 仍是旧的 `HANDOVER-V1` 内容；公开静态页面本身并不包含文章正文。

## 改动

修改 `scripts/release.mjs`，按以下顺序执行同一个 slug 的发布：

1. `exportPrivate(root, slug)` 从当前 `source/<slug>.md` 重新生成 JSON 和受保护 HTML。
2. `syncContent(root, slug)` 只替换该 slug 在内容卷中的记录。
3. 构建并更新公开静态站点。

按 slug 同步保留了内容卷中没有对应 source 文件的已发布文章，也保留了 `hidden: true` 和现有预览服务的作者访问控制。没有修改 `source/`、`services/` 或 `logs/`。

## 实际验证

在工作副本执行：

```text
node scripts/release.mjs release-notes
Exported release-notes.json and release-notes.html
Synced release-notes to content volume
Static build complete
Release succeeded for release-notes
```

随后启动 `node services/preview.mjs`，使用其输出的 loopback 地址验证：

- 作者请求 `GET /api/private-posts/release-notes` 返回 200，`hidden` 为 `true`，包含 `HANDOVER-V2`，不包含旧的 `HANDOVER-V1`。
- 作者请求 `GET /api/blog/release-notes` 返回 200，HTML 同样包含 `HANDOVER-V2` 且不包含旧段落。
- 普通读者请求 JSON 接口返回 403；未登录请求 HTML 接口返回 403。
- `archived-memo` 请求仍返回 `ARCHIVE-KEEP`，证明仅存在于数据卷的文章未被清空。
- 公开首页响应不包含 `HANDOVER-V2`。

重复执行 `node scripts/release.mjs release-notes` 后再次完成上述内容检查，结果相同；`node --check` 通过 `scripts/release.mjs`、`scripts/export-private.mjs`、`scripts/sync-content.mjs` 和 `lib/posts.mjs`。验证完成后已停止本次启动的预览服务。

未覆盖的边界：本次没有改动用户稿件，也没有注入第二份临时正文；评审可替换 `source/release-notes.md` 后重复运行同一命令验证新正文继续覆盖旧发布记录。
