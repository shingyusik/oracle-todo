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
