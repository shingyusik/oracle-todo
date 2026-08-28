# Relative Raven Mock Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing mock-data command rebuild ToDo and Ledger fixtures from the local run date, including 90 days of graph-friendly Ledger activity.

**Architecture:** Keep the two existing platform scripts as the only user-facing entry points and preserve their exact default-home safety boundary. Each implementation captures today once, derives dates with native platform arithmetic, and sends every mutation through `raven`; smoke tests may query the temporary SQLite stores read-only to prove the relative-date and report-shape contract.

**Tech Stack:** Bash, PowerShell, Raven Rust CLI, SQLite smoke assertions

---

### Task 1: Lock the relative Bash seed contract

**Files:**
- Modify: `scripts/test-create-mock-db.sh`
- Test: `scripts/test-create-mock-db.sh`

- [ ] **Step 1: Add relative ToDo and Ledger assertions before changing the seed**

Compute the same local anchors used by the seed and add read-only assertions after the
existing shape checks:

```bash
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

todo_relative="$(sqlite3 "$smoke_home/todo.sqlite" "
SELECT COUNT(*) FROM items WHERE
  (title = '어제 넘긴 데이터 정리' AND scheduled = '$yesterday_date') OR
  (title = 'Workbench 테이블 편집 플로우 점검' AND scheduled = '$today_date') OR
  (title = '내일 오전 planner 필터 확인' AND scheduled = '$tomorrow_date') OR
  (type = 'goal' AND horizon = 'week' AND scheduled = '$week_start_date') OR
  (type = 'goal' AND horizon = 'month' AND scheduled = '$month_start_date') OR
  (type = 'goal' AND horizon = 'year' AND scheduled = '$year_start_date');")"
[[ "$todo_relative" -eq 6 ]]

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
usd_balance_only="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COUNT(*) FROM accounts AS a
JOIN currencies AS c ON c.id = a.currency_id
LEFT JOIN ledger_entries AS e ON e.account_id = a.id
WHERE c.code = 'USD' AND a.opening_balance_minor > 0
GROUP BY a.id HAVING COUNT(e.id) = 0;")"
liabilities="$(sqlite3 "$smoke_home/ledger.sqlite" "
SELECT COUNT(*) FROM accounts AS a
JOIN account_categories AS ac ON ac.id = a.account_category_id
WHERE ac.liability = 1 AND a.opening_balance_minor < 0;")"

[[ "$ledger_out_of_range" -eq 0 ]]
[[ "$expense_categories" -ge 8 ]]
[[ "$income_total" -gt 0 ]]
[[ "$expense_total" -gt 0 ]]
[[ "$usd_balance_only" -ge 1 ]]
[[ "$liabilities" -ge 1 ]]
```

- [ ] **Step 2: Run the Bash smoke test and confirm the new contract fails**

Run: `bash scripts/test-create-mock-db.sh`

Expected: FAIL because `ledger.sqlite` has no seeded Ledger master data or entries.

- [ ] **Step 3: Commit the failing contract**

```bash
git add scripts/test-create-mock-db.sh
git commit -m "[UPDATE] Specify relative Raven mock data"
```

### Task 2: Seed the 90-day Ledger fixture in Bash

**Files:**
- Modify: `scripts/create-mock-db.sh`
- Test: `scripts/test-create-mock-db.sh`

- [ ] **Step 1: Add the 90-day anchor and a minimal Ledger helper**

Add `ledger_start` to the existing Python-generated values and keep all dates derived from
the single `today` value:

```python
"ledger_start": today - timedelta(days=89),
```

Add native helpers beside `run()`:

```bash
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
```

- [ ] **Step 2: Create Ledger master data through the CLI**

Append after the existing ToDo records and before `health-check`:

```bash
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
```

- [ ] **Step 3: Add deterministic entries spread across the last 90 days**

Use the exact table below so the shell and PowerShell fixtures stay equivalent:

```bash
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
```

- [ ] **Step 4: Run the Bash smoke test**

