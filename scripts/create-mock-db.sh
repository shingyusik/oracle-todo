#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home="${1:-"$repo_root/.mock-data/todo-engine"}"
db_path="$home/todo.sqlite"

if [[ "$home" == "$HOME/.todo-engine" || "$home" == "$HOME/.todo-engine/" ]]; then
  echo "refusing to write mock data to live home: $home" >&2
  exit 1
fi

if [[ -e "$db_path" && "$home" != "$repo_root/.mock-data/todo-engine" ]]; then
  echo "refusing to overwrite existing database: $db_path" >&2
  exit 1
fi

if [[ "$home" == "$repo_root/.mock-data/todo-engine" ]]; then
  rm -rf "$home"
fi
mkdir -p "$home"

run() {
  TODO_ENGINE_CONSOLE_LOG=error cargo run -q -p todo-engine -- --home "$home" "$@"
}

json_id() {
  python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])'
}

today="$(date +%F)"
year_start="$(date +%Y)-01-01"
month_start="${today%??}01"

run init >/dev/null

dev_area="$(run area create "개발" \
  --review-cycle weekly \
  --standard "UI와 API smoke를 매주 확인" \
  --note "mock DB 기본 area" | json_id)"

ops_area="$(run area create "운영" \
  --review-cycle daily \
  --standard "오늘 보기와 pending 목록이 비어 있지 않을 것" | json_id)"

project="$(run project propose "Workbench mock 데이터 점검" \
  --actor user \
  --area "$dev_area" \
  --outcome "현재 UI와 백엔드 API를 실제 SQLite로 점검한다" \
  --definition-of-done "pending, today, archive 화면에 대표 데이터가 보인다" \
  --due "$today" | json_id)"
run activate "$project" --reason "mock seed" >/dev/null

year_goal="$(run goal propose "올해 Workbench 품질 기준 세우기" \
  --actor user \
  --horizon year \
  --scheduled "$year_start" \
  --note "goal 테이블용 year 샘플" | json_id)"
run activate "$year_goal" --reason "mock seed" >/dev/null

month_goal="$(run goal propose "이번 달 UI 데이터 흐름 검증" \
  --actor user \
  --horizon month \
  --scheduled "$month_start" \
  --parent "$year_goal" \
  --note "goal 테이블용 month 샘플" | json_id)"
run activate "$month_goal" --reason "mock seed" >/dev/null

active_task="$(run task propose "Workbench 테이블 편집 플로우 점검" \
  --actor user \
  --area "$dev_area" \
  --scheduled "$today" \
  --priority 1 \
  --description "행 선택, 상태 전환, 상세 패널 표시를 확인" | json_id)"
run update "$active_task" --project-id "$project" --reason "mock seed link" >/dev/null
run update "$active_task" --parent-id "$month_goal" --reason "mock seed goal link" >/dev/null
run activate "$active_task" --reason "mock seed" >/dev/null

run task propose "Mock API 응답 확인" \
  --area "$dev_area" \
  --scheduled "$today" \
  --priority 2 \
  --note "agent proposed 상태 샘플" >/dev/null

done_task="$(run task propose "완료 상태 렌더링 확인" \
  --actor user \
  --area "$ops_area" \
  --scheduled "$today" \
  --priority 3 | json_id)"
run complete "$done_task" --reason "mock completed sample" >/dev/null

archived_task="$(run task propose "archive-list 샘플" \
  --actor user \
  --area "$ops_area" \
  --scheduled "$today" | json_id)"
run archive "$archived_task" --reason "mock archived sample" >/dev/null

routine="$(run routine propose "Workbench mock DB 스모크" \
  --actor user \
  --area "$ops_area" \
  --recurrence-rule daily \
  --materialization-policy single_open \
  --note "today view에 생성 태스크가 보여야 함" | json_id)"
run activate "$routine" --reason "mock seed" >/dev/null
run routine materialize --now "$today" --lookahead-days 0 --catchup-days 0 >/dev/null

run event propose "Mock API 데모 미팅" "${today}T15:00" \
  --actor user \
  --area "$ops_area" \
  --location "온라인" \
  --with "UI" \
  --with "backend" \
  --commitment-type meeting \
  --note "event 카드 표시 확인" >/dev/null

run event propose "목표 리뷰 캘린더 샘플" "${today}T17:00" \
  --actor user \
  --area "$dev_area" \
  --project-id "$project" \
  --location "회의실 A" \
  --with "planning" \
  --commitment-type review \
  --description "goal/event 테이블 표시 확인용" \
  --note "event 테이블용 추가 샘플" >/dev/null

run health
echo "TODO_ENGINE_HOME=$home"
