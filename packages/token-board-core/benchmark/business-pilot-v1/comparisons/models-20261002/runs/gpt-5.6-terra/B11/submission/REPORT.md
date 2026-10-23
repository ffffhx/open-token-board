# 发布链路修复报告

## 根因与证据

`scripts/release.mjs` 原本只执行静态构建，并将 `runtime/build/` 复制到
`runtime/published-static/`。私有正文接口和受保护 HTML 入口则由预览服务从
`runtime/published-content/` 读取。发布命令没有重新导出当前 Markdown，也没有
同步该内容卷，所以命令显示成功后仍会返回旧记录。

修复前的 `runtime/published-content/release-notes.json` 包含
`HANDOVER-V1`，而当前 `source/release-notes.md` 已包含 `HANDOVER-V2`，这复现了
“发布成功但页面仍是旧内容”的问题。

## 改动

更新 `scripts/release.mjs`，在构建静态站点之前依次调用：

1. `exportPrivate(root, slug)`：从当前 Markdown 重新生成受保护 JSON 和 HTML。
2. `syncContent(root, slug)`：仅覆盖目标 slug 在已发布内容卷中的两份记录。

之后沿用既有静态构建与复制。目标文章的 `hidden: true` 仍由导出器写入；静态站点
仍只复制 `site/` 构建物，未写入私有正文。同步只处理指定 slug，因此不会删除或重建
内容卷中的其他文章。

## 实际验证

已执行两次，验证重复发布不会影响结果：

```sh
node scripts/release.mjs release-notes
node scripts/release.mjs release-notes
```

两次均依次输出 `Exported`、`Synced`、`Static build complete` 和
`Release succeeded`。

随后以 `startPreview(process.cwd())` 启动临时的 127.0.0.1 预览服务，并使用 Node
内置 `fetch` 检查；验证结束后在 `finally` 中调用 `preview.close()`。结果如下：

- 作者请求 `/api/private-posts/release-notes`：200，含 `HANDOVER-V2`，不含 `HANDOVER-V1`。
- 作者请求 `/api/blog/release-notes`：200，含 `HANDOVER-V2`，不含 `HANDOVER-V1`。
- 未登录和 `reader` 请求两类私有入口：均为 403。
- 静态首页不含 `HANDOVER-V2`。
- `runtime/published-content/archived-memo.json` 仍含 `ARCHIVE-KEEP`。

未覆盖的边界：没有修改用户维护的 `source/` 或测试身份/预览服务，也没有手工编辑
`runtime/` 来代替发布命令；后续由外部注入的新 Markdown 内容将通过同一发布命令重新
导出并同步。