Run: `bash scripts/test-create-mock-db.sh`

Expected: PASS, including relative ToDo anchors, Ledger range, category, liability, and
balance-only currency assertions.

- [ ] **Step 5: Commit the Bash seed**

```bash
git add scripts/create-mock-db.sh
git commit -m "[UPDATE] Seed recent Ledger mock data"
```

### Task 3: Keep the PowerShell seed equivalent

**Files:**
- Modify: `scripts/create-mock-db.ps1`
- Create: `scripts/test-create-mock-db.ps1`
- Test: `scripts/test-create-mock-db.ps1`

- [ ] **Step 1: Write the PowerShell smoke test**

Create an isolated test that always cleans only its generated temporary directory:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$smokeHome = Join-Path ([IO.Path]::GetTempPath()) "raven-mock-$([guid]::NewGuid())"

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

try {
    & (Join-Path $PSScriptRoot 'create-mock-db.ps1') -DataHome $smokeHome | Out-Null
    $today = (Get-Date).Date
    $start = $today.AddDays(-89)

    $todoRelative = & sqlite3 (Join-Path $smokeHome 'todo.sqlite') @"
SELECT COUNT(*) FROM items WHERE
  (title = '어제 넘긴 데이터 정리' AND scheduled = '$($today.AddDays(-1).ToString('yyyy-MM-dd'))') OR
  (title = 'Workbench 테이블 편집 플로우 점검' AND scheduled = '$($today.ToString('yyyy-MM-dd'))') OR
  (title = '내일 오전 planner 필터 확인' AND scheduled = '$($today.AddDays(1).ToString('yyyy-MM-dd'))');
"@
    Assert-True ([int]$todoRelative -eq 3) 'ToDo relative dates are stale.'

    & cargo run -q -p raven-cli -- --home $smokeHome ledger balances --format json | Out-Null
    & cargo run -q -p raven-cli -- --home $smokeHome ledger reports `
        --from $start.ToString('yyyy-MM-dd') --to $today.ToString('yyyy-MM-dd') `
        --format json | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) 'Ledger report smoke failed.'

    $ledgerDb = Join-Path $smokeHome 'ledger.sqlite'
    $outOfRange = & sqlite3 $ledgerDb "SELECT COUNT(*) FROM ledger_entries WHERE date < '$($start.ToString('yyyy-MM-dd'))' OR date > '$($today.ToString('yyyy-MM-dd'))';"
    $expenseCategories = & sqlite3 $ledgerDb "SELECT COUNT(DISTINCT transaction_category_id) FROM ledger_entries WHERE entry_type='expense' AND deleted_at IS NULL;"
    $incomeTotal = & sqlite3 $ledgerDb "SELECT COALESCE(SUM(amount_minor),0) FROM ledger_entries WHERE entry_type='income' AND deleted_at IS NULL;"
    $expenseTotal = & sqlite3 $ledgerDb "SELECT COALESCE(SUM(amount_minor),0) FROM ledger_entries WHERE entry_type='expense' AND deleted_at IS NULL;"
    $usdBalanceOnly = & sqlite3 $ledgerDb "SELECT COUNT(*) FROM accounts a JOIN currencies c ON c.id=a.currency_id LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE c.code='USD' GROUP BY a.id HAVING COUNT(e.id)=0;"
    $liabilities = & sqlite3 $ledgerDb "SELECT COUNT(*) FROM accounts a JOIN account_categories ac ON ac.id=a.account_category_id WHERE ac.liability=1 AND a.opening_balance_minor<0;"

    Assert-True ([int]$outOfRange -eq 0) 'Ledger contains stale dates.'
    Assert-True ([int]$expenseCategories -ge 8) 'Ledger needs at least eight expense categories.'
    Assert-True ([long]$incomeTotal -gt 0 -and [long]$expenseTotal -gt 0) 'Ledger report totals are empty.'
    Assert-True ([int]$usdBalanceOnly -ge 1) 'USD balance-only account is missing.'
    Assert-True ([int]$liabilities -ge 1) 'Liability account is missing.'
}
finally {
    if (Test-Path -LiteralPath $smokeHome) {
        Remove-Item -LiteralPath $smokeHome -Recurse -Force
    }
}
```

- [ ] **Step 2: Run the PowerShell test and confirm it fails**

Run: `powershell -NoProfile -File scripts/test-create-mock-db.ps1`

Expected: FAIL because the PowerShell seed does not create Ledger fixtures.

- [ ] **Step 3: Add native date and Ledger helpers to the PowerShell seed**

Add `$ledgerStart = Format-Day $todayDate.AddDays(-89)` and these helpers:

```powershell
function Invoke-Ledger {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
    Invoke-Raven ledger @CliArgs
}

