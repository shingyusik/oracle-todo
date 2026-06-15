---
name: writing-final-state-docs
description: Use when creating or editing project documentation, README files, architecture docs, guides, or reference docs where process notes, changelog entries, topic sprawl, or cross-reference webs could creep in
---

# Writing Final-State Docs

## Overview

Documentation describes the current result. Plans and roadmaps may describe process; ordinary docs must not.

## When to Use

Use for:

- README files
- Architecture docs
- Workflow docs
- Reference docs
- Skill or agent docs
- Any doc that might collect history, rationale drift, multiple topics, or cross-reference clutter

Do not use as the primary guide for:

- Roadmaps
- Implementation plans
- CHANGELOG files
- Release notes
- Migration logs

## Core Rules

- Write current truth, not the path taken to reach it.
- Keep change history in `CHANGELOG.md`, release notes, commits, or dedicated history docs.
- Do not record "changed from X to Y", "previously", "now", "recently", or "during cleanup" in stable docs.
- Keep one topic per file.
- Split a file when a secondary topic grows enough to stand alone.
- Prefer top-down documentation: broad topic docs point to focused child docs only when needed.
- Avoid bidirectional reference webs.
- Let narrow docs reference broader parent docs more often than parent docs reference every narrow doc.
- Use concise bullets, numbered lists, tables, and clear headings.
- Prefer short fragments over narrative paragraphs.
- Keep heading hierarchy clean: `#`, then `##`, then `###`.

## Quick Check

Before saving a doc, ask:

- Does this describe the final/current state?
- Is process or history moved to an appropriate history file?
- Does this file have one clear topic?
- Should any section be split into a separate doc?
- Are references mostly top-down or child-to-parent?
- Can a reader scan it through headings and bullets?

## Bad Patterns

| Pattern | Fix |
| --- | --- |
| "We changed X to Y" | State only Y |
| "This used to live in..." | Move to changelog |
| README contains roadmap history | Move to roadmap or changelog |
| One doc covers unrelated topics | Split by topic |
| Two docs point at each other repeatedly | Pick a parent-child direction |
| Long explanatory paragraphs | Convert to headings and bullets |
