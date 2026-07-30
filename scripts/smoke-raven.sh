#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'smoke-raven: %s\n' "$*" >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$repo_root/target/release/raven"
ui_path="$repo_root/frontend/out"
smoke_home="${1:-}"
marker=".raven-smoke-home"
api_pid=""
ui_pid=""

stop_child() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.05
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  stop_child "$ui_pid"
  stop_child "$api_pid"
  ui_pid=""
  api_pid=""
}

on_signal() {
  local status="$1"
  trap - EXIT INT TERM
  cleanup
  exit "$status"
}

trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

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
[[ "$(<"$smoke_home/$marker")" == "raven-smoke-v1" ]] || fail "smoke home marker is invalid"
[[ "$(find "$smoke_home" -mindepth 1 -maxdepth 1 ! -name "$marker" -print -quit)" == "" ]] ||
  fail "smoke home must be empty except for its marker"
[[ -x "$binary" ]] || fail "release binary is missing; run cargo build --release -p raven-cli"
[[ -f "$ui_path/index.html" ]] || fail "frontend artifact is missing; run npm --prefix frontend run build"
command -v curl >/dev/null || fail "curl is required"
command -v python3 >/dev/null || fail "python3 is required"
curl_args=(--connect-timeout 1 --max-time 5)

export RAVEN_CONSOLE_LOG=off
read -r current_date current_time < <(python3 - <<'PY'
from datetime import datetime, timedelta, timezone

now = datetime.now(timezone(timedelta(hours=9))).replace(microsecond=0)
print(now.date().isoformat(), now.isoformat())
PY
)

"$binary" --home "$smoke_home" init >/dev/null
area_json="$("$binary" --home "$smoke_home" todo area create "Smoke Area")"
task_json="$("$binary" --home "$smoke_home" todo task propose \
  "Smoke Today Task" --area "Smoke Area" --scheduled "$current_date")"
todo_list="$("$binary" --home "$smoke_home" todo list)"
[[ "$todo_list" == *"Smoke Area"* && "$todo_list" == *"Smoke Today Task"* ]] ||
  fail "ToDo create/list smoke failed"
todo_id="$(TASK_JSON="$task_json" python3 -c 'import json,os; print(json.loads(os.environ["TASK_JSON"])["id"])')"

"$binary" --home "$smoke_home" ledger currency create \
  --code KRW --name Won --symbol W --decimal-places 0 >/dev/null
"$binary" --home "$smoke_home" ledger account-category create --name Cash >/dev/null
"$binary" --home "$smoke_home" ledger account create \
  --name Wallet --category Cash --currency KRW --opening-balance 0 >/dev/null
"$binary" --home "$smoke_home" ledger category create --name Food --kind expense >/dev/null
ledger_created="$("$binary" --home "$smoke_home" ledger entry add \
  --date "$current_date" --type expense --amount 314159 --currency KRW \
  --account Wallet --category Food --content SmokeLedgerSecret)"
ledger_id="$(LEDGER_CREATED="$ledger_created" python3 -c \
  'import json,os; print(json.loads(os.environ["LEDGER_CREATED"])["id"])')"
ledger_json="$("$binary" --home "$smoke_home" ledger entry list --format json)"
doctor_json="$("$binary" --home "$smoke_home" ledger doctor --format json)"

diet_created="$("$binary" --home "$smoke_home" health diet add \
  --at "$current_time" --meal lunch --food SmokeFoodSecret --tags smoke-diet-tag)"
diet_id="$(DIET_CREATED="$diet_created" python3 -c \
  'import json,os; print(json.loads(os.environ["DIET_CREATED"])["id"])')"
weight_created="$("$binary" --home "$smoke_home" health metric add \
  --at "$current_time" --category weight --key weight --name SmokeWeight \
  --value 67.89 --unit kg)"
weight_id="$(WEIGHT_CREATED="$weight_created" python3 -c \
  'import json,os; print(json.loads(os.environ["WEIGHT_CREATED"])["id"])')"
condition_created="$("$binary" --home "$smoke_home" health metric add \
  --at "$current_time" --category overall_condition --name SmokeCondition --value 7)"
condition_id="$(CONDITION_CREATED="$condition_created" python3 -c \
  'import json,os; print(json.loads(os.environ["CONDITION_CREATED"])["id"])')"
timeline_json="$("$binary" --home "$smoke_home" health timeline --format json)"
trends_json="$("$binary" --home "$smoke_home" health trends --days 30 --format json)"

TASK_JSON="$task_json" TODO_ID="$todo_id" CURRENT_DATE="$current_date" \
LEDGER_JSON="$ledger_json" LEDGER_ID="$ledger_id" DOCTOR_JSON="$doctor_json" \
TIMELINE_JSON="$timeline_json" DIET_ID="$diet_id" WEIGHT_ID="$weight_id" \
CONDITION_ID="$condition_id" TRENDS_JSON="$trends_json" python3 - <<'PY'
import json
import os

task = json.loads(os.environ["TASK_JSON"])
assert task["id"] == os.environ["TODO_ID"]
assert task["title"] == "Smoke Today Task"
assert task["scheduled"] == os.environ["CURRENT_DATE"]

