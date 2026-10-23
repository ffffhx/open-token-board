# 修改报告

## 恢复依据

- `MATERIALS.md` 说明：`.history/read-02.md` 是首次助手改写前的 Read/旧文本，`.history/read-03.md` 是第一次助手改写结果，当前 `handbook.md` 是后续修改后的状态。
- `.history/events.json` 给出的事件时间为：E01 Git blob 导出 `2026-09-03T13:20:00+00:00`；E02 首次助手编辑前读取 `2026-09-03T13:35:22.812Z`；E03 首次助手编辑 `2026-09-03T13:38:20.811Z`；E04 当前文档后续编辑 `2026-09-03T13:43:23.920Z`。
- 因此，开场白从 `.history/read-02.md` 恢复。项目 1 按 `references/project-notes.md` 重新整理；旧稿中未被该资料支持的实现细节没有继续沿用。

## 修改范围

- 修改 `handbook.md` 的“一、整体面试开场白”：恢复为 `read-02.md` 对应版本。
- 修改 `handbook.md` 的“1. ProfilePilot：真实 Chrome 与 Agent 的浏览器控制面”：只采用 `references/project-notes.md` 明确提供的业务背景、5 款工具评测、Gateway/Profile 租约、Wrapper/一次性 Ticket、Daemon/WebSocket、CDP 安全校验、页面悬浮控制条以及并行运行 2 个 Session 等事实。
- `handbook.md` 的项目 2 未编辑；`.history`、`references` 和 `MATERIALS.md` 未编辑。

## 核验结果

- 以 UTF-8 读取并比较开场白区段：与 `.history/read-02.md` 的对应区段完全一致（`opening_exact=True`）。
- `handbook.md` 中项目 1 和项目 2 标题各保留 1 次，章节顺序有效。
- 未启动服务；未执行需要项目依赖的测试。

材料没有提供原始 Ctrl+S 事件日志，所以“自己保存的版本”只能依据材料中 E02 及其版本关系恢复，无法进一步验证编辑器磁盘事件。
