# 发布链路修复报告

## 根因与证据

`scripts/release.mjs` 原来只执行静态站点构建，并把 `runtime/build` 复制到
`runtime/published-static`。它没有调用仓库中已有的 `exportPrivate` 和
`syncContent`，因此命令虽然打印 `Release succeeded` 并以 0 退出，私有正文的导出物
和内容卷却仍停留在旧版本。

修复前检查到：

- `source/release-notes.md` 包含 `HANDOVER-V2`；
- `runtime/exported-private/release-notes.json`、
  `runtime/published-content/release-notes.json` 和对应 HTML 都不包含 V2；
- 已发布 JSON/HTML 仍包含 `HANDOVER-V1` 和旧流程段落；
- `logs/last-release.log` 只记录静态构建和成功提示，与原实现吻合。

## 改动

仅修改 `scripts/release.mjs` 并新增本报告。发布命令现在按顺序：

1. 构建公开静态资源；
2. 从当前 `source/<slug>.md` 重新导出该私有文章的 JSON 和受保护 HTML；
3. 只把该 slug 的两个导出文件同步到内容卷；
4. 发布公开静态资源。

发布逻辑同时导出为 `release(root, slug)`，命令行入口保持
`node scripts/release.mjs <slug>`。没有修改 `source/`、`services/`、`logs/`、测试身份
或访问控制。私有正文仍只写入 `runtime/published-content`，没有写入公开静态页面。

## 实际验证

执行：

```text
node scripts/release.mjs release-notes
```

结果为退出码 0，并依次输出：

```text
Static build complete
Exported release-notes.json and release-notes.html
Synced release-notes to content volume
Release succeeded for release-notes
```

随后直接检查产物：JSON 和 HTML 都包含 `HANDOVER-V2`，均不再包含
`HANDOVER-V1` 或“旧流程图”段落；发布 JSON 的 `contentHtml` 与当前 Markdown 经
`getPostBySlug` 渲染的结果完全相等，且 `hidden` 仍为 `true`。公开的
`published-static/index.html` 与 `client.mjs` 不包含 `HANDOVER-V2`。

使用 `startPreview(process.cwd())` 启动 README 指定的同一预览服务，并通过 Node
`fetch` 请求实际的 127.0.0.1 地址。断言结果：

- 作者请求 `/api/private-posts/release-notes`：200，JSON 为 V2，`hidden: true`；
- 作者请求 `/api/blog/release-notes`：200，HTML 为 V2；
- 未登录及 `reader` 请求上述两个入口：全部 403；
- 公开站点 `/`：200，响应不含私有版本标记。

该验证进程在 `finally` 中调用 `preview.close()`，输出 `preview closed` 后以 0 退出，
未留下本地服务。

最后再次执行相同发布命令，并在执行前后比较仅存在于内容卷中的
`archived-memo.json` 和 `archived-memo.html` SHA-256。两者哈希分别始终为：

```text
51BF1F12D1B2F43994D80566B73003BDA9851640A8898FC0C22BF8B3BE73C389
9FB818DB0BAE9C064FCCCD67DE5E5A357611880ABCB314C6CE03554EAABD0176
```

重复发布退出码为 0，目标文章仍与当前 Markdown 精确匹配，说明发布按 slug 覆盖，
不会清空内容卷或破坏其他已发布文章。

## 未覆盖边界

按照任务约束没有改写 `source/` 来模拟第三版正文，因此没有在本次工作副本内执行
“注入另一份正文后再发布”的破坏性夹具步骤。发布函数每次调用都会通过
`getPostBySlug(root, slug)` 重新读取当前 Markdown；本次已用源码与发布 JSON 的精确
相等断言验证该路径。没有测试无效 Markdown、磁盘写满或进程在多文件复制中途被强制
终止时的恢复行为。
