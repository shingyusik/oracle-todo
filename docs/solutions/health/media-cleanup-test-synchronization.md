# Synchronizing media cleanup failure tests

Date: 2026-10-16. Source base: `48718d7`.
Applies to the Unix Health media compensation regression.

## Symptoms and reproduction

The polling variant of
`diet::database_and_compensation_remove_failure_keeps_durable_recovery_identity`
can fail while waiting for a file watcher to make the media directory read-only.
The watcher reports that media was not published, followed by a disconnected
readiness channel.

Reproduction evidence for the polling variant:

- The Health integration suite reported 114 passed and 1 failed.
- Three concurrent executions with independent temporary fixtures produced two
  failures and one pass.
- Both failures returned `Err(Busy("database is locked"))` from `store_media`.

## Confirmed cause

The test inferred completed finalization from external PNG visibility. Its
watcher had a 500 ms polling budget beginning before staging. After finalization,
the service attempts a database transaction with a 250 ms SQLite busy timeout,
then compensates by removing the published media when the writer lock persists.

A plain `Busy` result establishes that staging and finalization succeeded and
compensation removed the media successfully. A compensation failure would return
`HealthError::Cleanup` with the primary error preserved. The watcher can miss the
finite visibility window and report failure even when those operations succeed.

The confirmed fault is the test's observation race. The exact delay location is
undetermined: staging or filesystem synchronization can consume the polling
budget, and watcher scheduling can miss publication. Scheduler delay alone is
not established by the evidence.

## Fix and prevention

A function-local `ReadOnlyAfterFinalize` adapter delegates every `MediaStore`
operation to the real `LocalMediaStore`. Its `finalize` method waits for real
finalization to succeed, sets the directory permissions to `0500`, and returns
the stored media. This establishes the failure condition synchronously before
the service attempts its database transaction.

The regression retains the actual SQLite writer lock, busy error, filesystem
unlink failure, and durable recovery journal. It asserts that the returned
cleanup error preserves `Busy`, recovery paths are relative, and recovery listing
returns the same identity. Original directory permissions are restored before
inspecting the result.

Keep failure injection at the adapter operation boundary rather than polling a
short-lived filesystem side effect. Run permission-based cases as an
unprivileged Unix user against temporary fixtures. No production test hook,
SQLite timeout change, or longer polling budget is required.

## Verification

Focused regression on Ubuntu WSL with Rust 1.92.0:

```bash
cargo test --locked -p health-engine --test integration \
  diet::database_and_compensation_remove_failure_keeps_durable_recovery_identity \
  -- --exact --nocapture
```

- Focused Cargo execution: 1 passed.
- The emitted integration test executable, invoked three times concurrently with
  the same exact filter and independent temporary fixtures: 3 passed.
- Total focused executions: 4 passed.

Related code:

- `health-engine/tests/integration/diet.rs`:
  `database_and_compensation_remove_failure_keeps_durable_recovery_identity`.
- `health-engine/src/application/diet.rs`: `HealthService::store_media`.
- `health-engine/src/application/service.rs`: `cleanup_with_primary`.
- `health-engine/src/infrastructure/media.rs`: real finalization and removal.
- `health-engine/src/infrastructure/sqlite/mod.rs`: `SQLITE_BUSY_TIMEOUT`.