entries = json.loads(os.environ["LEDGER_JSON"])["items"]
assert len(entries) == 1
assert entries[0]["id"] == os.environ["LEDGER_ID"]
assert entries[0]["content"] == "SmokeLedgerSecret"
assert entries[0]["amount_minor"] == 314159
assert entries[0]["date"] == os.environ["CURRENT_DATE"]
assert json.loads(os.environ["DOCTOR_JSON"])["healthy"] is True

timeline = json.loads(os.environ["TIMELINE_JSON"])
records = {item["record"]["id"]: item["record"] for item in timeline}
assert records[os.environ["DIET_ID"]]["food_name"] == "SmokeFoodSecret"
assert records[os.environ["WEIGHT_ID"]]["value_num"] == 67.89
assert records[os.environ["CONDITION_ID"]]["value_num"] == 7

trends = json.loads(os.environ["TRENDS_JSON"])
assert any(item["name"] == "smoke-diet-tag" and item["count"] == 1
           for item in trends["top_diet_tags"])
assert any(series["metric_key"] == "weight"
           and any(point["value"] == 67.89 for point in series["points"])
           for series in trends["numeric_series"])
PY

health_output="$("$binary" --home "$smoke_home" health-check)"
[[ "$health_output" == *"todo=ok"* && "$health_output" == *"ledger=ok"* &&
  "$health_output" == *"health=ok"* && "$health_output" == *"media=ok"* ]] ||
  fail "health-check did not report all stores ready"
test -f "$smoke_home/todo.sqlite"
test -f "$smoke_home/ledger.sqlite"
test -f "$smoke_home/health.sqlite"
test -d "$smoke_home/media/health"
test -f "$smoke_home/logs/raven.log.jsonl"

token="$(python3 -c 'import secrets; print("raven-smoke-" + secrets.token_hex(24))')"
api_stdout="$smoke_home/api.stdout"
api_stderr="$smoke_home/api.stderr"
api_ready=false
for _ in $(seq 1 5); do
  port="$(python3 - <<'PY'
import socket
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    print(listener.getsockname()[1])
PY
)"
  : >"$api_stdout"
  : >"$api_stderr"
  RAVEN_API_TOKEN="$token" RAVEN_API_BIND_HOST=127.0.0.1 RAVEN_API_BIND_PORT="$port" \
    "$binary" --home "$smoke_home" api >"$api_stdout" 2>"$api_stderr" &
  api_pid=$!
  base_url="http://127.0.0.1:$port"
  for _ in $(seq 1 20); do
    if curl "${curl_args[@]}" --max-time 1 --fail --silent --header "Authorization: Bearer $token" \
      "$base_url/api/v1/dashboard" >"$smoke_home/dashboard.json"; then
      api_ready=true
      break 2
    fi
    kill -0 "$api_pid" 2>/dev/null || break
    sleep 0.05
  done
  stop_child "$api_pid"
  api_pid=""
done
[[ "$api_ready" == true ]] || fail "API did not bind an owned loopback port after bounded retries"

curl "${curl_args[@]}" --fail --silent "$base_url/healthz" >"$smoke_home/healthz.json"
unauthorized_status="$(curl "${curl_args[@]}" --silent --output /dev/null --write-out '%{http_code}' \
  "$base_url/api/v1/dashboard")"
[[ "$unauthorized_status" == 401 ]] || fail "API accepted an unauthenticated request"
auth_header="Authorization: Bearer $token"
dashboard_json="$(<"$smoke_home/dashboard.json")"
todo_api_json="$(curl "${curl_args[@]}" --fail --silent --header "$auth_header" \
  "$base_url/api/v1/todo/items?type=task")"
ledger_api_json="$(curl "${curl_args[@]}" --fail --silent --header "$auth_header" \
  "$base_url/api/v1/ledger/entries?limit=10")"
health_api_json="$(curl "${curl_args[@]}" --fail --silent --header "$auth_header" \
  "$base_url/api/v1/health/timeline?limit=10")"
health_trends_api_json="$(curl "${curl_args[@]}" --fail --silent --header "$auth_header" \
  "$base_url/api/v1/health/trends?days=30")"

DASHBOARD_JSON="$dashboard_json" TODO_API_JSON="$todo_api_json" TODO_ID="$todo_id" \
LEDGER_API_JSON="$ledger_api_json" LEDGER_ID="$ledger_id" \
HEALTH_API_JSON="$health_api_json" DIET_ID="$diet_id" WEIGHT_ID="$weight_id" \
CONDITION_ID="$condition_id" HEALTH_TRENDS_JSON="$health_trends_api_json" python3 - <<'PY'
import json
import os

dashboard = json.loads(os.environ["DASHBOARD_JSON"])
assert all(dashboard[name]["status"] == "ok" for name in ("todo", "ledger", "health"))
assert dashboard["todo"]["data"]["today_total"] == 1
assert dashboard["todo"]["data"]["today_incomplete"] == 1
krw = next(item for item in dashboard["ledger"]["data"]["currencies"]
           if item["currency_code"] == "KRW")
