#!/usr/bin/env bash
set -euo pipefail
umask 077
container=${TOKEN_BOARD_POSTGRES_CONTAINER:-token-board-service-postgres-1}
backup_dir=${TOKEN_BOARD_BACKUP_DIR:-/home/deploy/token-board-backups}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
prefix="$backup_dir/token-board-$stamp"

# Keep an exported snapshot open so the dump and verification totals refer to
# exactly the same committed database state, even while agents are uploading.
coproc DBTX { docker exec -i "$container" sh -c 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
tx_pid=$DBTX_PID
exec {tx_input}>&"${DBTX[1]}"
exec {tx_output}<&"${DBTX[0]}"
cleanup() {
  printf 'ROLLBACK;\n\\q\n' >&"$tx_input" 2>/dev/null || true
  wait "$tx_pid" 2>/dev/null || true
  rm -f -- "$prefix.dump.partial" "$prefix.manifest.partial"
}
trap cleanup EXIT
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n' >&"$tx_input"
read -r -u "$tx_output" snapshot
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo "Invalid exported snapshot" >&2; exit 1; }
verification_sql="SELECT jsonb_build_object('events', count(*), 'input_tokens', coalesce(sum(input_tokens),0), 'output_tokens', coalesce(sum(output_tokens),0), 'total_tokens', coalesce(sum(total_tokens),0), 'user_configs', (SELECT count(*) FROM token_board.user_configs)) FROM token_board.usage_events;"
printf '%s\n' "$verification_sql" >&"$tx_input"
read -r -u "$tx_output" totals
printf '%s\n' "$totals" > "$prefix.manifest.partial"
docker exec "$container" sh -c 'exec pg_dump -Fc -Z 6 --no-owner --no-acl --snapshot="$1" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' sh "$snapshot" > "$prefix.dump.partial"
docker exec -i "$container" pg_restore --list < "$prefix.dump.partial" >/dev/null
printf 'COMMIT;\n\\q\n' >&"$tx_input"
wait "$tx_pid"
trap - EXIT
mv -- "$prefix.dump.partial" "$prefix.dump"
mv -- "$prefix.manifest.partial" "$prefix.manifest.json"
(cd "$backup_dir" && sha256sum "token-board-$stamp.dump" > "token-board-$stamp.sha256")
printf '%s\n' "$prefix.dump" > "$backup_dir/latest"
# Only known artifacts in this dedicated directory; preserve the newest backup.
find "$backup_dir" -maxdepth 1 -type f -name 'token-board-*' -mtime +7 ! -name "token-board-$stamp.*" -delete
printf 'Backup completed: %s\n' "token-board-$stamp.dump"
