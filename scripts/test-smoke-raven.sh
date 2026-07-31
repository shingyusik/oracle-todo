#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
smoke="$repo_root/scripts/smoke-raven.sh"
smoke_home="$(mktemp -d "${TMPDIR:-/tmp}/raven smoke.XXXXXX")"
unmarked_home="$(mktemp -d)"
nonempty_home="$(mktemp -d)"

cleanup() {
  rm -rf -- "$smoke_home" "$unmarked_home" "$nonempty_home"
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

if "$smoke" >/dev/null 2>&1; then
  echo "smoke script accepted a missing home" >&2
  exit 1
fi
if "$smoke" "$HOME/.raven" >/dev/null 2>&1; then
  echo "smoke script accepted the live default home" >&2
  exit 1
fi
if "$smoke" "$unmarked_home" >/dev/null 2>&1; then
  echo "smoke script accepted an unmarked home" >&2
  exit 1
fi

printf 'raven-smoke-v1\n' >"$nonempty_home/.raven-smoke-home"
touch "$nonempty_home/keep"
if "$smoke" "$nonempty_home" >/dev/null 2>&1; then
  echo "smoke script accepted a non-empty home" >&2
  exit 1
fi

printf 'raven-smoke-v1\n' >"$smoke_home/.raven-smoke-home"
"$smoke" "$smoke_home"

if command -v pwsh >/dev/null; then
  pwsh -NoProfile -Command '
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
      $args[0], [ref]$tokens, [ref]$errors
    ) | Out-Null
    if ($errors.Count -ne 0) { $errors | Out-String | Write-Error; exit 1 }
  ' "$repo_root/scripts/smoke-raven.ps1"
fi
