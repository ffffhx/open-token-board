# token-board-agent

`token-board-agent` 是 [Open Token Board](https://ffffhx.github.io/open-token-board/) 的本地采集与同步工具。它读取本机 AI 编码工具的用量日志，生成脱敏事件，上报到你配置的 Token Board API；同时可以同步 Codex / Claude Code 额度快照，提供 MCP server 和 statusLine 短状态。

## 基本用法

```bash
npx --yes token-board-agent install
npx --yes token-board-agent status
npx --yes token-board-agent statusline
npx --yes token-board-agent mcp
npx --yes token-board-agent uninstall
```

`install` 会引导 GitHub Device Flow 登录，并注册后台同步任务：

- macOS：`~/Library/LaunchAgents/dev.ffffhx.token-board-agent.plist`
- Windows：Task Scheduler 任务 `TokenBoardAgent`

安装后后台默认每 5 分钟同步 token 用量、Codex 额度快照，以及可选的 Claude Code 订阅额度快照。

一次性命令：

```bash
npx --yes token-board-agent login
npx --yes token-board-agent upload
npx --yes token-board-agent resync
npx --yes token-board-agent replace
npx --yes token-board-agent collect
npx --yes token-board-agent watch
```

- `upload`：只上传本地 checkpoint 之后的新事件；没有新事件时仍会同步额度快照。
- `resync`：忽略本地上传 checkpoint，重新同步扫描窗口内事件。
- `replace`：用当前采集到的事件替换服务端该用户旧事件；没有采集到事件时不会清空远端。
- `collect`：只打印将要上报的 JSON，不发网络请求。
- `watch`：前台常驻循环，适合临时替代系统后台任务。

## MCP Server

`token-board-agent mcp` 启动 stdio MCP server，复用 `~/.token-board-agent.json` 中保存的 API 地址和 agent token。工具如下：

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `get_leaderboard` | `range=1d|7d|30d|90d`、`metric=tokens|cost|sessions|messages`、`limit` | 查询榜单 Top N。 |
| `get_my_usage` | `range=1d|7d|30d|90d` | 查询当前登录账号的用量、排名、等级、徽章和 PB。 |
| `get_user_profile` | `login` | 查询某个 GitHub login 的公开个人主页摘要。 |
| `get_rate_limits` | 无 | 查询当前账号已同步到服务端的 Codex / Claude Code 额度快照。 |

Claude Code CLI：

```bash
claude mcp add token-board -- npx --yes token-board-agent mcp
```

项目 `.mcp.json`：

```json
{
  "mcpServers": {
    "token-board": {
      "command": "npx",
      "args": ["--yes", "token-board-agent", "mcp"]
    }
  }
}
```

## Claude Code statusLine

`statusline` 会在 800ms 内读取当天个人导出，输出一行短文本，例如：

```text
🏆#3 · 12.4M
```

临时测试：

```bash
npx --yes token-board-agent statusline
```

长期放进 Claude Code statusLine 时，建议指向 `install` 复制到本机的脚本，避免每次都启动 `npx`：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/you/.token-board-agent/token-board-agent.mjs statusline"
  }
}
```

如果本地没有保存登录态，或服务不可达，命令会静默退出。

## Claude Code 订阅额度（statusLine 捕获）

Claude Code 不把订阅额度持久化到本地日志。精确的 5 小时 / 每周额度只会出现在 Claude Code 传给 statusLine 命令的 JSON 里，通常需要 Pro/Max 账号且至少完成一次 API 响应。

非 Windows 平台运行 `install` 时，agent 会生成：

```text
~/.token-board-agent/claude-statusline-capture.sh
```

这个捕获脚本会：

1. 从 statusLine stdin JSON 中提取 `rate_limits`。
2. 在确有 `five_hour` 或 `seven_day` 窗口时写入 `~/.token-board-agent/claude-rate-limits.json`。
3. 把同一份 stdin 继续透传给你原有的 statusLine 命令，保持显示不变。

接入方式：

```json
{
  "statusLine": {
    "type": "command",
    "command": "/Users/you/.token-board-agent/claude-statusline-capture.sh"
  }
}
```

重新运行 `install` 会重新生成捕获脚本，并尽量保留你原来的 statusLine 命令作为 passthrough。也可以用 `TOKEN_BOARD_INNER_STATUSLINE=/path/to/statusline` 显式指定内层命令。

## 默认采集源

agent 会扫描最近一段时间内存在的本地日志目录：

| 来源 | 标识 | 默认路径 |
| --- | --- | --- |
| Codex CLI | `codex` | `~/.codex/sessions`、`~/.codex/archived_sessions`、`~/.codex/projects`、`$CODEX_HOME/sessions`、`$CODEX_HOME/archived_sessions`，以及 Orca runtime home |
| Claude Code | `claude-code` | `~/.claude/projects`、`~/.claude/history.jsonl` |
| Gemini CLI | `gemini-cli` | `${GEMINI_DATA_DIR}`、`${GEMINI_CLI_HOME}/tmp`、`~/.gemini/tmp` |
| opencode | `opencode` | `${OPENCODE_DATA_DIR}`、`~/.local/share/opencode`，识别 `opencode*.db` 和 legacy `storage/message/**/*.json` |
| Cursor | `cursor` | 各平台 Cursor `globalStorage` 与 `logs` |
| Trae sampled | `trae-sampled` | 各平台 Trae 可能的累计计数目录，按本地状态文件做差分采样 |

查看当前机器发现了哪些文件：

```bash
npx --yes token-board-agent status
```

自定义采集路径：

```bash
TOKEN_BOARD_USAGE_PATHS=/path/to/logs npx --yes token-board-agent upload
TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES=false TOKEN_BOARD_USAGE_PATHS=/path/to/logs npx --yes token-board-agent upload
TOKEN_BOARD_TRAE_SAMPLER=false npx --yes token-board-agent upload
```

## 上报内容

默认上传的事件用于排行榜和个人分析，包含：

- token 数：输入、缓存写入、缓存读取、输出、reasoning 输出、总量。
- 元数据：模型、工具/来源、项目 basename、会话短标题、时间戳、估算费用。
- 会话 ID：服务端默认 hash。
- 用户配置：agent 版本、平台、Codex 配置摘要、Codex 额度快照、可选 Claude Code 额度快照。

默认不上传：

- prompt 正文和模型回复正文。
- 文件内容、完整项目路径、环境变量和密钥。
- 原始日志文件。

本地 agent 可直接控制的隐私项：

```bash
TOKEN_BOARD_INCLUDE_SESSION_TITLE=false npx --yes token-board-agent upload
```

服务端 ingest 还会再次脱敏，可由部署方配置：

```bash
TOKEN_BOARD_PROJECT_MODE=basename      # basename | hash | none
TOKEN_BOARD_INCLUDE_MODEL=true
TOKEN_BOARD_INCLUDE_SOURCE=true
TOKEN_BOARD_HASH_SESSION_ID=true
TOKEN_BOARD_INCLUDE_SESSION_TITLE=true
```

## 配置

默认值：

- API：`https://124-221-36-36.anyip.dev:8443/token-board`
- 榜单：`https://ffffhx.github.io/open-token-board/board/`
- 配置文件：`~/.token-board-agent.json`
- 上传状态：`~/.token-board-agent-state.json`
- 同步间隔：5 分钟