function Get-RelativeDay([int]$Offset) {
    return Format-Day $todayDate.AddDays($Offset)
}

function Add-LedgerEntry(
    [int]$Offset,
    [string]$Type,
    [string]$Amount,
    [string]$Account,
    [string]$Category,
    [string]$Content
) {
    Invoke-Ledger entry add --date (Get-RelativeDay $Offset) --type $Type `
        --amount $Amount --currency KRW --account $Account --category $Category `
        --content $Content --source mock-seed | Out-Null
}
```

- [ ] **Step 4: Mirror the exact Bash master data and entry table**

Create the master data explicitly:

```powershell
Invoke-Ledger currency create --code KRW --name 'Korean Won' --symbol KRW --decimal-places 0 | Out-Null
Invoke-Ledger currency create --code USD --name 'US Dollar' --symbol USD --decimal-places 2 | Out-Null

Invoke-Ledger account-category create --name 'Cash assets' | Out-Null
Invoke-Ledger account-category create --name 'Savings assets' | Out-Null
Invoke-Ledger account-category create --name 'Credit liabilities' --liability | Out-Null

Invoke-Ledger account create --name Checking --category 'Cash assets' --currency KRW --opening-balance 4000000 | Out-Null
Invoke-Ledger account create --name Cash --category 'Cash assets' --currency KRW --opening-balance 300000 | Out-Null
Invoke-Ledger account create --name Savings --category 'Savings assets' --currency KRW --opening-balance 6000000 | Out-Null
Invoke-Ledger account create --name 'Credit card' --category 'Credit liabilities' --currency KRW '--opening-balance=-650000' | Out-Null
Invoke-Ledger account create --name 'USD wallet' --category 'Cash assets' --currency USD --opening-balance 1250.00 | Out-Null

foreach ($category in @('Food', 'Housing', 'Transport', 'Utilities', 'Health', 'Shopping', 'Leisure', 'Education', 'Subscriptions')) {
    Invoke-Ledger category create --name $category --kind expense | Out-Null
}
Invoke-Ledger category create --name Salary --kind income | Out-Null
Invoke-Ledger category create --name Freelance --kind income | Out-Null
```

Use this exact entry table:

```powershell
$entries = @(
    @(-85, 'income', '3200000', 'Checking', 'Salary', 'Monthly salary 1')
    @(-82, 'expense', '120000', 'Checking', 'Food', 'Groceries 1')
    @(-75, 'expense', '800000', 'Checking', 'Housing', 'Monthly rent 1')
    @(-70, 'expense', '45000', 'Checking', 'Transport', 'Transit pass')
    @(-64, 'expense', '135000', 'Checking', 'Utilities', 'Utilities 1')
    @(-58, 'expense', '72000', 'Checking', 'Health', 'Clinic')
    @(-52, 'income', '3200000', 'Checking', 'Salary', 'Monthly salary 2')
    @(-48, 'expense', '185000', 'Checking', 'Shopping', 'Household goods')
    @(-43, 'expense', '95000', 'Checking', 'Leisure', 'Weekend outing')
    @(-39, 'expense', '210000', 'Checking', 'Education', 'Course')
    @(-34, 'expense', '19000', 'Checking', 'Subscriptions', 'Streaming')
    @(-29, 'expense', '138000', 'Checking', 'Food', 'Groceries 2')
    @(-23, 'income', '3200000', 'Checking', 'Salary', 'Monthly salary 3')
    @(-20, 'expense', '800000', 'Checking', 'Housing', 'Monthly rent 2')
    @(-16, 'expense', '62000', 'Checking', 'Transport', 'Taxi and transit')
    @(-12, 'expense', '148000', 'Checking', 'Utilities', 'Utilities 2')
    @(-9, 'income', '450000', 'Checking', 'Freelance', 'Side project')
    @(-6, 'expense', '87000', 'Checking', 'Food', 'Groceries 3')
    @(-3, 'expense', '125000', 'Checking', 'Shopping', 'Recent shopping')
    @(0, 'expense', '24000', 'Cash', 'Leisure', 'Today coffee and movie')
)
foreach ($entry in $entries) { Add-LedgerEntry @entry }

