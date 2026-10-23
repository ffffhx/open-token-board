# Reliability improvements — implementation and verification

User-authorized scope: device-safe replacement, revocable authentication and bound OAuth callbacks, remaining analytics queries, CI/deployment gates, visible data freshness, and PostgreSQL backups with a restore drill.

## Completion evidence (update as work completes)

- [x] Device-scoped replacement; shared-event deduplication; concurrent upload protection; both agents; file and PostgreSQL tests.
- [x] Browser-bound, single-use OAuth state; individual credential revocation and account disablement; API tests.
- [x] Custom-date SQL aggregation, SQL public-profile totals/daily/model/tool aggregation and lightweight team profiles; parity and performance verification.
- [x] Required PostgreSQL integration job and exact-commit CI gate implemented; actionlint 1.7.12 passed. Remote GitHub run awaits publishing these changes. Deployment probe passed against the new live image, requiring 54 newly refreshed snapshots and usable stats.
- [x] Last-updated/stale/error display and focus/visible-tab refresh; Web typecheck passed. ProfilePilot browser verified old-data warning, controlled fetch failure preserving the cached table, and successful recovery clearing the failure. The refresh-controller test verifies foreground focus, visibility changes, polling, throttling and cleanup; the actual browser was hidden during the interaction checks.
- [x] Scheduled PostgreSQL backup, retention, separate-host copy, and isolated restore verification.
- [x] Backend deployment/runtime verification; Web build and local project started for delivery. Frontend, bundled Agent and CI changes remain in the working tree for the normal publish workflow; no repository push or npm publication was performed.

## Device history migration

Pre-upgrade events have no reliable device provenance. Preserve them as unscoped history; do not guess their owner or delete them during a device replacement. Newly collected events record all reporting devices while retaining the canonical event ID. Replacing one device removes an event only when no other device owns it. An account-wide replacement must remain an explicit separate operation.

Both collectors persist a UUID in `<agent-config>.device-id` (override with `TOKEN_BOARD_DEVICE_ID_FILE` or `TOKEN_BOARD_DEVICE_ID`). Keep this file across upgrades and login; do not copy it to another machine. HTTP ingest and replacement carry `deviceId`. Old collectors may still upload incrementally; ambiguous old replacement calls are rejected. An account-wide API replacement requires `replace.scope="account"` and `replace.confirmAccount=<authenticated userId>` on every phase. Revisions prevent an upload or another replacement from being overwritten by an older staged manifest. File storage is for one server process; PostgreSQL uses transactions and user-scoped advisory locks.

## Authentication operations

Browser users can list `GET /api/auth/sessions`, revoke one with `DELETE /api/auth/sessions/<session id>`, or revoke all with `DELETE /api/auth/sessions`. Mutations require `Content-Type: application/json` and a trusted Origin when Origin is present. Session IDs are SHA256 fingerprints; responses and storage never expose bearer tokens. Existing signed credentials are registered on first use without extending their expiration. Logout now revokes the credential rather than only clearing the cookie. Agent `logout` calls `DELETE /api/auth/agent/session` before removing its saved credential.

Operators can run inside the API container:

```
node --import tsx /workspace/apps/token-board-api/src/manage-auth.ts disable github:USER_ID
node --import tsx /workspace/apps/token-board-api/src/manage-auth.ts enable github:USER_ID
node --import tsx /workspace/apps/token-board-api/src/manage-auth.ts revoke-all github:USER_ID
```

Enabling an account does not resurrect revoked credentials. Static legacy upload secrets are operator-managed and must be rotated in server configuration; account disablement also rejects these secrets.

## Verified backup and restore

On 2026-09-14 UTC the production backup `token-board-20260914T155118Z.dump` was restored to a new database inside the separate test PostgreSQL container. The source manifest and dump use the same exported PostgreSQL snapshot. Recovery matched 496,625 events, 58,435,573,047 input tokens, 202,609,231 output tokens, 58,638,182,278 total tokens, and 3 user configs. The temporary restore database was dropped afterward.