常用环境变量：

```bash
TOKEN_BOARD_API_URL=https://your-api.example.com/token-board
TOKEN_BOARD_LEADERBOARD_URL=https://your-site.example.com/board/
TOKEN_BOARD_AGENT_CONFIG=/path/to/config.json
TOKEN_BOARD_AGENT_STATE_FILE=/path/to/state.json
TOKEN_BOARD_INTERVAL_MS=300000
TOKEN_BOARD_SINCE_HOURS=720
TOKEN_BOARD_MAX_FILES=800
TOKEN_BOARD_MAX_FILE_BYTES=5242880
TOKEN_BOARD_MAX_CODEX_FILE_BYTES=268435456
TOKEN_BOARD_FETCH_TIMEOUT_MS=30000
TOKEN_BOARD_HEALTHCHECK=false
```

采集源环境变量：

```bash
CODEX_HOME=/path/to/codex-home
GEMINI_DATA_DIR=/path/to/gemini/tmp
GEMINI_CLI_HOME=/path/to/gemini-home
OPENCODE_DATA_DIR=/path/to/opencode
TOKEN_BOARD_USAGE_PATHS=/path/a,/path/b
TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES=false
TOKEN_BOARD_TRAE_SAMPLER=false
```

Claude Code 额度捕获：

```bash
CLAUDE_CONFIG_DIR=/path/to/.claude
TOKEN_BOARD_CC_SNAPSHOT=/path/to/claude-rate-limits.json
TOKEN_BOARD_INNER_STATUSLINE=/path/to/existing-statusline
```

## 卸载

```bash
npx --yes token-board-agent uninstall
```

卸载会删除后台任务和安装到 `~/.token-board-agent/token-board-agent.mjs` 的脚本。它会保留本地授权配置和上传状态文件，方便以后重新安装继续使用。

## License

UNLICENSED
