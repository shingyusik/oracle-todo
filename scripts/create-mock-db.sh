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

tag_item() {
  local item_id="$1"
  shift
  local args=()
  for tag in "$@"; do
    args+=(--tag "$tag")
  done
  run update "$item_id" "${args[@]}" --reason "mock seed tags" >/dev/null
}

eval "$(
  python3 <<'PY'
from datetime import date, timedelta

today = date.today()
week_start = today - timedelta(days=today.weekday())
values = {
    "today": today,
    "yesterday": today - timedelta(days=1),
    "tomorrow": today + timedelta(days=1),
    "year_start": date(today.year, 1, 1),
    "month_start": date(today.year, today.month, 1),
}
for index, name in enumerate(("mon", "tue", "wed", "thu", "fri", "sat", "sun")):
    values[f"week_{name}"] = week_start + timedelta(days=index)

for key, value in values.items():
    print(f'{key}="{value.isoformat()}"')
PY
)"

run init >/dev/null

dev_area="$(run area create "개발" \
  --review-cycle weekly \
  --standard "UI와 API smoke를 매주 확인" \
  --note "mock DB 기본 area" | json_id)"

ops_area="$(run area create "운영" \
  --review-cycle daily \
  --standard "오늘 보기와 pending 목록이 비어 있지 않을 것" | json_id)"
tag_item "$dev_area" planner dev
tag_item "$ops_area" planner ops

project="$(run project propose "Workbench mock 데이터 점검" \
  --actor user \
  --area "$dev_area" \
  --outcome "현재 UI와 백엔드 API를 실제 SQLite로 점검한다" \
  --definition-of-done "pending, today, archive 화면에 대표 데이터가 보인다" \
  --due "$today" | json_id)"
run activate "$project" --reason "mock seed" >/dev/null
tag_item "$project" planner workbench

daily_project="$(run project propose "Planner daily flow 리허설" \
  --actor user \
  --area "$dev_area" \
  --outcome "Daily planner의 섹션, 필터, 정렬 상태를 한 번에 확인한다" \
  --definition-of-done "오늘, 어제, 내일, 미지정 할 일이 모두 보인다" \
  --due "$tomorrow" | json_id)"
run activate "$daily_project" --reason "mock seed" >/dev/null
tag_item "$daily_project" planner daily focus

year_goal="$(run goal propose "올해 Workbench 품질 기준 세우기" \
  --actor user \
  --horizon year \
  --scheduled "$year_start" \
  --note "goal 테이블용 year 샘플" | json_id)"
run activate "$year_goal" --reason "mock seed" >/dev/null
tag_item "$year_goal" planner yearly strategy

month_goal="$(run goal propose "이번 달 UI 데이터 흐름 검증" \
  --actor user \
  --horizon month \
  --scheduled "$month_start" \
  --parent "$year_goal" \
  --note "goal 테이블용 month 샘플" | json_id)"
run activate "$month_goal" --reason "mock seed" >/dev/null
tag_item "$month_goal" planner monthly focus

week_goal="$(run goal propose "이번 주 Planner 실행력 만들기" \
  --actor user \
  --horizon week \
  --scheduled "$week_mon" \
  --parent "$month_goal" \
  --note "weekly planner goal 카드용 샘플" | json_id)"
run activate "$week_goal" --reason "mock seed" >/dev/null
tag_item "$week_goal" planner weekly focus

active_task="$(run task propose "Workbench 테이블 편집 플로우 점검" \
  --actor user \
  --area "$dev_area" \
  --scheduled "$today" \
  --priority 1 \
  --description "행 선택, 상태 전환, 상세 패널 표시를 확인" | json_id)"
run update "$active_task" --project-id "$project" --reason "mock seed link" >/dev/null
run update "$active_task" --parent-id "$week_goal" --reason "mock seed goal link" >/dev/null
run activate "$active_task" --reason "mock seed" >/dev/null
tag_item "$active_task" planner daily focus

proposed_task="$(run task propose "Mock API 응답 확인" \
  --area "$dev_area" \
  --scheduled "$today" \
  --priority 2 \
  --note "agent proposed 상태 샘플" | json_id)"
run update "$proposed_task" --project-id "$project" --parent-id "$week_goal" --reason "mock seed link" >/dev/null
tag_item "$proposed_task" planner api pending

overdue_task="$(run task propose "어제 넘긴 데이터 정리" \
  --actor user \
  --area "$ops_area" \
  --scheduled "$yesterday" \
  --priority 1 \
  --description "Daily planner의 어제 했어야 하는 일 섹션 확인" | json_id)"
