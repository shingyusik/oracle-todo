#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home="$(mktemp -d)"
trap 'rm -rf "$home"' EXIT

mkdir -p "$repo_root/.mock-data/todo-engine"
touch "$repo_root/.mock-data/todo-engine/keep"
"$repo_root/scripts/create-mock-db.sh" "$home" >/dev/null

test -f "$home/todo.sqlite"
test -f "$repo_root/.mock-data/todo-engine/keep"

pending="$(TODO_ENGINE_CONSOLE_LOG=error cargo run -q -p todo-engine -- --home "$home" pending)"
today="$(TODO_ENGINE_CONSOLE_LOG=error cargo run -q -p todo-engine -- --home "$home" today)"

grep -q "Mock API 응답 확인" <<<"$pending"
grep -q "Workbench mock DB 스모크" <<<"$today"
grep -q "어제 넘긴 데이터 정리" <<<"$today"
! grep -q "완료 상태 렌더링 확인" <<<"$today"

planner_tagged="$(sqlite3 "$home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE tags LIKE '%planner%';")"
weekly_tasks="$(sqlite3 "$home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE title LIKE '주간 planner 카드%';")"
period_goals="$(sqlite3 "$home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE type = 'goal' AND horizon IN ('year', 'month', 'week');")"
daily_sections="$(sqlite3 "$home/todo.sqlite" "SELECT COUNT(*) FROM items WHERE title IN ('어제 넘긴 데이터 정리', 'Workbench 테이블 편집 플로우 점검', '내일 오전 planner 필터 확인', '날짜 없는 inbox triage');")"

[[ "$planner_tagged" -ge 20 ]]
[[ "$weekly_tasks" -eq 7 ]]
[[ "$period_goals" -ge 3 ]]
[[ "$daily_sections" -eq 4 ]]
