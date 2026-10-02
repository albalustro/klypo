#!/usr/bin/env bash
# Sobe um Postgres descartável (se TEST_PG_ADMIN_URL não estiver definido) e roda o comando recebido.
# Requer binários do PostgreSQL 15+ (initdb/pg_ctl). Em Supabase local, veja docs/architecture.md.
set -euo pipefail
if [[ -n "${TEST_PG_ADMIN_URL:-}" ]]; then exec "$@"; fi
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
[[ -z "$BIN" ]] && BIN=$(dirname "$(command -v initdb || true)")
[[ -z "$BIN" || ! -x "$BIN/initdb" ]] && { echo "initdb não encontrado; defina TEST_PG_ADMIN_URL" >&2; exit 2; }
DIR=$(mktemp -d); PORT=${KLYPO_TEST_PG_PORT:-54329}
if [[ $EUID -eq 0 ]]; then
  chown postgres "$DIR"; RUN=(su postgres -c)
  run() { su postgres -c "$*"; }
else run() { bash -c "$*"; }; fi
run "$BIN/initdb -D $DIR/db -A trust -U postgres >/dev/null"
run "$BIN/pg_ctl -D $DIR/db -o '-p $PORT -k $DIR -c fsync=off' -l $DIR/log -w start >/dev/null"
trap 'run "$BIN/pg_ctl -D $DIR/db -m immediate stop >/dev/null" || true; rm -rf "$DIR"' EXIT
export TEST_PG_ADMIN_URL="postgres://postgres@localhost:$PORT/postgres"
# conexão por socket não é necessária: trust em localhost
"$@"