run update "$overdue_task" --project-id "$daily_project" --parent-id "$week_goal" --reason "mock seed link" >/dev/null
run activate "$overdue_task" --reason "mock seed" >/dev/null
tag_item "$overdue_task" planner overdue ops

tomorrow_task="$(run task propose "내일 오전 planner 필터 확인" \
  --actor user \
  --area "$dev_area" \
  --scheduled "$tomorrow" \
  --priority 2 \
  --description "Upcoming 섹션과 날짜 범위 필터 확인" | json_id)"
run update "$tomorrow_task" --project-id "$daily_project" --parent-id "$week_goal" --reason "mock seed link" >/dev/null
run activate "$tomorrow_task" --reason "mock seed" >/dev/null
tag_item "$tomorrow_task" planner upcoming focus

unscheduled_task="$(run task propose "날짜 없는 inbox triage" \
  --actor user \
  --area "$ops_area" \
  --priority 3 \
  --description "Daily planner의 미지정 섹션 확인" | json_id)"
run update "$unscheduled_task" --project-id "$daily_project" --reason "mock seed link" >/dev/null
run activate "$unscheduled_task" --reason "mock seed" >/dev/null
tag_item "$unscheduled_task" planner inbox ops

weekly_days=(
  "$week_mon|주간 planner 카드 월요일 점검|1"
  "$week_tue|주간 planner 카드 화요일 점검|2"
  "$week_wed|주간 planner 카드 수요일 점검|3"
  "$week_thu|주간 planner 카드 목요일 점검|2"
  "$week_fri|주간 planner 카드 금요일 점검|1"
  "$week_sat|주간 planner 카드 토요일 회고|4"
  "$week_sun|주간 planner 카드 일요일 준비|4"
)

for entry in "${weekly_days[@]}"; do
  IFS="|" read -r scheduled title priority <<<"$entry"
  task_id="$(run task propose "$title" \
    --actor user \
    --area "$dev_area" \
    --scheduled "$scheduled" \
    --priority "$priority" \
    --description "Weekly planner day card fixture" | json_id)"
  run update "$task_id" --project-id "$daily_project" --parent-id "$week_goal" --reason "mock seed link" >/dev/null
  run activate "$task_id" --reason "mock seed" >/dev/null
  tag_item "$task_id" planner weekly focus
done

done_task="$(run task propose "완료 상태 렌더링 확인" \
  --actor user \
  --area "$ops_area" \
  --scheduled "$today" \
  --priority 3 | json_id)"
tag_item "$done_task" planner completed hidden
run complete "$done_task" --reason "mock completed sample" >/dev/null

archived_task="$(run task propose "archive-list 샘플" \
  --actor user \
  --area "$ops_area" \
  --scheduled "$today" | json_id)"
tag_item "$archived_task" planner archive ops
run archive "$archived_task" --reason "mock archived sample" >/dev/null

routine="$(run routine propose "Workbench mock DB 스모크" \
  --actor user \
  --area "$ops_area" \
  --recurrence-rule daily \
  --materialization-policy single_open \
  --note "today view에 생성 태스크가 보여야 함" | json_id)"
run activate "$routine" --reason "mock seed" >/dev/null
tag_item "$routine" planner routine ops
routine_task="$(run routine materialize --now "$today" --lookahead-days 0 --catchup-days 0 | json_id)"
tag_item "$routine_task" planner routine today

today_event="$(run event propose "Mock API 데모 미팅" "${today}T15:00" \
  --actor user \
  --area "$ops_area" \
  --project-id "$daily_project" \
  --location "온라인" \
  --with "UI" \
  --with "backend" \
  --commitment-type meeting \
  --note "event 카드 표시 확인" | json_id)"
tag_item "$today_event" planner event ops

review_event="$(run event propose "목표 리뷰 캘린더 샘플" "${today}T17:00" \
  --actor user \
  --area "$dev_area" \
  --project-id "$project" \
  --location "회의실 A" \
  --with "planning" \
  --commitment-type review \
  --description "goal/event 테이블 표시 확인용" \
  --note "event 테이블용 추가 샘플" | json_id)"
tag_item "$review_event" planner event review

tomorrow_event="$(run event propose "내일 planner 리뷰" "${tomorrow}T10:30" \
  --actor user \
  --area "$dev_area" \
  --project-id "$daily_project" \
  --location "온라인" \
  --with "planning" \
  --commitment-type review \
  --description "Daily upcoming 및 weekly event 표시 확인" | json_id)"
tag_item "$tomorrow_event" planner event upcoming

run health
echo "TODO_ENGINE_HOME=$home"
