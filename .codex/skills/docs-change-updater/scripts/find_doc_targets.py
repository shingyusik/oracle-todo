#!/usr/bin/env python3
"""Identify documentation files that should be updated for current git changes."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    ".tmp-skillenv",
    ".venv",
    "venv",
    "__pycache__",
}


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or "unknown git error"
        raise RuntimeError(f"git {' '.join(args)} failed: {message}")
    return result.stdout.strip()


def get_repo_root(start: Path) -> Path:
    root = run_git(start, "rev-parse", "--show-toplevel")
    return Path(root)


def collect_changed_files(repo: Path, include_last_commit: bool) -> list[str]:
    changed: set[str] = set()

    commands = [
        ("diff", "--name-only"),
        ("diff", "--cached", "--name-only"),
        ("ls-files", "--others", "--exclude-standard"),
    ]
    for cmd in commands:
        out = run_git(repo, *cmd)
        if not out:
            continue
        changed.update(line.strip() for line in out.splitlines() if line.strip())

    if include_last_commit:
        out = run_git(repo, "diff", "--name-only", "HEAD~1", "HEAD")
        changed.update(line.strip() for line in out.splitlines() if line.strip())

    filtered = []
    for rel in sorted(changed):
        parts = Path(rel).parts
        if any(part in SKIP_DIRS for part in parts):
            continue
        filtered.append(rel)
    return filtered


def list_docs_files(repo: Path) -> list[str]:
    docs_dir = repo / "docs"
    if not docs_dir.exists():
        return []
    return sorted(str(path.relative_to(repo)) for path in docs_dir.rglob("*.md"))


def list_readme_files(repo: Path) -> list[str]:
    readmes: list[str] = []
    root_readme = repo / "README.md"
    if root_readme.exists():
        readmes.append("README.md")

    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for file_name in files:
            if file_name != "README.md":
                continue
            rel = str((Path(root) / file_name).relative_to(repo))
            if rel not in readmes:
                readmes.append(rel)
    return sorted(readmes)


def recommend_new_docs(repo: Path, changed_files: list[str]) -> list[dict[str, str]]:
    recommendations: list[dict[str, str]] = []
    seen_areas: set[str] = set()

    for rel in changed_files:
        rel_path = Path(rel)
        rel_lower = rel.lower()
        if rel_lower.startswith("docs/") or rel_lower == "readme.md":
            continue
        if rel_path.suffix.lower() in {".md", ".txt"}:
            continue
        if len(rel_path.parts) < 2:
            continue

        area = rel_path.parts[0]
        if area in seen_areas:
            continue
        seen_areas.add(area)

        candidate_file = repo / "docs" / f"{area}.md"
        candidate_dir_readme = repo / "docs" / area / "README.md"
        if candidate_file.exists() or candidate_dir_readme.exists():
            continue

        recommendations.append(
            {
                "area": area,
                "suggested_path": f"docs/{area}.md",
                "reason": f"Code changes detected in '{area}' without matching docs file.",
            }
        )

    return recommendations


def as_markdown(payload: dict) -> str:
    lines: list[str] = []
    lines.append("# Documentation Targets")
    lines.append("")

    lines.append("## Changed Files")
    if payload["changed_files"]:
        lines.extend(f"- `{path}`" for path in payload["changed_files"])
    else:
        lines.append("- (none)")
    lines.append("")

    lines.append("## README Candidates")
    if payload["readme_files"]:
        lines.extend(f"- `{path}`" for path in payload["readme_files"])
    else:
        lines.append("- (none)")
    lines.append("")

    lines.append("## Docs Files")
    if payload["docs_files"]:
        lines.extend(f"- `{path}`" for path in payload["docs_files"])
    else:
        lines.append("- (none)")
    lines.append("")

    lines.append("## Recommended New Docs")
    if payload["recommended_new_docs"]:
        for item in payload["recommended_new_docs"]:
            lines.append(
                f"- `{item['suggested_path']}`: {item['reason']}"
            )
    else:
        lines.append("- (none)")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find documentation update targets from git changes."
    )
    parser.add_argument(
        "--repo",
        default=".",
        help="Path inside the target git repository (default: current directory).",
    )
    parser.add_argument(
        "--include-last-commit",
        action="store_true",
        help="Include files from HEAD~1..HEAD in addition to working tree changes.",
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="Output format (default: markdown).",
    )
    args = parser.parse_args()

    try:
        repo = get_repo_root(Path(args.repo).resolve())
    except Exception as exc:  # pragma: no cover - command-line reporting
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    changed_files = collect_changed_files(repo, args.include_last_commit)
    payload = {
        "repo_root": str(repo),
        "changed_files": changed_files,
        "readme_files": list_readme_files(repo),
        "docs_files": list_docs_files(repo),
        "recommended_new_docs": recommend_new_docs(repo, changed_files),
    }

    if args.format == "json":
        print(json.dumps(payload, indent=2, ensure_ascii=True))
    else:
        print(as_markdown(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
