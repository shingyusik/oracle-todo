---
name: resource-lifecycle-audit
description: Use when asked to audit resource management and lifecycle — leaked file handles, unmanaged subprocesses or containers, missing timeouts, unbounded memory from loading large files whole, missing cleanup on error paths, or duplicate expensive calls.
---

# Resource Lifecycle Audit

## Objective

Report resources acquired but not reliably released, operations that can hang or grow without bound, and expensive work done redundantly. Every finding here is a leak, a hang, or wasted cost under some execution path. Report only — no fixes during the audit.

## Scope Resolution

1. Inventory the external resources this project touches: files, processes/subprocesses, containers, network connections, API clients (including LLM/paid APIs), threads/tasks, temp directories, GPU/native handles.
2. For each resource type, find every acquisition site, then trace its release path — including the error path.

## Audit Checks

1. **Unmanaged handles** — files/sockets/connections opened without a scoped-release construct (context manager, try/finally, defer, using); release skipped when an exception fires between acquire and release.
2. **Process & container lifecycle** — spawned subprocesses/containers: who stops them on failure or interrupt? Flag orphan risk (spawn without wait/terminate on error), and persistent resources reused without a health/exists check.
3. **Missing timeouts** — subprocess calls, network/API requests, and waits with no timeout: any of these can hang the whole run indefinitely.
4. **Unbounded memory** — large files (logs, datasets, JSON/JSONL, models) read fully into memory where streaming/chunking exists; accumulating collections in long loops with no bound.
5. **Expensive-call discipline** — the same costly operation (API call, container exec, large parse) executed repeatedly with identical inputs inside one run; retries without backoff or attempt cap; paid API calls with no failure budget.
6. **Cleanup on cancel/error** — partial outputs and temp artifacts left behind when a run fails midway; does the code distinguish "keep for debugging" (intentional, documented) from "forgot to clean" (leak)?
7. **Concurrency hygiene** — shared state mutated from threads/tasks without coordination; fire-and-forget tasks whose failures vanish.

## What NOT to Flag

- Deliberately persistent resources (kept-alive containers, connection pools, caches) that the project documents as reused — verify the docs first; flag only their missing failure handling.
- Whole-file reads of small bounded files (configs, specs).
- Short-lived scripts where the OS reclaims everything on exit and nothing external (containers, remote state) outlives the process.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Fields:

| Field | Content |
| --- | --- |
| Severity | HIGH (leak/hang reachable in normal failure paths) / MEDIUM (reachable on edge paths) / LOW (cost/hygiene) |
| Location | `path:line` of the acquisition |
| Resource | file / process / container / network / memory / api-cost / task |
| Evidence | Acquire site + the path on which release is skipped |
| Suggestion | Scoped-release construct, timeout value source, streaming approach, or check to add |

## Safety Rules

1. Audit only — no edits, and do not start/stop/clean any real resource (container, process) to "verify" a finding.
2. A leak finding must name the concrete execution path that skips release — "might leak" without a path is not a finding.
3. Check docs before flagging persistence as a leak; intentional reuse is a feature.