- Host: `/home/deploy/token-board-backups`, mode 0700, daily 03:00 Asia/Shanghai via deploy's crontab, seven-day retention. Script: `/home/deploy/token-board-reliability-20260914/backup-postgres.sh`. Logs: `backup.log`.
- Off-host: `C:\Users\aa182\Documents\Codex\Backups\open-token-board`, restricted to the current Windows user and SYSTEM; 30-day retention. Task `OpenTokenBoard-BackupPull`, daily 03:30, starts missed runs when available, retries failed runs. Requires this Windows user to be logged in and the computer/network available.
- Off-host scheduled task was manually started and completed with result 0; copied dump SHA256 matched. `last-success.txt` records the last successful verified copy. Its script is stored in that backup directory's `jobs` subdirectory, independent of this checkout.
- Full restore rehearsal: `bash restore-drill.sh /absolute/path/to/backup.dump` creates its own disposable PostgreSQL container without network access, restores and checks the dump checksum and source totals, then removes the temporary database, container and volume. This self-contained path was also executed successfully. `TOKEN_BOARD_RESTORE_CONTAINER` optionally targets an already-running test container. Never restore over production as a test.

## Checks so far

`pnpm test:api` with a disposable PostgreSQL database and `TOKEN_BOARD_REQUIRE_POSTGRES_TESTS=true`: 66 tests passed, zero failed, zero skipped. Includes custom SQL totals/ranks/day-boundary comparisons across six metrics, 54 snapshot combinations, worker failures, concurrent device replacements, cross-instance auth revocation, profile SQL parity with the original file-backed API, and foreground refresh scheduling. Core/API/Web typechecks and `pnpm build` passed. `pnpm pack:agent` rebuilt the bundled archive.

## Performance and deployment evidence

The isolated restored database contained 496,625 events. Both benchmark processes used 0.75 CPU, 1,200 MiB container memory and a 768 MiB Node heap. This is a single comparative run on a shared host, not an SLA or an exhaustive load test.

| Measurement | Before | After |
| --- | ---: | ---: |
| Custom date calculation, 2026-09-01 through 2026-09-07 | 46,346 ms | 28,638 ms |
| User-directory read | 28,023 ms / 496,625 rows | 3,677 ms / 3 rows |
| Benchmark peak RSS | 843 MiB | 815 MiB |

Token/input/output totals, sessions, active-user count and every daily point matched exactly. Custom calculations still read historical events for badge and other derived calculations; these run in a separate process. A bounded queue merges identical live queries and caches their results for 60 seconds, retaining the original calculation timestamp. Explicit `now` values use distinct cache keys.

After deployment, a custom request took 29,380 ms cold and 76 ms on an identical cache hit. Twenty normal snapshot requests made while it ran had median 8.8 ms and maximum 53.5 ms. Initial live verification found the large user's profile still took 24,766 ms; further SQL aggregation reduced that request to 9,343 ms, returning 365 daily points and five ranking ranges for 412,451 matching records. During that profile query, ten normal snapshot requests had median 4.4 ms and maximum 44.3 ms. Cold custom/profile requests therefore remain materially slower than cached leaderboard reads.

Final deployed image: `token-board-service:reliability-final-20260915`, SHA256 `70daa4bbcba928e871949c00cdadae5f7be8380d430f3a7e5857df0779b965f2`. Rollback image: `token-board-service:before-reliability-20260915`. Source backup and benchmark reports: `/home/deploy/token-board-reliability-20260914/`. Schema additions are compatible with the rollback image. Deployment health probe passed; final health reported 496,668 events, 54 snapshots, no refresh error and a 71.5-second completed refresh.

The disposable integration/benchmark PostgreSQL container, its data volume and SSH tunnel were removed after verification. Local Web dev was restarted and `/board/` returned HTTP 200 at `http://localhost:3001/board/` (port 3000 was already occupied).
