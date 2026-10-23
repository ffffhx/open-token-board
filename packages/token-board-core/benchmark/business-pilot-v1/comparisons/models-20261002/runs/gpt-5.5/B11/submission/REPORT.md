# 发布链路修复报告

## 根因

`scripts/release.mjs` 只执行了静态站点构建并复制到 `runtime/published-static`，没有调用私有文章导出或同步步骤。预览服务的 JSON 正文接口和受保护 HTML 入口实际读取的是 `runtime/published-content/<slug>.json|html`，所以命令显示发布成功后，页面仍然读到旧的 content volume 内容。

## 证据

- `source/release-notes.md` 当前正文包含 `HANDOVER-V2`，并包含新段落“检查输入、生成摘要、验证交接”。
- 修复前 `runtime/published-content/release-notes.json` 和 `.html` 仍包含旧段落“旧流程图：先直接恢复上一版再通知负责人。”以及 `HANDOVER-V1`。
- `services/preview.mjs` 的 `/api/private-posts/<slug>` 和 `/api/blog/<slug>` 都从 `runtime/published-content` 读取，而不是从静态构建目录读取。

## 改动

- 修改 `scripts/release.mjs`：
  - 调用 `exportPrivate(root, slug)`，从当前 Markdown 重新生成私有 JSON 和受保护 HTML。
  - 调用 `syncContent(root, slug)`，把导出结果同步到预览服务读取的 `runtime/published-content`。
  - 保留原有静态构建和复制流程。

此改动只覆盖目标 slug 的 JSON/HTML，不会清空 content volume，因此保留了其他已发布文章，包括只存在于数据卷中的文章。

## 实际验证

执行发布命令：

```sh
node scripts/release.mjs release-notes
```

结果：

```text
Exported release-notes.json and release-notes.html
Synced release-notes to content volume
Static build complete
Release succeeded for release-notes
```

磁盘内容验证：

- `runtime/published-content/release-notes.json` 保留 `"hidden": true`，正文包含 `HANDOVER-V2` 和新段落。
- `runtime/published-content/release-notes.html` 包含 `HANDOVER-V2` 和新段落。
- 旧段落和 `HANDOVER-V1` 已从 `release-notes` 发布内容中消失。

启动本地预览：

```sh
node services/preview.mjs
```

服务地址：

```text
site: http://127.0.0.1:49185
api:  http://127.0.0.1:49184
```

接口验证：

```sh
curl.exe -s -i -H "x-local-user: author" http://127.0.0.1:49184/api/private-posts/release-notes
```

结果为 `HTTP/1.1 200 OK`，JSON 包含 `HANDOVER-V2`、新段落和 `"hidden": true`。

```sh
curl.exe -s -i -H "x-local-user: author" http://127.0.0.1:49184/api/blog/release-notes
```

结果为 `HTTP/1.1 200 OK`，HTML 包含 `HANDOVER-V2` 和新段落。

访问控制验证：

```sh
curl.exe -s -i http://127.0.0.1:49184/api/private-posts/release-notes
curl.exe -s -i -H "x-local-user: reader" http://127.0.0.1:49184/api/private-posts/release-notes
```

两者均返回 `HTTP/1.1 403 Forbidden` 和 `{"error":"Forbidden"}`。

重复发布验证：

```sh
node scripts/release.mjs release-notes
```

再次成功执行导出、同步和静态构建。随后确认：

- `runtime/published-content` 仍包含 `archived-memo.*`、`release-notes.*`、`team-handbook.*`。
- 作者访问 `archived-memo` 仍返回 `ARCHIVE-KEEP`。
- 作者访问 `team-handbook` 仍返回 `TEAM-PUBLISHED-KEEP`。

公开静态页面验证：

```sh
curl.exe -s -i http://127.0.0.1:49185/
```

结果为 `HTTP/1.1 200 OK`，页面只包含本地身份选择、读取按钮和客户端脚本入口，没有内嵌 `release-notes` 私有正文。

验证结束后已停止本地预览服务。

## 未覆盖边界

- 未修改 `source/`、`services/`、`logs/`。
- 未使用外网、真实账号、SSH、Docker 或凭据。
- 未测试不存在 slug 的错误路径；本次修复聚焦于已存在私有文章的可重复发布链路。
