# 本地文章站点

需要 Node.js 22 或更新版本，无需安装依赖。

`source/` 是编辑用 Markdown；`scripts/` 提供构建、导出、同步和发布命令。`runtime/` 已放入一次发布后的本地数据，`logs/last-release.log` 是当次报告。请先复现再修改。

```sh
node services/preview.mjs
node scripts/release.mjs release-notes
```

预览启动后输出 JSON，其中 `site` 和 `api` 是动态分配的127.0.0.1地址。服务持续运行，在服务运行时发布会即时反映文件变化。Ctrl+C 结束本次服务。

静态站点首页提供阅读入口；私有页面可选择本地测试身份。API支持如下接口：

- `/api/private-posts/<slug>`：JSON正文；请求头 `x-local-user: author` 是作者，`reader` 是普通读者，无此头表示未登录。
- `/api/blog/<slug>`：受保护的HTML正文，使用相同测试请求头。
- `/health`：服务状态。

浏览器页面会根据所选身份发送相同的测试请求头。此处身份仅用于本地仿真，不是真实登录机制。浏览器所有请求均为loopback。可用 `curl -H "x-local-user: author" <api>/api/private-posts/release-notes` 验证。

不要启动真实部署工具。不要改 `source/`、`services/`、`logs/`；它们分别代表用户当前稿件、固定基础设施和既有证据。允许修改 `scripts/`、`lib/`、`site/`，并新增 `REPORT.md`。
