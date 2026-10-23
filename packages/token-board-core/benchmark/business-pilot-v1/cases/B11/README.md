# B11 · 发布成功后私有文章仍显示旧内容

这是有历史源码及会话证据的**脱敏场景重建**，不是完整旧项目 checkout。历史文章更新提交为 `1e55df8b2abd4ae7e0d67a7ada120aa0fe48014b`，它在用户报告旧版页面之前；没有找回当时远端内容卷，不能据此声称已经完整复现生产事故。

已核对该提交的静态发布流程只构建并上传静态产物；私有文章导出脚本另写 HTML/JSON；后端经鉴权从独立内容目录读取；还有单独的数据同步脚本。题包保留这四者的关系，以 Node 标准库服务和本地文件复制代替原来的静态托管、OAuth、SSH 与容器。所有正文、身份及初始旧数据均为合成。

给参评 Agent 的内容只有 `prompt.txt` 和 `workspace/`；`reference/`、`negative-controls/`、`verify.mjs`、本文件及私有索引属于评审侧。

```sh
node verify.mjs workspace
node verify.mjs reference
node verify.mjs negative-controls/static-only
node verify.mjs negative-controls/export-without-sync
```

验收会在系统临时目录复制工作副本，重置初始发布卷，启动两个动态端口的 loopback HTTP 服务；不改传入的已冻结目录。每轮退出会关闭自己创建的服务，临时副本保留用于调试。基线和两个负对照的当前正文、下一次正文的 JSON/HTML 都应失败；参考版本全部通过。

除了正文外，检查作者/读者/匿名访问、静态产物未泄露正文、其他文章字节不变、用户稿件不变、重复发布、随机新正文再次发布。`REPORT.md` 的自动检查仅确认有实质文本；诊断是否诚实、证据是否充分仍需人工复核。HTTP检验覆盖正文及权限，没有用它替代完整浏览器交互、布局或生产验收。

历史故障的用户报告有直接证据；历史根因和最终修复来自当时助手报告及对应代码机制，本次未验证原线上结果。原会话定位、原文和源码指纹只存于本地私有溯源索引。
