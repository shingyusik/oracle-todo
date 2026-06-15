---
name: panorion-local-env
description: Use when setting up, restoring, debugging, or starting the Panorion local development environment, especially Supabase auth keys, .env files, localhost servers, onboarding/login failures, or auth entry-state errors.
---

# Panorion Local Env

## Overview

Use this skill to prepare the Panorion local stack without overwriting working Supabase configuration with placeholder values. The main invariant: never copy `.env.example` over active local env files unless no real local Supabase stack exists.

## Workflow

1. Run `git status --short` before any file edit.
2. Check existing servers and ports:
   - `lsof -nP -iTCP:3000 -sTCP:LISTEN || true`
   - `lsof -nP -iTCP:8001 -sTCP:LISTEN || true`
   - `lsof -nP -iTCP:54321 -sTCP:LISTEN || true`
   - `lsof -nP -iTCP:54322 -sTCP:LISTEN || true`
   - `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'`
3. Restore env files from the active local Supabase stack:
   - `python3 .codex/skills/panorion-local-env/scripts/restore_local_env.py`
   - This updates only `.env` and `frontend/.env.local`.
4. Start or restart servers so env changes are loaded:
   - backend: `cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload`
   - frontend: `cd frontend && npm run dev`
5. Verify with the local test account:
   - email: `shinchoi@local.dev`
   - password: `Shinchoi123!`

## Supabase Rules

- Treat `eyJ...` in env files as a placeholder, not a valid key.
- If `54321` or `54322` is already allocated, identify the owner before starting another database.
- Prefer the already-running local Supabase stack when its containers are healthy.
- For this workstation, the active stack may be named `supabase_*_Panorion` even when working from `Panorion-payment-feature`.
- Discover keys from the running Kong container (`/home/kong/kong.yml`) or the adjacent workspace env; do not invent keys.

## Verification

After startup, run:

```bash
TOKEN="$(curl -sS 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: $(awk -F= '/^NEXT_PUBLIC_SUPABASE_ANON_KEY=/{print $2; exit}' frontend/.env.local)" \
  -H 'Content-Type: application/json' \
  --data '{"email":"shinchoi@local.dev","password":"Shinchoi123!"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
curl -sS -o /tmp/panorion_entry_state.json -w '%{http_code}\n' \
  http://127.0.0.1:8001/api/v1/auth/entry-state \
  -H "Authorization: Bearer $TOKEN"
cat /tmp/panorion_entry_state.json
curl -sS -o /tmp/panorion_frontend.html -w '%{http_code}\n' http://127.0.0.1:3000/
```

Expected:

- entry-state HTTP status is `200`
- frontend HTTP status is `200`
- no `Failed to resolve auth entry state` or `Unhandled Runtime Error` in fetched HTML/server logs

## Common Fixes

- Placeholder env keys: run the restore script, then restart both servers.
- Port `54322` allocated: use the existing Supabase stack; do not run `docker compose up -d` blindly.
- Onboarding redirects to workspace: if entry-state returns `has_onboarding_profile=true` and `has_workspace=true`, that is expected for the local test user.
- Browser still shows Next.js overlay after a fix: refresh after both servers restart.

## Never Do

- Do not leave `SUPABASE_ANON_KEY=eyJ...`, `SUPABASE_SERVICE_ROLE_KEY=eyJ...`, or `NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...`.
- Do not overwrite a user's unrelated env changes.
- Do not claim the environment is fixed without running the entry-state verification.
