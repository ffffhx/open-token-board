# Token Board 真实评测任务集

每个任务是一个**可自动判分的沙盒编程题**。评测器会把 `workspace/` 拷到临时目录，
真实调用 Codex / Claude Code 让其完成 `prompt`，然后用**隐藏的** `verify/` 脚本判分。

## 目录结构

```
tasks/<task-id>/
  meta.json        # 元数据 + 判分配置（见下）
  workspace/       # 交给 agent 的初始文件（含 bug / 缺失实现）
  verify/          # 隐藏校验脚本，判分时才拷入临时目录（agent 看不到）
  solution/        # 参考答案（仅用于 validate，runner 不使用）
```

## meta.json 字段

```jsonc
{
  "id": "ts-range-merge",
  "title": "中文标题",
  "shortTitle": "短标题",
  "kind": "typescript-fix",      // typescript-fix | code-reading | ui-typecheck |
                                 // ambiguity-control | long-context | refactor | algorithm
  "difficulty": "low",           // low | medium | high
  "prompt": "交给 agent 的指令（不要泄露隐藏测试细节）",
  "allowedFiles": ["src/range-label.mjs"],  // 允许改动的文件（glob）；用于范围控制判分
  "verify": {
    "cmd": "node verify/verify.mjs",   // 退出码 0 = 通过
    "rootCauseRegex": "off-by|边界|连续"  // 可选：匹配 agent 最终回答 => rootCauseLocated
  },
  "timeoutSeconds": 300,
  "weights": {                   // IQ 评分权重（与现有 codex-benchmark 对齐）
    "tests": 30, "firstPass": 20, "scopeControl": 20,
    "instructionFollowing": 15, "rootCause": 10, "pathEfficiency": 5
  },
  "speedTargets": {
    "targetFirstActionSeconds": 20, "maxFirstActionSeconds": 90,
    "targetDurationSeconds": 120, "maxDurationSeconds": 420,
    "targetCommandWaitSeconds": 4, "maxCommandWaitSeconds": 40,
    "targetOutputTokensPerSecond": 18, "floorOutputTokensPerSecond": 6
  }
}
```

## 设计约束（务必遵守）

- **纯 Node、零依赖**：`verify` 与 `workspace` 只能用 Node 内置模块，不得 `npm install`、不得联网。
- **ESM `.mjs`**：所有可执行文件用 `.mjs`。
- **隐藏测试**：`verify/` 里的断言 agent 看不到，`prompt` 不要描述测试细节，只描述需求。
- **可判分**：`verify/verify.mjs` 必须 import `workspace` 里的目标文件并断言行为，
  通过 `process.exit(0)`，失败 `process.exit(1)` 并向 stderr 打印一行原因。
- **solution 必过、workspace 必挂**：validate 会校验
  `verify(solution) == pass` 且 `verify(原始 workspace) == fail`。
- **范围可控**：题目应能只改 `allowedFiles` 内文件即可完成。

判分产出 `CodexBenchmarkTaskResult`（见 `src/codex-benchmark.ts`）。
