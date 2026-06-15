#!/usr/bin/env python3
"""Restore Panorion local env files from the active local Supabase stack."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
FRONTEND_ENV = ROOT / "frontend" / ".env.local"
ROOT_ENV = ROOT / ".env"
ADJACENT_ENV = ROOT.parent / "Panorion" / ".env"
SUPABASE_URL = "http://127.0.0.1:54321"
DATABASE_URL = "postgresql://postgres:postgres@localhost:54322/postgres"


def read_key_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        if not raw_line or raw_line.lstrip().startswith("#") or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def keys_from_adjacent_env() -> tuple[str, str] | None:
    values = read_key_values(ADJACENT_ENV)
    anon = values.get("SUPABASE_ANON_KEY") or values.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    service = values.get("SUPABASE_SERVICE_ROLE_KEY")
    if anon and service and anon.startswith("sb_") and service.startswith("sb_"):
        return anon, service
    return None


def docker_container_names() -> list[str]:
    result = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def keys_from_kong() -> tuple[str, str] | None:
    for name in docker_container_names():
        if not name.startswith("supabase_kong_"):
            continue
        result = subprocess.run(
            ["docker", "exec", name, "cat", "/home/kong/kong.yml"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            continue
        publishable = re.search(r"sb_publishable_[A-Za-z0-9_-]+", result.stdout)
        secret = re.search(r"sb_secret_[A-Za-z0-9_-]+", result.stdout)
        if publishable and secret:
            return publishable.group(0), secret.group(0)
    return None


def upsert_env(path: Path, updates: dict[str, str]) -> None:
    existing = path.read_text().splitlines() if path.exists() else []
    seen: set[str] = set()
    output: list[str] = []

    for line in existing:
        key = line.split("=", 1)[0].strip() if "=" in line else ""
        if key in updates:
            output.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            output.append(line)

    if output and output[-1].strip():
        output.append("")
    for key, value in updates.items():
        if key not in seen:
            output.append(f"{key}={value}")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(output).rstrip() + "\n")


def main() -> int:
    keys = keys_from_adjacent_env() or keys_from_kong()
    if keys is None:
        print(
            "Could not find local Supabase sb_publishable/sb_secret keys. "
            "Start Supabase or inspect docker ps first.",
            file=sys.stderr,
        )
        return 1

    anon_key, service_role_key = keys
    upsert_env(
        ROOT_ENV,
        {
            "SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_ANON_KEY": anon_key,
            "SUPABASE_SERVICE_ROLE_KEY": service_role_key,
            "DATABASE_URL": DATABASE_URL,
            "NEXT_PUBLIC_SITE_URL": "http://localhost:3000",
            "NEXT_PUBLIC_SUPABASE_URL": SUPABASE_URL,
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": anon_key,
            "NEXT_PUBLIC_API_URL": "http://localhost:8001/api/v1",
        },
    )
    upsert_env(
        FRONTEND_ENV,
        {
            "NEXT_PUBLIC_SITE_URL": "http://localhost:3000",
            "NEXT_PUBLIC_SUPABASE_URL": SUPABASE_URL,
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": anon_key,
            "NEXT_PUBLIC_API_URL": "http://localhost:8001/api/v1",
        },
    )
    print(f"Restored {ROOT_ENV}")
    print(f"Restored {FRONTEND_ENV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
