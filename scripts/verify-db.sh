#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
project="moms-verify-$$"
log=$(mktemp)
cleanup() { docker compose -p "$project" -f compose.verify.yml down --volumes --rmi local >/dev/null 2>&1 || true; rm -f "$log"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if docker compose -p "$project" -f compose.verify.yml run --build --rm verify >"$log" 2>&1; then
  sed -n '/^PASS /p' "$log"
else
  tail -n 100 "$log"
  exit 1
fi
