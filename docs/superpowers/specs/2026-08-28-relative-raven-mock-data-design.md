# Relative Raven Mock Data Design

## Goal

Keep the existing mock-data command useful indefinitely by rebuilding one isolated Raven
home with ToDo and Ledger records anchored to the day the script runs. The resulting data
must exercise the current Ledger Reports charts without writing directly to SQLite or
touching a live Raven home.

## Command and safety

- Extend both `scripts/create-mock-db.sh` and `scripts/create-mock-db.ps1`; do not add a
  second user-facing seed command.
- Keep the default home at `.mock-data/todo-engine` for compatibility. Running against that
  default deletes and recreates only that exact directory.
- Continue refusing to overwrite an existing database at a custom path and continue
  rejecting the legacy live ToDo home.
- Initialize Raven once, then seed both domains exclusively through `raven todo` and
  `raven ledger` commands so validation, service policy, and audit history remain active.

## Relative dates

Each script captures its local calendar date once at startup. All other dates derive from
that anchor:

- ToDo uses yesterday, today, tomorrow, the current Monday-based week, current month, and
  current year.
- Ledger covers the inclusive 90 days ending today.
- Re-running the default command replaces the old mock home, so no persisted fixed-date
  records survive into the next run.

The shell and PowerShell implementations must produce the same relative-date intent even
though they use their platform-native date arithmetic.

## Ledger fixture

Seed a compact KRW dataset that makes every Reports section meaningful:

- several positive-balance asset accounts and one negative-balance credit account;
- salary and secondary income distributed through the 90-day window;
- recurring and irregular expenses across at least eight named categories;
- one uncategorized expense;
- enough date variation for daily, weekly, and monthly trend buckets;
- at least one transfer so balance composition is realistic without inflating income or
  spending;
- a USD account with an opening balance and no period entries to cover balance-only currency
  behavior.

Amounts remain deterministic; only their dates move. The fixture should be small enough to
create quickly and large enough to show category Top 7 + Other, Uncategorized drilldown,
asset/liability donuts, and income/spending patterns.

## ToDo correction

Preserve the existing ToDo fixture content and relationships, but make the relative-date
contract explicit and regression-tested. Tests must verify stored task/event/goal dates
against the current run date rather than merely checking titles. This distinguishes a fresh
seed from an old database left on disk.

## Verification

Extend the mock seed smoke test to create a temporary home and assert:

- expected ToDo records land on yesterday, today, tomorrow, and current period anchors;
- Ledger balances include positive assets, a liability, and the balance-only USD account;
- the current 90-day report contains both income and spending;
- at least eight expense categories plus an uncategorized row are present;
- all seeded Ledger entry dates fall within the computed 90-day range.

The verification remains isolated from live data and may inspect the temporary databases
read-only after all mutations have gone through the CLI.
