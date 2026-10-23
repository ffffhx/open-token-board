# 发布链路修复报告

## 根因与复现

当前 `source/release-notes.md` 已为 `HANDOVER-V2` 且保留 `hidden: true`。原 `scripts/release.mjs` 只构建、复制静态资源，没有调用正文导出和同步函数，却直接打印发布成功。

固定预览服务的 JSON 和受保护 HTML 入口读取的是 `runtime/published-content/`；`runtime/exported-private/` 和该数据卷中的目标文章仍为 V1。因此静态构建退出 0 并不代表正文更新。

修改前启动题包预览服务，实际执行原命令 `node scripts/release.mjs release-notes`，退出 0 并打印成功。随后以 `x-local-user: author` 请求：

- `http://127.0.0.1:50451/api/private-posts/release-notes`：200，仍含 `HANDOVER-V1`。
- `http://127.0.0.1:50451/api/blog/release-notes`：200，仍含 `HANDOVER-V1`。

两者均仍含旧段落“旧流程图：先直接恢复上一版再通知负责人。”。该次静态地址为 `http://127.0.0.1:50452`，复现服务已关闭。

## 修改

仅修改实现文件 `scripts/release.mjs`，新增本文档。现在发布命令依次执行：

1. `exportPrivate(root, slug)` 从当前 Markdown 重新生成目标 JSON 和受保护 HTML，并验证私有标记。
2. 原有静态构建及复制。
3. `syncContent(root, slug)` 同步目标文章的两种正文到数据卷。
4. 上述步骤完成后才报告发布成功；异常以非零状态退出。

使用已有的逐 slug 导出、同步实现，不清空数据卷、不发布其他草稿。私有正文仍保留在独立正文目录。未修改用户原稿、测试身份、`services/`、`logs/`、`site/`。目标 runtime 产物由发布命令生成，没有手改正文产物。

## 实际执行的验证

使用 PowerShell here-string 传入 `node --input-type=module`，通过 Node 内置 `assert`、`fetch`、`child_process` 和题包 `startPreview` 执行以下检查。HTTP 验证均请求实际运行的 127.0.0.1 服务，所有服务在 `finally` 中调用 `await preview.close()`。

### 当前用户原稿与重复发布

- `node --check scripts/release.mjs`：退出 0。
- 在同一个持续运行的预览服务中，通过 `execFileSync(process.execPath, ['scripts/release.mjs', 'release-notes'], { cwd: root })` 连续执行两次发布，两次均成功。
- 发布输出包含 `Exported release-notes.json and release-notes.html`、`Static build complete`、`Synced release-notes to content volume` 和最终成功消息。
- 本轮 API 地址为 `http://127.0.0.1:53354`，静态地址为 `http://127.0.0.1:53355`；验证后均已关闭。

每次发布后都执行以下断言，全部通过：

| 检查 | 实际结果 |
| --- | --- |
| 作者读取 JSON 正文 | 200；slug、title、hidden、contentHtml 与当前原稿解析结果一致；hidden=true；含 V2、不含 V1 |
| 作者读取受保护 HTML | 200；Content-Type 为 HTML；article 正文与当前原稿渲染结果完全一致；含 V2、不含 V1 |
| reader 和未登录请求两个正文入口 | 四种组合均为 403，返回仅包含 Forbidden 错误的 JSON |
| 团队手册和仅存在于数据卷的归档文章 | 作者读取两种正文入口均为 200，响应与保留的文件内容一致 |
| 其他文章的已发布文件及导出文件 | 发布前后逐文件 SHA-256 完全一致；未发布团队手册的新草稿 |
| source、services、logs、site | 发布前后逐文件 SHA-256 完全一致 |
| runtime/build 与 runtime/published-static | 没有 V1/V2 标记或完整私有正文 |
| 静态 `/`、`/client.mjs`、`/environment.js` | 均为 200，响应不含 V2 正文标记 |
| 静态 `/release-notes.html`、`/release-notes.json`、`/published-content/release-notes.json`、`/runtime/published-content/release-notes.html` | 均为 404 |

此外通过 `spawnSync(process.execPath, ['scripts/release.mjs', 'missing-post'], ...)` 检查不存在的原稿：非零退出，没有输出 `Release succeeded`。

本轮最终输出 `ALL_CURRENT_SOURCE_CHECKS_PASSED`、`PREVIEW_CLOSED`。

### 更换正文后再次发布

为保留用户原稿，测试在题包 runtime 目录下生成独立的 `release-verification-mDKrU7` 测试副本，复制静态输入和已发布正文记录。调用原修复脚本，以隔离副本为 cwd；没有修改原 source。

1. 先发布副本中的原 V2 内容，并通过作者 JSON 请求确认 V2 可读。
2. 仅改测试副本的稿件正文，换成随机 UUID 标记和 `<private> & reserved characters.`，保留原 frontmatter。
3. 使用相同发布命令发布新正文，再重复发布一次。
4. 两轮中 JSON、受保护 HTML 均返回随机新正文，V1/V2 均消失，特殊字符正确转义；hidden=true；reader 和未登录的两个入口均为 403。
5. 其他正文文件逐字节不变；公开静态文件没有随机正文；重复发布的目标 JSON+HTML 哈希完全一致；原始 source 文件保持不变。

隔离副本 API 为 `http://127.0.0.1:63457`、静态地址为 `http://127.0.0.1:63458`。最终输出 `ALL_EDITED_SOURCE_CHECKS_PASSED; original source unchanged`、`FIXTURE_PREVIEW_CLOSED`。所有断言通过，服务已关闭。

### 其他已发布文章的保留证据

下列 SHA-256 在修改前记录，修改后及重复发布后检查仍相同：

| 文件（runtime/published-content/） | SHA-256 |
| --- | --- |
| team-handbook.json | 1dc9c3dd4ed5f5a31cdfd6583753002fdd58b120b8dfbecceacdd275029ae0f9 |
| team-handbook.html | 1f05d012516dfd05c85c21735e3a0f821ac53617bdf8fafa2a13aab598f90539 |
| archived-memo.json | 51bf1f12d1b2f43994d80566b73003bda9851640a8898fc0c22bf8b3be73c389 |
| archived-memo.html | 9fb818db0bae9c064fcccd67de5e5a357611880abcb314c6ce03554eaabd0176 |

## 验证边界

已验证实际本地 HTTP、访问控制、JSON 和受保护 HTML 正文、静态隔离、新正文发布及重复发布。未进行浏览器 GUI 点击或截图测试，未使用外网或外部测试。未验证并发发布、进程中断或磁盘故障时两个文件的原子切换，现有同步函数仍逐文件复制。

交付时本次启动的所有预览服务均已关闭；主工作副本的已发布正文保留从用户当前 V2 原稿生成的结果。隔离测试副本保留在 `runtime/release-verification-mDKrU7/`，不参与主工作副本的发布或预览。
