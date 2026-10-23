#!/usr/bin/env bash
set -euo pipefail
umask 077
backup=${1:?Usage: restore-drill.sh /absolute/path/to/token-board-TIMESTAMP.dump}
container=${TOKEN_BOARD_RESTORE_CONTAINER:-token-board-restore-$(date -u +%Y%m%d%H%M%S)}
database="restore_drill_$(date -u +%Y%m%d_%H%M%S)"
[[ "$backup" == /* && "$backup" == *.dump ]] || exit 1
manifest="${backup%.dump}.manifest.json"
(cd "$(dirname "$backup")" && sha256sum -c "$(basename "${backup%.dump}.sha256")")
# The restore target is a separate PostgreSQL container, never the live service.
[[ "$container" != token-board-service-postgres-1 ]] || { echo "Refusing production restore target" >&2; exit 1; }
owned_container=false
cleanup() {
  docker exec "$container" dropdb --if-exists -U postgres "$database" 2>/dev/null || true
  if "$owned_container"; then docker rm -fv "$container" >/dev/null; fi
}
if [[ -z "${TOKEN_BOARD_RESTORE_CONTAINER:-}" ]]; then
  docker run -d --name "$container" --network none --memory 512m --cpus 0.5 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
  owned_container=true
fi
trap cleanup EXIT
ready=false
for attempt in $(seq 1 30); do
  if docker exec "$container" sh -c '[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres' >/dev/null; then ready=true; break; fi
  sleep 1
done
"$ready" || { echo "Restore database did not become ready" >&2; exit 1; }
docker exec "$container" createdb -U postgres "$database"
docker exec -i "$container" pg_restore --exit-on-error --no-owner --no-acl -U postgres -d "$database" < "$backup"
actual=$(docker exec "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d "$database" -c "SELECT jsonb_build_object('events', count(*), 'input_tokens', coalesce(sum(input_tokens),0), 'output_tokens', coalesce(sum(output_tokens),0), 'total_tokens', coalesce(sum(total_tokens),0), 'user_configs', (SELECT count(*) FROM token_board.user_configs)) FROM token_board.usage_events;")
[[ "$actual" == "$(cat "$manifest")" ]] || { echo "Restore totals do not match the exported snapshot" >&2; exit 1; }
printf 'Restore verified in %s: %s\n' "$database" "$actual"
