# 发布链路修复报告

## 根因与复现证据

原 `scripts/release.mjs` 只调用 `build(root)` 并复制静态文件，即使没有生成或同步正文也打印成功。`build.mjs` 只复制 `site/`，不会处理 Markdown。预览 API 则从独立的 `runtime/published-content/` 读取 JSON 和 HTML，因此静态构建成功不代表正文发布成功。

修改前通过标准输入执行 Node 脚本，调用 `startPreview(process.cwd())` 启动固定基础设施，然后执行 `node scripts/release.mjs release-notes`。日志仍显示 `Static build complete`、`Release succeeded for release-notes`，但作者请求两个接口均为 200 且正文仍包含 `HANDOVER-V1` 和“旧流程图：先直接恢复上一版再通知负责人。”。当前 Markdown 已包含 `HANDOVER-V2`、三阶段说明和先保留状态的回滚要求。复现服务地址为 site `http://127.0.0.1:54091`、api `http://127.0.0.1:54090`，验证后已关闭。

## 改动

仅修改实现文件 `scripts/release.mjs`：每次发布先调用现有 `exportPrivate(root, slug)`，从当前 Markdown 生成该文章的 JSON 与受保护 HTML；静态构建、复制后调用 `syncContent(root, slug)`，最后才报告成功。异常沿用 Node 非零退出机制，不会继续打印成功。

沿用按 slug 复制两个文件的同步方式，不清空数据卷，不批量导出其他草稿。没有修改 source、services、logs 或身份逻辑；正文仍只进入独立内容目录，`hidden: true` 保留。runtime 中变化均由实际发布命令生成，没有手改产物。

## 实际验证

通过 PowerShell here-string 管道 `@' … '@ | node --input-type=module` 执行自测，不新增测试文件。脚本使用 `node:assert/strict`、提供的 `startPreview` 和 Node 内置 `fetch`；服务保持运行期间用 `execFileSync(process.execPath, ['scripts/release.mjs', 'release-notes'], {stdio:'inherit'})` 连续发布两次。

本次服务：site `http://127.0.0.1:56947`、api `http://127.0.0.1:56946`。两轮均验证通过：

- 作者访问 `/api/private-posts/release-notes` 与 `/api/blog/release-notes` 均返回 200。JSON 的 `contentHtml` 与当前 Markdown 经 `getPostBySlug` 渲染的内容完全相等，标题一致且 hidden 为 true；HTML article 与同一正文完全一致，类型为 text/html。
- 两接口作者正文均包含 HANDOVER-V2，不包含 HANDOVER-V1 或旧回滚段落。
- 两接口分别以 reader 和无身份头访问均为 403，响应仅为 Forbidden，不返回正文。
- 对 team-handbook、archived-memo 的 JSON/HTML 发布文件逐一比较发布前后的 SHA-256，两次均未变化；两篇文章两种接口作者读取均为 200，分别保留 TEAM-PUBLISHED-KEEP、ARCHIVE-KEEP。未发布团队草稿没有被顺带发布，仅数据卷存在的归档文章没有丢失。
- 对 source、services、logs 文件比较 SHA-256，保持不变。
- 公开 `/`、`/client.mjs`、`/environment.js` 均返回 200，不包含新旧正文标记、三阶段正文或其他文章私有标记。公开 `/release-notes.html` 与 `/release-notes.json` 均为 404。
- 执行 `node scripts/release.mjs ../release-notes`，验证非零退出且 stdout 不含成功消息。

自测退出 0，打印两轮全部 PASS。两次使用的预览服务均通过 `finally { await p.close(); }` 关闭，没有遗留服务。

## 验证边界

未修改用户稿件，因此没有实际注入第三版正文；已验证同一命令重复发布，并确认代码每次直接读取当前 Markdown，不复用旧导出。未执行浏览器交互或视觉测试，而是直接验证浏览器所用 JSON 接口、受保护 HTML 入口和公开资源。未模拟磁盘失败、并发发布或进程中断；现有两个文件的同步不是跨文件事务。本任务范围内未接触外网或真实部署。
