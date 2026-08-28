#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
smoke_home="$(mktemp -d)"
occupied_home="$(mktemp -d)"
raven_home="$(mktemp -d)"
trap 'rm -rf -- "$smoke_home" "$occupied_home" "$raven_home"' EXIT

sentinel_bytes='sentinel ledger bytes'
printf '%s' "$sentinel_bytes" >"$occupied_home/ledger.sqlite"
if refusal_output="$("$repo_root/scripts/create-mock-db.sh" "$occupied_home" 2>&1)"; then
  echo "expected occupied custom home to be rejected" >&2
  exit 1
fi
grep -q "refusing to overwrite existing database: $occupied_home/ledger.sqlite" <<<"$refusal_output"
test "$(cat "$occupied_home/ledger.sqlite")" = "$sentinel_bytes"
test ! -e "$occupied_home/todo.sqlite"

if raven_home_output="$(RAVEN_HOME="$raven_home" "$repo_root/scripts/create-mock-db.sh" "$raven_home" 2>&1)"; then
  echo "expected RAVEN_HOME to be rejected" >&2
  exit 1
fi
grep -q "refusing to write mock data to live home: $raven_home" <<<"$raven_home_output"
test ! -e "$raven_home/todo.sqlite"
test ! -e "$raven_home/ledger.sqlite"
test ! -e "$raven_home/health.sqlite"

eval "$(
  python3 <<'PY'
from datetime import date, timedelta

today = date.today()
week_start = today - timedelta(days=today.weekday())
for key, value in {
    "today_date": today,
    "yesterday_date": today - timedelta(days=1),
    "tomorrow_date": today + timedelta(days=1),
    "ledger_start": today - timedelta(days=89),
    "week_start_date": week_start,
    "month_start_date": date(today.year, today.month, 1),
    "year_start_date": date(today.year, 1, 1),
}.items():
    print(f'{key}="{value.isoformat()}"')
PY
)"

mkdir -p "$repo_root/.mock-data/todo-engine"
touch "$repo_root/.mock-data/todo-engine/keep"
"$repo_root/scripts/create-mock-db.sh" "$smoke_home" >/dev/null

cargo run -q -p raven-cli -- --home "$smoke_home" todo today >/dev/null

test -f "$smoke_home/todo.sqlite"
test -d "$smoke_home/media/health"
test -f "$repo_root/.mock-data/todo-engine/keep"

pending="$(cargo run -q -p raven-cli -- --home "$smoke_home" todo pending)"
today="$(cargo run -q -p raven-cli -- --home "$smoke_home" todo today)"

grep -q "Mock API 응답 확인" <<<"$pending"
grep -q "Workbench mock DB 스모크" <<<"$today"
grep -q "어제 넘긴 데이터 정리" <<<"$today"
! grep -q "완료 상태 렌더링 확인" <<<"$today"

planner_tagged="$(sqlite3 "$smoke_home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE tags LIKE '%planner%';")"
weekly_tasks="$(sqlite3 "$smoke_home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE title LIKE '주간 planner 카드%';")"
period_goals="$(sqlite3 "$smoke_home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE type = 'goal' AND horizon IN ('year', 'month', 'week');")"
daily_sections="$(sqlite3 "$smoke_home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE title IN ('어제 넘긴 데이터 정리', 'Workbench 테이블 편집 플로우 점검', '내일 오전 planner 필터 확인', '날짜 없는 inbox triage');")"

[[ "$planner_tagged" -ge 20 ]]
[[ "$weekly_tasks" -eq 7 ]]
[[ "$period_goals" -ge 3 ]]
[[ "$daily_sections" -eq 4 ]]

todo_relative="$(sqlite3 "$smoke_home/todo.sqlite" "
SELECT
  (SELECT COUNT(*) FROM items
   WHERE title = '어제 넘긴 데이터 정리' AND scheduled = '$yesterday_date') = 1
  AND (SELECT COUNT(*) FROM items
       WHERE title = 'Workbench 테이블 편집 플로우 점검' AND scheduled = '$today_date') = 1
  AND (SELECT COUNT(*) FROM items
       WHERE title = '내일 오전 planner 필터 확인' AND scheduled = '$tomorrow_date') = 1
  AND (SELECT COUNT(*) FROM items
       WHERE type = 'goal' AND horizon = 'week' AND scheduled = '$week_start_date') = 1
  AND (SELECT COUNT(*) FROM items
       WHERE type = 'goal' AND horizon = 'month' AND scheduled = '$month_start_date') = 1
  AND (SELECT COUNT(*) FROM items
       WHERE type = 'goal' AND horizon = 'year' AND scheduled = '$year_start_date') = 1;")"
[[ "$todo_relative" -eq 1 ]]

test -f "$smoke_home/ledger.sqlite"
cargo run -q -p raven-cli -- --home "$smoke_home" ledger balances --format json >/dev/null
cargo run -q -p raven-cli -- --home "$smoke_home" ledger reports \
  --from "$ledger_start" --to "$today_date" --format json >/dev/null

ledger_out_of_range="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COUNT(*) FROM ledger_entries WHERE date < '$ledger_start' OR date > '$today_date';")"
expense_categories="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COUNT(DISTINCT transaction_category_id) FROM ledger_entries
WHERE entry_type = 'expense' AND deleted_at IS NULL
  AND date BETWEEN '$ledger_start' AND '$today_date';")"
income_total="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries
WHERE entry_type = 'income' AND deleted_at IS NULL
  AND date BETWEEN '$ledger_start' AND '$today_date';")"
expense_total="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries
WHERE entry_type = 'expense' AND deleted_at IS NULL
  AND date BETWEEN '$ledger_start' AND '$today_date';")"
transfer_pairs="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COUNT(*) FROM (
  SELECT transfer_group_id
  FROM ledger_entries
  WHERE transfer_group_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY transfer_group_id
  HAVING COUNT(*) = 2
     AND SUM(CASE WHEN entry_type = 'transfer_out' THEN 1 ELSE 0 END) = 1
     AND SUM(CASE WHEN entry_type = 'transfer_in' THEN 1 ELSE 0 END) = 1
);")"
usd_balance_only="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COUNT(*) FROM (
  SELECT a.id FROM accounts AS a
  JOIN currencies AS c ON c.id = a.currency_id
  LEFT JOIN ledger_entries AS e
    ON e.account_id = a.id AND e.deleted_at IS NULL
  WHERE c.code = 'USD' AND a.opening_balance_minor > 0
    AND a.active = 1 AND a.deleted_at IS NULL
  GROUP BY a.id HAVING COUNT(e.id) = 0
);")"
liabilities="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COUNT(*) FROM accounts AS a
JOIN account_categories AS ac ON ac.id = a.account_category_id
WHERE ac.liability = 1 AND a.opening_balance_minor < 0
  AND a.active = 1 AND a.deleted_at IS NULL;")"

[[ "$ledger_out_of_range" -eq 0 ]]
[[ "$expense_categories" -ge 8 ]]
[[ "$income_total" -gt 0 ]]
[[ "$expense_total" -gt 0 ]]
[[ "$transfer_pairs" -ge 1 ]]
[[ "$usd_balance_only" -ge 1 ]]
[[ "$liabilities" -ge 1 ]]
