# 发布链路修复报告

## 根因与证据

`node scripts/release.mjs release-notes` 原先只运行 `build()` 并把静态构建复制到 `runtime/published-static/`，没有重新导出 Markdown 正文，也没有同步到预览 API 实际读取的 `runtime/published-content/`。因此命令可以打印成功，但 JSON 和受保护 HTML API 仍返回内容卷里的旧导出文件。修复前的发布内容文件长度为 JSON 232 字节、HTML 242 字节；源文件当前包含修订标记 `HANDOVER-V2`。

## 改动

更新 `scripts/release.mjs`：按同一 slug 依次运行 `exportPrivate(root, slug)`、`syncContent(root, slug)`、静态构建及复制。导出器仍从 `source/<slug>.md` 读取，并保留 `hidden: true`；静态构建只复制 `site/`，不会包含私有正文。同步只覆盖当前 slug 的 JSON/HTML，其他已发布记录不受影响。

## 实际验证

在工作副本执行两次：

```sh
node scripts/release.mjs release-notes
node scripts/release.mjs release-notes
```

两次均输出导出、同步、静态构建和发布成功。随后使用标准输入运行 Node 验证脚本并启动 `services/preview.mjs` 导出的本地预览服务：

- 作者请求 `/api/private-posts/release-notes` 得到 200，`hidden` 为 `true`，正文与当前 Markdown 渲染结果一致。
- 作者请求 `/api/blog/release-notes` 得到 200，受保护 HTML 含当前正文。
- 未登录及 `reader` 请求上述两个接口均得到 403。
- 静态首页和 `client.mjs` 不含私有正文。
- 连续发布前后，`archived-memo` 和 `team-handbook` 的 JSON/HTML SHA-256 均未变化；它们仍与 `release-notes` 一起存在于内容卷。
- 验证结束时关闭了本次启动的本地预览服务。

重新发布后，release-notes 导出文件为 JSON 346 字节、HTML 418 字节；发布 JSON 的正文与源 Markdown 精确一致。

## 未覆盖边界

只验证了 `release-notes` 这一指定 slug 和预览服务的本地模拟身份头；没有验证真实认证系统或外部部署环境，本项目任务也不要求它们。评审注入的第二版正文尚未执行，但发布脚本每次都会重新读取相同 slug 的当前 Markdown 并导出、同步，重复执行时不会改写其他 slug。
