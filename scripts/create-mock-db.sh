#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home="${1:-"$repo_root/.mock-data/todo-engine"}"
default_home="$repo_root/.mock-data/todo-engine"
home_real="$(realpath -m -- "$home")"
default_home_real="$(realpath -m -- "$default_home")"

live_homes=("$HOME/.todo-engine" "$HOME/.raven")
raven_home="${RAVEN_HOME:-}"
if [[ -n "${raven_home//[[:space:]]/}" ]]; then
  live_homes+=("$raven_home")
fi
for live_home in "${live_homes[@]}"; do
  live_home_real="$(realpath -m -- "$live_home")"
  if [[ "${home_real,,}" == "${live_home_real,,}" ]]; then
    echo "refusing to write mock data to live home: $home" >&2
    exit 1
  fi
done

if [[ "${home_real,,}" == "${default_home_real,,}" ]]; then
  for path in "$repo_root" "$repo_root/.mock-data" "$default_home" "$home"; do
    if [[ -L "$path" ]]; then
      echo "refusing to remove default mock home through a link or junction: $path" >&2
      exit 1
    fi
  done
fi

if [[ "${home_real,,}" != "${default_home_real,,}" ]]; then
  for db_name in todo.sqlite ledger.sqlite health.sqlite; do
    db_path="$home/$db_name"
    if [[ -e "$db_path" || -L "$db_path" ]]; then
      echo "refusing to overwrite existing database: $db_path" >&2
      exit 1
    fi
  done
fi

if [[ "${home_real,,}" == "${default_home_real,,}" ]]; then
  rm -rf -- "$home"
fi
mkdir -p "$home"

run_raven() {
  RAVEN_CONSOLE_LOG=error cargo run -q -p raven-cli -- --home "$home" "$@"
}

run() {
  run_raven todo "$@"
}

ledger() {
  run_raven ledger "$@"
}

day_offset() {
  python3 - "$today" "$1" <<'PY'
from datetime import date, timedelta
import sys
print((date.fromisoformat(sys.argv[1]) + timedelta(days=int(sys.argv[2]))).isoformat())
PY
}

