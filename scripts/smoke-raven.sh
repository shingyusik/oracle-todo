#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'smoke-raven: %s\n' "$*" >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$repo_root/target/release/raven"
smoke_home="${1:-}"
marker=".raven-smoke-home"
marker_value="raven-smoke-v1"
api_pid=""

cleanup() {
  if [[ -n "$api_pid" ]]; then
    if kill -0 "$api_pid" 2>/dev/null; then
      kill "$api_pid" 2>/dev/null || true
    fi
    wait "$api_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

[[ -n "$smoke_home" ]] || fail "an explicit smoke home argument is required"
[[ "$smoke_home" = /* ]] || fail "smoke home must be an absolute path"
[[ -d "$smoke_home" ]] || fail "smoke home must already exist"
smoke_home="$(cd -P "$smoke_home" && pwd)"
temp_root="$(cd -P "${TMPDIR:-/tmp}" && pwd)"
physical_home="$(cd -P "$HOME" && pwd)"
default_home="$physical_home/.raven"
[[ ! -d "$default_home" ]] || default_home="$(cd -P "$default_home" && pwd)"
[[ "$smoke_home" == "$temp_root/"* ]] || fail "smoke home must be inside the system temp directory"
[[ "$smoke_home" != "/" && "$smoke_home" != "$physical_home" && "$smoke_home" != "$default_home" ]] ||
  fail "refusing a live or broad path"
[[ -f "$smoke_home/$marker" && ! -L "$smoke_home/$marker" ]] || fail "smoke home marker is missing"
[[ "$(<"$smoke_home/$marker")" == "$marker_value" ]] || fail "smoke home marker is invalid"
[[ "$(find "$smoke_home" -mindepth 1 -maxdepth 1 ! -name "$marker" -print -quit)" == "" ]] ||
  fail "smoke home must be empty except for its marker"
[[ -x "$binary" ]] || fail "release binary is missing; run cargo build --release -p raven-cli"
command -v curl >/dev/null || fail "curl is required"
command -v python3 >/dev/null || fail "python3 is required"

export RAVEN_CONSOLE_LOG=off

"$binary" --home "$smoke_home" init >/dev/null
todo_output="$("$binary" --home "$smoke_home" todo area create "Smoke Area")"
todo_list="$("$binary" --home "$smoke_home" todo list)"
[[ "$todo_output" == *"Smoke Area"* && "$todo_list" == *"Smoke Area"* ]] ||
  fail "ToDo create/list smoke failed"

"$binary" --home "$smoke_home" ledger currency create \
  --code KRW --name Won --symbol W --decimal-places 0 >/dev/null
"$binary" --home "$smoke_home" ledger account-category create --name Cash >/dev/null
"$binary" --home "$smoke_home" ledger account create \
  --name Wallet --category Cash --currency KRW --opening-balance 0 >/dev/null
"$binary" --home "$smoke_home" ledger category create \
  --name Food --kind expense >/dev/null
"$binary" --home "$smoke_home" ledger entry add \
  --date 2026-07-31 --type expense --amount 314159 --currency KRW \
  --account Wallet --category Food --content SmokeLedgerSecret >/dev/null
ledger_json="$("$binary" --home "$smoke_home" ledger entry list --format json)"
doctor_json="$("$binary" --home "$smoke_home" ledger doctor --format json)"
LEDGER_JSON="$ledger_json" DOCTOR_JSON="$doctor_json" python3 - <<'PY'
import json
import os

entries = json.loads(os.environ["LEDGER_JSON"])
doctor = json.loads(os.environ["DOCTOR_JSON"])
assert len(entries["items"]) == 1
assert entries["items"][0]["content"] == "SmokeLedgerSecret"
assert entries["items"][0]["amount_minor"] == 314159
assert doctor["healthy"] is True
PY

"$binary" --home "$smoke_home" health diet add \
  --at 2026-07-31T12:00:00+09:00 --meal lunch --food SmokeFoodSecret >/dev/null
"$binary" --home "$smoke_home" health metric add \
  --at 2026-07-31T08:00:00+09:00 --category weight --key weight \
  --name Weight --value 67.89 --unit kg >/dev/null
timeline_json="$("$binary" --home "$smoke_home" health timeline --format json)"
trends_json="$("$binary" --home "$smoke_home" health trends --days 30 --format json)"
TIMELINE_JSON="$timeline_json" TRENDS_JSON="$trends_json" python3 - <<'PY'
import json
import os

timeline = json.loads(os.environ["TIMELINE_JSON"])
trends = json.loads(os.environ["TRENDS_JSON"])
assert {item["kind"] for item in timeline} == {"diet", "health_event"}
assert trends["days"] == 30
PY

health_output="$("$binary" --home "$smoke_home" health-check)"
[[ "$health_output" == *"todo=ok"* && "$health_output" == *"ledger=ok"* &&
  "$health_output" == *"health=ok"* && "$health_output" == *"media=ok"* ]] ||
  fail "health-check did not report all stores ready"

test -f "$smoke_home/todo.sqlite"
test -f "$smoke_home/ledger.sqlite"
test -f "$smoke_home/health.sqlite"
test -d "$smoke_home/media/health"
test -d "$smoke_home/logs"
test -f "$smoke_home/logs/raven.log.jsonl"

port="$(python3 - <<'PY'
import socket

with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    print(listener.getsockname()[1])
PY
)"
token="raven-smoke-token-0123456789"
api_stdout="$smoke_home/api.stdout"
api_stderr="$smoke_home/api.stderr"
RAVEN_API_TOKEN="$token" \
RAVEN_API_BIND_HOST=127.0.0.1 \
RAVEN_API_BIND_PORT="$port" \
  "$binary" --home "$smoke_home" api >"$api_stdout" 2>"$api_stderr" &
api_pid=$!
base_url="http://127.0.0.1:$port"

ready=false
for _ in $(seq 1 100); do
  if curl --fail --silent "$base_url/healthz" >"$smoke_home/healthz.json"; then
    ready=true
    break
  fi
  kill -0 "$api_pid" 2>/dev/null || fail "API process exited before becoming ready"
  sleep 0.05
done
[[ "$ready" == true ]] || fail "API did not become ready"

unauthorized_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$base_url/api/v1/dashboard")"
[[ "$unauthorized_status" == 401 ]] || fail "API accepted an unauthenticated request"

auth_header="Authorization: Bearer $token"
dashboard_json="$(curl --fail --silent --header "$auth_header" "$base_url/api/v1/dashboard")"
todo_api_json="$(curl --fail --silent --header "$auth_header" "$base_url/api/v1/todo/health")"
ledger_api_json="$(curl --fail --silent --header "$auth_header" \
  "$base_url/api/v1/ledger/entries?limit=1")"
health_api_json="$(curl --fail --silent --header "$auth_header" \
  "$base_url/api/v1/health/timeline?limit=1")"
DASHBOARD_JSON="$dashboard_json" TODO_API_JSON="$todo_api_json" \
LEDGER_API_JSON="$ledger_api_json" HEALTH_API_JSON="$health_api_json" python3 - <<'PY'
import json
import os

dashboard = json.loads(os.environ["DASHBOARD_JSON"])
assert all(dashboard[name]["status"] == "ok" for name in ("todo", "ledger", "health"))
assert json.loads(os.environ["TODO_API_JSON"])["ok"] is True
assert len(json.loads(os.environ["LEDGER_API_JSON"])["items"]) == 1
assert len(json.loads(os.environ["HEALTH_API_JSON"])["items"]) == 1
PY

cleanup
api_pid=""

for secret in SmokeLedgerSecret 314159 SmokeFoodSecret 67.89; do
  if grep -R -F -q -- "$secret" "$smoke_home/logs"; then
    fail "sensitive seeded value appeared in logs"
  fi
done
LOG_DIR="$smoke_home/logs" python3 - <<'PY'
import json
import os
from pathlib import Path

for path in Path(os.environ["LOG_DIR"]).glob("raven.log.jsonl*"):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            json.loads(line)
PY

printf 'Raven smoke passed: %s\n' "$smoke_home"
