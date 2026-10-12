#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
project="moms-managed-desktop-$$"
log=$(mktemp)
compose() { docker compose -p "$project" -f compose.verify.yml "$@"; }
cleanup() { compose down --volumes --rmi local >/dev/null 2>&1 || true; rm -f "$log"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
healthy() {
  attempt=0
  until compose exec -T test-managed-desktop node -e 'fetch("http://127.0.0.1:3080/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >>"$log" 2>&1; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || return 1; sleep 1
  done
}
check() {
  compose up --build -d test-managed-desktop >>"$log" 2>&1 || return 1
  healthy || return 1
  compose exec -T test-managed-desktop node scripts/check-managed-desktop.js >>"$log" 2>&1 || return 1
  container=$(compose ps -q test-managed-desktop) || return 1
  compose stop -t 70 test-managed-desktop >>"$log" 2>&1 || return 1
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 || return 1
  compose start test-managed-desktop >>"$log" 2>&1 || return 1
  healthy || return 1
  compose stop -t 70 test-managed-desktop >>"$log" 2>&1 || return 1
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 || return 1
}
if check; then
  echo 'PASS isolated managed desktop bootstrap, full database regression, data preservation and graceful PostgreSQL/application shutdown.'
else
  # Application stdout contains only bootstrap diagnostics; never print connection.json or .env.
  compose logs test-managed-desktop >>"$log" 2>&1 || true
  tail -n 60 "$log"; exit 1
fi
