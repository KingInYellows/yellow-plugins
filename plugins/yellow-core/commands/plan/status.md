---
name: plan:status
# prettier-ignore
description: "Use when checking which plans are ready to archive or what work is in flight. Shows per-file checkbox progress for plans/ (open) and plans/complete/ (archived)."
argument-hint: ''
allowed-tools:
  - Bash
  - Skill
---

# Plan Status

Read-only dashboard of the local plan corpus. Walks `plans/*.md` (open) and
`plans/complete/*.md` (archived), counts checked/unchecked task boxes in each
file, and renders a plain-text table. Open plans at 100% completion are
annotated `-- ready to complete` so the next archival step is obvious.

This command is a sibling of `/plan:complete` (archives a plan after Gate
A + Gate C) and `/flow:plan` (creates plans). See
`plugins/yellow-core/CLAUDE.md` for the namespace split.

## Usage

Invoke the `Skill` tool with `skill: "plan-status"`.