add_entry() {
  local offset="$1" type="$2" amount="$3" account="$4" category="$5" content="$6"
  ledger entry add --date "$(day_offset "$offset")" --type "$type" --amount "$amount" \
    --currency KRW --account "$account" --category "$category" --content "$content" \
    --source mock-seed >/dev/null
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
    "ledger_start": today - timedelta(days=89),
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

run_raven init >/dev/null

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
tag_item "$project" planner workbench

daily_project="$(run project propose "Planner daily flow 리허설" \
  --actor user \
  --area "$dev_area" \
  --outcome "Daily planner의 섹션, 필터, 정렬 상태를 한 번에 확인한다" \
  --definition-of-done "오늘, 어제, 내일, 미지정 할 일이 모두 보인다" \
  --due "$tomorrow" | json_id)"
tag_item "$daily_project" planner daily focus

year_goal="$(run goal propose "올해 Workbench 품질 기준 세우기" \
  --actor user \
  --horizon year \
  --scheduled "$year_start" \
  --note "goal 테이블용 year 샘플" | json_id)"
tag_item "$year_goal" planner yearly strategy

month_goal="$(run goal propose "이번 달 UI 데이터 흐름 검증" \
  --actor user \
  --horizon month \
  --scheduled "$month_start" \
  --parent "$year_goal" \
  --note "goal 테이블용 month 샘플" | json_id)"
tag_item "$month_goal" planner monthly focus

week_goal="$(run goal propose "이번 주 Planner 실행력 만들기" \
  --actor user \
  --horizon week \
  --scheduled "$week_mon" \
  --parent "$month_goal" \
  --note "weekly planner goal 카드용 샘플" | json_id)"
tag_item "$week_goal" planner weekly focus

active_task="$(run task propose "Workbench 테이블 편집 플로우 점검" \
  --actor user \
  --area "$dev_area" \
  --scheduled "$today" \
  --priority 1 \
  --description "행 선택, 상태 전환, 상세 패널 표시를 확인" | json_id)"
run update "$active_task" --project-id "$project" --reason "mock seed link" >/dev/null
run update "$active_task" --parent-id "$week_goal" --reason "mock seed goal link" >/dev/null
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
tag_item "$overdue_task" planner overdue ops

tomorrow_task="$(run task propose "내일 오전 planner 필터 확인" \
  --actor user \
  --area "$dev_area" \
  --scheduled "$tomorrow" \
  --priority 2 \
  --description "Upcoming 섹션과 날짜 범위 필터 확인" | json_id)"
run update "$tomorrow_task" --project-id "$daily_project" --parent-id "$week_goal" --reason "mock seed link" >/dev/null
tag_item "$tomorrow_task" planner upcoming focus

unscheduled_task="$(run task propose "날짜 없는 inbox triage" \
  --actor user \
  --area "$ops_area" \
  --priority 3 \
  --description "Daily planner의 미지정 섹션 확인" | json_id)"
run update "$unscheduled_task" --project-id "$daily_project" --reason "mock seed link" >/dev/null
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
tag_item "$routine" planner routine ops
routine_task="$(run routine materialize | json_id)"
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

ledger currency create --code KRW --name "Korean Won" --symbol KRW --decimal-places 0 >/dev/null
ledger currency create --code USD --name "US Dollar" --symbol USD --decimal-places 2 >/dev/null

ledger account-category create --name "Cash assets" >/dev/null
ledger account-category create --name "Savings assets" >/dev/null
ledger account-category create --name "Credit liabilities" --liability >/dev/null

ledger account create --name Checking --category "Cash assets" --currency KRW --opening-balance 4000000 >/dev/null
ledger account create --name Cash --category "Cash assets" --currency KRW --opening-balance 300000 >/dev/null
ledger account create --name Savings --category "Savings assets" --currency KRW --opening-balance 6000000 >/dev/null
ledger account create --name "Credit card" --category "Credit liabilities" --currency KRW --opening-balance=-650000 >/dev/null
ledger account create --name "USD wallet" --category "Cash assets" --currency USD --opening-balance 1250.00 >/dev/null

for category in Food Housing Transport Utilities Health Shopping Leisure Education Subscriptions; do
  ledger category create --name "$category" --kind expense >/dev/null
done
ledger category create --name Salary --kind income >/dev/null
ledger category create --name Freelance --kind income >/dev/null

entries=(
  "-85|income|3200000|Checking|Salary|Monthly salary 1"
  "-82|expense|120000|Checking|Food|Groceries 1"
  "-75|expense|800000|Checking|Housing|Monthly rent 1"
  "-70|expense|45000|Checking|Transport|Transit pass"
  "-64|expense|135000|Checking|Utilities|Utilities 1"
  "-58|expense|72000|Checking|Health|Clinic"
  "-52|income|3200000|Checking|Salary|Monthly salary 2"
  "-48|expense|185000|Checking|Shopping|Household goods"
  "-43|expense|95000|Checking|Leisure|Weekend outing"
  "-39|expense|210000|Checking|Education|Course"
  "-34|expense|19000|Checking|Subscriptions|Streaming"
  "-29|expense|138000|Checking|Food|Groceries 2"
  "-23|income|3200000|Checking|Salary|Monthly salary 3"
  "-20|expense|800000|Checking|Housing|Monthly rent 2"
  "-16|expense|62000|Checking|Transport|Taxi and transit"
  "-12|expense|148000|Checking|Utilities|Utilities 2"
  "-9|income|450000|Checking|Freelance|Side project"
  "-6|expense|87000|Checking|Food|Groceries 3"
  "-3|expense|125000|Checking|Shopping|Recent shopping"
  "0|expense|24000|Cash|Leisure|Today coffee and movie"
)
for row in "${entries[@]}"; do
  IFS="|" read -r offset type amount account category content <<<"$row"
  add_entry "$offset" "$type" "$amount" "$account" "$category" "$content"
done

ledger transfer \
  --operation-key 10000000-0000-4000-8000-000000000001 \
  --date "$(day_offset -7)" --amount 500000 --currency KRW \
  --from-account Checking --to-account Savings --content "Mock savings transfer" \
  --source mock-seed >/dev/null

run_raven health-check
echo "TODO_ENGINE_HOME=$home"
