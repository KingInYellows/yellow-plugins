#!/usr/bin/env bats
# Parity gate for the plan-status skill
# (plugins/yellow-core/skills/plan-status/SKILL.md). Duplicates its Phase
# 1/2 bash logic verbatim (as bats functions, since a bare `exit` would
# terminate the bats runner rather than just the block — `return` is the
# function-scoped equivalent) and diffs captured output against the golden
# fixtures captured before the skill extraction, proving byte-identical
# behavior before/after the status.md -> skill move.

FIXTURE_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/fixtures/plan-status" && pwd)"

run_phase1() {
  set -euo pipefail
  if ! ls plans/*.md >/dev/null 2>&1; then
    printf 'plans/ is empty (no open plans).\n\n'
    return 0
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
}

run_phase2() {
  set -euo pipefail
  if [ ! -d plans/complete ]; then
    printf 'Archived plans (plans/complete/): (0) — directory does not exist yet.\n'
    return 0
  fi
  count=$(find plans/complete -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    printf 'Archived plans (plans/complete/): (0)\n'
    return 0
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
}

# Runs both phases from inside the fixture scenario's root (so `$f` expands
# to the same "plans/foo.md"-relative string the golden files were captured
# with) in an explicit subshell -- keeps the `cd` and each phase's
# `set -euo pipefail` from leaking into the bats runner process.
capture_actual() {
  local scenario="$1"
  (cd "$FIXTURE_ROOT/$scenario" && LC_ALL=C run_phase1 && LC_ALL=C run_phase2)
}

@test "plan-status skill logic matches golden output: empty" {
  diff "$FIXTURE_ROOT/empty.golden.txt" <(capture_actual empty)
}

@test "plan-status skill logic matches golden output: mixed" {
  diff "$FIXTURE_ROOT/mixed.golden.txt" <(capture_actual mixed)
}

@test "plan-status skill logic matches golden output: zero-task" {
  diff "$FIXTURE_ROOT/zero-task.golden.txt" <(capture_actual zero-task)
}
