#!/bin/sh
# Disposable Docker app/DB, no production ports, files or external integrations.
set -eu
cd "$(dirname "$0")/.."
project="moms-lifecycle-$$"
log=$(mktemp)
compose() { docker compose -p "$project" -f compose.verify.yml "$@"; }
cleanup() { compose down --volumes --rmi local >/dev/null 2>&1 || true; rm -f "$log"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
healthy() {
  attempt=0
  until compose exec -T test-app node -e 'fetch("http://127.0.0.1:3080/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >>"$log" 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then compose logs test-app >>"$log" 2>&1; return 1; fi
    sleep 1
  done
}
check() {
  compose up --build -d test-app >>"$log" 2>&1 || return 1
  healthy || return 1
  compose exec -T test-app node scripts/check-lifecycle.js --http >>"$log" 2>&1 || return 1
  container=$(compose ps -q test-app) || return 1
  compose stop -t 5 test-app >>"$log" 2>&1 || return 1
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 || return 1
  compose start test-app >>"$log" 2>&1 || return 1
  healthy || return 1
  compose stop -t 5 test-app >>"$log" 2>&1 || return 1
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 || return 1
}
if check; then
  echo 'PASS isolated Docker startup, real HTTP drain, SIGTERM exit 0 and restart.'
else
  tail -n 60 "$log"
  exit 1
fi
