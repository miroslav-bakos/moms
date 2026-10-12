#!/bin/sh
# Desktop supervisor and real app against a disposable DB. No host ports or production volumes.
set -eu
cd "$(dirname "$0")/.."
project="moms-desktop-$$"
log=$(mktemp)
compose() { docker compose -p "$project" -f compose.verify.yml "$@"; }
cleanup() { compose down --volumes --rmi local >/dev/null 2>&1 || true; rm -f "$log"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
healthy() {
  attempt=0
  until compose exec -T test-desktop node -e 'fetch("http://127.0.0.1:3080/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >>"$log" 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then return 1; fi
    sleep 1
  done
}
check() {
  compose up --build -d test-desktop >>"$log" 2>&1 || return 1
  healthy || return 1
  compose exec -T test-desktop node scripts/check-desktop.js --app >>"$log" 2>&1 || return 1
  container=$(compose ps -q test-desktop) || return 1
  compose exec -T test-desktop node scripts/desktop.js stop >>"$log" 2>&1 || return 1
  attempt=0
  while [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ]; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 10 ] || return 1; sleep 1
  done
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 || return 1
  compose start test-desktop >>"$log" 2>&1 || return 1
  healthy || return 1
  compose stop -t 70 test-desktop >>"$log" 2>&1 || return 1
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 || return 1
}
if check; then
  echo 'PASS isolated desktop app startup, IPC restart/stop, worker recovery, data preservation and SIGTERM exit 0.'
else
  compose logs test-desktop >>"$log" 2>&1 || true
  tail -n 60 "$log"
  exit 1
fi
