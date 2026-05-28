---
name: plan:status
description: 'Show a per-file checkbox progress dashboard of plans/ (open) and plans/complete/ (archived). Use when reviewing which plans are ready to archive or checking work-in-flight at a glance.'
argument-hint: ''
allowed-tools:
  - Bash
---

# Plan Status

Read-only dashboard of the local plan corpus. Walks `plans/*.md` (open) and
`plans/complete/*.md` (archived), counts checked/unchecked task boxes in each
file, and renders a plain-text table. Open plans at 100% completion are
annotated `-- ready to complete` so the next archival step is obvious.

This command is a sibling of `/plan:complete` (archives a plan after Gate
A + Gate C) and `/workflows:plan` (creates plans). See
`plugins/yellow-core/CLAUDE.md` for the namespace split.

## Phase 1: Open plans

```bash
set -euo pipefail
if ! ls plans/*.md >/dev/null 2>&1; then
  printf 'plans/ is empty (no open plans).\n\n'
  exit 0
fi
printf 'Open plans (plans/):\n'
printf '%-60s %s\n' 'File' 'Progress'
printf '%-60s %s\n' '----' '--------'
for f in plans/*.md; do
  [ -f "$f" ] || continue
  checked=$(grep -ciE '^[[:space:]]*- \[x\]' "$f" 2>/dev/null || true)
  unchecked=$(grep -cE '^[[:space:]]*- \[ \]' "$f" 2>/dev/null || true)
  : "${checked:=0}"
  : "${unchecked:=0}"
  total=$((checked + unchecked))
  annotation=''
  if [ "$total" -gt 0 ] && [ "$unchecked" -eq 0 ]; then
    annotation='  -- ready to complete'
  fi
  printf '%-60s [ %d/%d ]%s\n' "$f" "$checked" "$total" "$annotation"
done
printf '\n'
```

## Phase 2: Archived plans

Each Bash code block runs in its own subprocess — variables from Phase 1
do not survive (see `MEMORY.md` "$VAR in bash code blocks"). Re-derive
locally.

```bash
set -euo pipefail
if [ ! -d plans/complete ]; then
  printf 'Archived plans (plans/complete/): (0) — directory does not exist yet.\n'
  exit 0
fi
count=$(find plans/complete -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -eq 0 ]; then
  printf 'Archived plans (plans/complete/): (0)\n'
  exit 0
fi
printf 'Archived plans (plans/complete/): (%d)\n' "$count"
printf '%-60s %s\n' 'File' 'Progress'
printf '%-60s %s\n' '----' '--------'
for f in plans/complete/*.md; do
  [ -f "$f" ] || continue
  checked=$(grep -ciE '^[[:space:]]*- \[x\]' "$f" 2>/dev/null || true)
  unchecked=$(grep -cE '^[[:space:]]*- \[ \]' "$f" 2>/dev/null || true)
  : "${checked:=0}"
  : "${unchecked:=0}"
  total=$((checked + unchecked))
  printf '%-60s [ %d/%d ]\n' "$f" "$checked" "$total"
done
```

## Notes

- The `[ 0/0 ]` rendering for zero-task plans is intentional and surfaces
  prose-style or research-style plan files that have no task list.
- The `-- ready to complete` annotation appears ONLY on files in `plans/`
  (not on already-archived files). It is purely advisory — running
  `/plan:complete <file>` is the explicit archival action.
- Archived files with stray `- [ ]` lines are visible in this dashboard
  but are NOT blocked: PR-diff-scoped validation (`pnpm validate:plans`)
  only checks files newly added or modified by the current PR. The
  dashboard exists to surface those cases for opportunistic cleanup.
