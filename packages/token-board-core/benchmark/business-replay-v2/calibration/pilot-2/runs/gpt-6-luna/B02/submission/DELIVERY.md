# Snapshot refresh delivery

The refresh originally built all 54 range/metric combinations sequentially. Each PostgreSQL-backed combination ran the same range aggregation, prior-period aggregation, event detail reads, trends, achievements, efficiency, team, project, and distribution work; only the user ranking and rank delta depended on the metric. That repeated database work dominated the measured refresh.

The PostgreSQL store now computes one complete result set per range for all six metrics. Shared query results and all non-ranking summary fields are built once; each metric still gets its own current and prior ranking, rank delta, and user ordering. The API refresh processes ranges serially, publishes the new 54-entry cache only after every range succeeds, and inserts entries in the established range/metric order. Existing HTTP reads continue serving the previous full cache while refresh is in progress.

All 54 serialized snapshot entries match the baseline after canonical JSON key ordering: SHA-256 `afdb236d9fce5034a24d5c930e50b5324a5241b86660c68299d4cf65aa09ec35` for both. This comparison includes every summary field, metric, range, user ordering, records count, costs, trends, achievements, efficiency, and dimensions.

## Measurement

Both runs used the same Windows machine, embedded PostgreSQL 16.14, 3,905 deterministic events, the frozen business time `2026-09-14T12:00:00.000Z`, and `Asia/Shanghai`. `pnpm measure` performed its documented warmup and then seven external refresh timings. The retained raw files are `artifacts/baseline-measurement.json` and `artifacts/measurement.json`.

| Round | Baseline ms | Candidate ms | Improvement ms |
|---:|---:|---:|---:|
| 1 | 6677.783 | 1309.530 | 5368.254 |
| 2 | 6560.941 | 1261.205 | 5299.736 |
| 3 | 6863.049 | 1254.922 | 5608.127 |
| 4 | 6733.343 | 1339.342 | 5394.001 |
| 5 | 6524.485 | 1418.718 | 5105.767 |
| 6 | 6439.841 | 1420.918 | 5018.923 |
| 7 | 6419.908 | 1399.467 | 5020.441 |

Median refresh time fell from 6560.941 ms to 1339.342 ms (79.59%). All seven paired rounds improved. The paired difference median was 5299.736 ms and its MAD was 193.969 ms, so the median difference exceeded 3×MAD. Refresh-time reads had HTTP 200 for all 172 candidate reads; candidate read P95 was 64.441 ms, below the 100 ms limit (`max(100 ms, baseline P95 × 1.3)`). The retained baseline read P95 was 50.563 ms.

Reproduce with `pnpm measure`, then run `node tests/replay/compare-measurements.mjs` to compare the retained baseline and latest candidate. `pnpm typecheck` passed.

## Scope and limits

The replay validates the supplied synthetic dataset, full 54-entry compatibility, refresh-time reads, and the replay's configured database/service lifecycle. The paired replay does not independently exercise every requested adversarial scenario such as query failure/recovery, overlapping writes, or process restart; those remain for independent replay acceptance. CPU and RSS fields in measurement artifacts cover the API process and do not include PostgreSQL resource use.

The local service is running from `pnpm dev` at `http://127.0.0.1:59061`. Visit `/api/usage/leaderboard?range=today&metric=tokens` or `/api/usage/health`.