Invoke-Ledger transfer `
    --operation-key 10000000-0000-4000-8000-000000000001 `
    --date (Get-RelativeDay -7) --amount 500000 --currency KRW `
    --from-account Checking --to-account Savings --content 'Mock savings transfer' `
    --source mock-seed | Out-Null
```

- [ ] **Step 5: Run both platform smoke tests**

Run:

```text
powershell -NoProfile -File scripts/test-create-mock-db.ps1
bash scripts/test-create-mock-db.sh
```

Expected: both PASS. If Bash cannot execute in the Windows environment described at the top
of `create-mock-db.ps1`, retain the passing PowerShell evidence and run the Bash test in the
available Git Bash/CI environment before completion.

- [ ] **Step 6: Commit PowerShell parity**

```bash
git add scripts/create-mock-db.ps1 scripts/test-create-mock-db.ps1
git commit -m "[UPDATE] Keep Windows mock data recent"
```

### Task 4: Document and verify the combined command

**Files:**
- Modify: `docs/operations/verification-and-smoke.md`
- Test: `scripts/test-create-mock-db.sh`
- Test: `scripts/test-create-mock-db.ps1`

- [ ] **Step 1: Document the destructive boundary and commands**

Add a short `Mock data` subsection:

````markdown
### Mock data

The mock-data scripts rebuild `.mock-data/todo-engine` with ToDo records around the local
run date and Ledger activity from the latest inclusive 90 days:

```bash
bash scripts/create-mock-db.sh
```

```powershell
./scripts/create-mock-db.ps1
```

The default target is deleted and recreated on every run. Passing a custom data home is
no-clobber: the scripts refuse an existing database. Never point either command at live data.
````

- [ ] **Step 2: Run the final script gates**

Run:

```text
powershell -NoProfile -File scripts/test-create-mock-db.ps1
bash scripts/test-create-mock-db.sh
cargo fmt --check
git diff --check
```

Expected: PASS. `cargo fmt --check` proves the scripts did not disturb Rust formatting; the
two seed tests prove relative dates and both domain stores.

- [ ] **Step 3: Inspect generated data manually through Raven**

Run the PowerShell seed against the default mock home, then read it through public commands:

```powershell
./scripts/create-mock-db.ps1
cargo run -q -p raven-cli -- --home .mock-data/todo-engine todo today
$from = (Get-Date).Date.AddDays(-89).ToString('yyyy-MM-dd')
$to = (Get-Date).Date.ToString('yyyy-MM-dd')
cargo run -q -p raven-cli -- --home .mock-data/todo-engine ledger reports --from $from --to $to
cargo run -q -p raven-cli -- --home .mock-data/todo-engine ledger balances
```

Expected: current ToDo rows, nonzero KRW income/spending, several positive accounts, one
negative credit account, and a USD balance-only account.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/operations/verification-and-smoke.md
git commit -m "[DOCS] Document recent Raven mock data"
```
