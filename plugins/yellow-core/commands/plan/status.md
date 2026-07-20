---
name: plan:status
description: 'Show a per-file checkbox progress dashboard of plans/ (open) and plans/complete/ (archived). Use when reviewing which plans are ready to archive or checking work-in-flight at a glance.'
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
A + Gate C) and `/workflows:plan` (creates plans). See
`plugins/yellow-core/CLAUDE.md` for the namespace split.

## Usage

Invoke the `Skill` tool with `skill: "plan-status"`.
