# token-board-agent

Local token usage and Codex quota uploader for [Open Token Board](https://ffffhx.github.io/open-token-board/).

## Usage

```bash
npx --yes token-board-agent install
npx --yes token-board-agent status
npx --yes token-board-agent uninstall
```

`install` guides you through GitHub device login and registers a background sync task. After that one-time install, the task keeps syncing token usage and the latest Codex 5h/weekly quota snapshot:

- macOS: LaunchAgent under `~/Library/LaunchAgents/dev.ffffhx.token-board-agent.plist`
- Windows: Task Scheduler task named `TokenBoardAgent`

You can also run one-off commands:

```bash
npx --yes token-board-agent login
npx --yes token-board-agent upload
npx --yes token-board-agent resync
npx --yes token-board-agent replace
npx --yes token-board-agent collect
npx --yes token-board-agent watch
```

## What It Reads

The agent scans local usage records from supported AI coding tools when their default data folders exist:

- Codex CLI: `~/.codex/sessions`, `~/.codex/archived_sessions`, `~/.codex/projects`
- Claude Code: `~/.claude/projects`, `~/.claude/history.jsonl`

You can override scan targets with `TOKEN_BOARD_USAGE_PATHS` or disable default targets with:

```bash
TOKEN_BOARD_INCLUDE_DEFAULT_SOURCES=false npx --yes token-board-agent upload
```

## Claude Code Subscription Quota (statusLine capture)

Claude Code does not persist subscription rate limits to disk — the exact 5h / weekly
usage only appears in the JSON that Claude Code pipes to a `statusLine` command (for
Pro/Max accounts, after the first API response). On install (non-Windows), the agent
writes a capture shim to `~/.token-board-agent/claude-statusline-capture.sh` that:

1. snapshots the `rate_limits` block to `~/.token-board-agent/claude-rate-limits.json`
   (offline, no network, no auth), and
2. passes the same stdin through to your existing statusLine so the display is unchanged.

To enable capture, point `statusLine.command` in `~/.claude/settings.json` at the shim:

```json
{ "statusLine": { "type": "command", "command": "/Users/you/.token-board-agent/claude-statusline-capture.sh" } }
```

Re-running `install` regenerates the shim and preserves your previous statusLine command
as the passthrough target (override with `TOKEN_BOARD_INNER_STATUSLINE`). The background
sync then uploads the snapshot, surfacing the precise quota on the site's `/claude-limits`
page. Note: Claude Code does **not** emit a `rate_limits_available` flag — presence of the
`rate_limits` object is the only signal, so the shim writes a snapshot only when at least
one window is present.

## What It Uploads

The uploaded event payload is designed for usage ranking and personal insight. It includes token counts, model/tool/source metadata, timestamps, anonymized session identifiers, project basename information, a Codex rate-limit snapshot derived from local `~/.codex` logs, and (when configured) a Claude Code subscription quota snapshot captured via the statusLine shim.

By default, the agent does not upload full prompt text or absolute project paths. Session titles may be included as short labels when available. You can disable them with:

```bash
TOKEN_BOARD_INCLUDE_SESSION_TITLE=false npx --yes token-board-agent upload
```

Other useful privacy controls:

```bash
TOKEN_BOARD_PROJECT_MODE=hidden npx --yes token-board-agent upload
TOKEN_BOARD_INCLUDE_MODEL=false npx --yes token-board-agent upload
TOKEN_BOARD_INCLUDE_SOURCE=false npx --yes token-board-agent upload
TOKEN_BOARD_HASH_SESSION_ID=true npx --yes token-board-agent upload
```

## Configuration

Defaults:

- API: `https://8-218-149-148.anyip.dev/token-board`
- Leaderboard: `https://ffffhx.github.io/open-token-board/board/`
- Config file: `~/.token-board-agent.json`
- State file: `~/.token-board-agent-state.json`
- Sync interval: 5 minutes

Common environment overrides:

```bash
TOKEN_BOARD_API_URL=https://your-api.example.com/token-board
TOKEN_BOARD_LEADERBOARD_URL=https://your-site.example.com/board/
TOKEN_BOARD_AGENT_CONFIG=/path/to/config.json
TOKEN_BOARD_AGENT_STATE_FILE=/path/to/state.json
TOKEN_BOARD_INTERVAL_MS=300000
TOKEN_BOARD_MAX_FILES=800
TOKEN_BOARD_MAX_FILE_BYTES=5242880
```

## Uninstall

```bash
npx --yes token-board-agent uninstall
```

Uninstall removes the background task and installed helper script. It keeps local auth/config/state files so reinstalling can continue from the previous account and upload checkpoint.

## License

UNLICENSED