assert krw["expense_minor"] == 314159
assert krw["net_change_minor"] == -314159
condition = dashboard["health"]["data"]["latest_condition"]
assert condition["name"] == "SmokeCondition" and condition["value"] == 7
assert "smoke-diet-tag" in dashboard["health"]["data"]["recent_diet_tags"]

todo = json.loads(os.environ["TODO_API_JSON"])
assert any(item["id"] == os.environ["TODO_ID"]
           and item["title"] == "Smoke Today Task" for item in todo)
ledger = json.loads(os.environ["LEDGER_API_JSON"])["items"]
assert any(item["entry"]["id"] == os.environ["LEDGER_ID"]
           and item["entry"]["content"] == "SmokeLedgerSecret"
           and item["entry"]["amount"] == 314159 for item in ledger)
health = {item["record"]["id"]: item["record"]
          for item in json.loads(os.environ["HEALTH_API_JSON"])["items"]}
assert health[os.environ["DIET_ID"]]["food_name"] == "SmokeFoodSecret"
assert health[os.environ["WEIGHT_ID"]]["value_num"] == 67.89
assert health[os.environ["CONDITION_ID"]]["value_num"] == 7
trends = json.loads(os.environ["HEALTH_TRENDS_JSON"])
assert any(item["name"] == "smoke-diet-tag" and item["count"] == 1
           for item in trends["top_diet_tags"])
assert any(series["metric_key"] == "weight"
           and any(point["value"] == 67.89 for point in series["points"])
           for series in trends["numeric_series"])
PY
stop_child "$api_pid"
api_pid=""

ui_stdout="$smoke_home/ui.stdout"
ui_stderr="$smoke_home/ui.stderr"
"$binary" --home "$smoke_home" ui --ui-path "$ui_path" --port 0 --no-open \
  >"$ui_stdout" 2>"$ui_stderr" &
ui_pid=$!
ui_url=""
for _ in $(seq 1 100); do
  ui_line="$(grep -m1 -E '^Raven UI listening on http://127\.0\.0\.1:[0-9]+$' \
    "$ui_stdout" 2>/dev/null || true)"
  if [[ -n "$ui_line" ]]; then
    ui_url="${ui_line##* }"
    break
  fi
  kill -0 "$ui_pid" 2>/dev/null || fail "UI process exited before becoming ready"
  sleep 0.05
done
[[ -n "$ui_url" ]] || fail "UI did not report its port within the readiness bound"

cookie_jar="$smoke_home/ui.cookies"
bootstrap_headers="$smoke_home/ui-bootstrap.headers"
bootstrap_status="$(curl "${curl_args[@]}" --silent --dump-header "$bootstrap_headers" --cookie-jar "$cookie_jar" \
  --output /dev/null --write-out '%{http_code}' "$ui_url/__raven/session")"
[[ "$bootstrap_status" == 303 ]] || fail "UI session bootstrap did not redirect"
ui_session="$(COOKIE_JAR="$cookie_jar" HEADERS="$bootstrap_headers" python3 - <<'PY'
import os
from pathlib import Path

headers = Path(os.environ["HEADERS"]).read_text(encoding="utf-8").lower()
assert "set-cookie:" in headers
assert "httponly" in headers
assert "samesite=strict" in headers
assert "path=/" in headers
for line in Path(os.environ["COOKIE_JAR"]).read_text(encoding="utf-8").splitlines():
    fields = line.split("\t")
    if len(fields) == 7 and fields[5] == "raven_session":
        print(fields[6])
        break
else:
    raise AssertionError("raven_session cookie missing")
PY
)"
[[ -n "$ui_session" ]] || fail "UI session cookie is empty"

curl "${curl_args[@]}" --fail --silent --cookie "$cookie_jar" "$ui_url/" >"$smoke_home/ui-index.html"
cmp "$ui_path/index.html" "$smoke_home/ui-index.html" >/dev/null ||
  fail "served UI root does not match frontend/out/index.html"
ui_unauthorized="$(curl "${curl_args[@]}" --silent --output /dev/null --write-out '%{http_code}' \
  "$ui_url/api/v1/dashboard")"
[[ "$ui_unauthorized" == 401 ]] || fail "UI API accepted a request without its session cookie"
ui_dashboard="$(curl "${curl_args[@]}" --fail --silent --cookie "$cookie_jar" "$ui_url/api/v1/dashboard")"
UI_DASHBOARD="$ui_dashboard" python3 - <<'PY'
import json
import os

dashboard = json.loads(os.environ["UI_DASHBOARD"])
assert dashboard["todo"]["status"] == "ok"
assert dashboard["todo"]["data"]["today_total"] == 1
assert any(item["currency_code"] == "KRW" and item["expense_minor"] == 314159
           for item in dashboard["ledger"]["data"]["currencies"])
assert dashboard["health"]["data"]["latest_condition"]["value"] == 7
PY
stop_child "$ui_pid"
ui_pid=""

for secret in SmokeLedgerSecret 314159 SmokeFoodSecret 67.89 "$token" "$ui_session"; do
  if grep -R -F -q -- "$secret" "$smoke_home/logs"; then
    fail "sensitive seeded value or credential appeared in logs"
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
