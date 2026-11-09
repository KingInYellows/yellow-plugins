#!/usr/bin/env bats
# Contract tests for the settled-decisions protocol
# (plugins/yellow-core/references/flow-plan/settled-decisions.md, CLAUDE-212).
# The protocol is prompt text, so these pin the parts other steps and tools
# grep for: the annotation stem, the two class tokens, the invalidation token,
# and that every flow step that reads or writes settled entries loads the
# reference. The settled_entry / missing_alternative helpers are the greps a
# reader of a plan, shell or brainstorm doc uses to find valid and invalid
# entries.

ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REF="$ROOT/references/flow-plan/settled-decisions.md"

settled_entry() {
  grep -E '\(session-settled: (user-directed|user-approved) — chosen over [^:]+: .+\)' "$1"
}

missing_alternative() {
  grep -E '\(session-settled: ' "$1" | grep -vE '— chosen over [^:]+: .+\)' || true
}

@test "reference pins the annotation stem and both class tokens" {
  grep -qF '(session-settled: <class> — chosen over <rejected alternative>: <one-line reason>)' "$REF"
  grep -qF '`user-directed`' "$REF"
  grep -qF '`user-approved`' "$REF"
}

@test "reference pins the invalidation token and its block shape" {
  grep -qxF '    settled-decision-invalidated' "$REF"
  grep -qF 'Decision: <the settled entry>' "$REF"
  grep -qF 'Reason: <the invalidating evidence' "$REF"
}

@test "reference forbids self-settling and empty sections" {
  grep -qF 'Never label your own unexamined proposal' "$REF"
  grep -qF 'Never write an empty one.' "$REF"
}

@test "every flow step that handles settled entries loads the reference" {
  for f in \
    commands/flow/plan.md \
    commands/flow/spec.md \
    commands/flow/work.md \
    agents/workflow/brainstorm-orchestrator.md; do
    grep -qF '${CLAUDE_PLUGIN_ROOT}/references/flow-plan/settled-decisions.md' "$ROOT/$f" \
      || { echo "missing reference load in $f"; return 1; }
  done
}

@test "decompose and expand-shell carry the Settled Decisions section" {
  grep -qF '## Settled Decisions' "$ROOT/commands/flow/decompose.md"
  grep -qF '## Settled Decisions' "$ROOT/commands/flow/expand-shell.md"
}

@test "plan accepts --non-interactive and returns the invalidation token" {
  grep -qF "argument-hint: '[feature description] [--non-interactive]'" "$ROOT/commands/flow/plan.md"
  grep -qF 'settled-decision-invalidated' "$ROOT/commands/flow/plan.md"
}

@test "grep finds a well-formed entry" {
  doc="$BATS_TEST_TMPDIR/brainstorm.md"
  printf '%s\n' '## Key Decisions' \
    '- Use the GitHub stack provider (session-settled: user-directed — chosen over Graphite: the queue keeps timing out)' \
    > "$doc"
  run settled_entry "$doc"
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
  run missing_alternative "$doc"
  [ -z "$output" ]
}

@test "grep flags an entry with no rejected alternative" {
  doc="$BATS_TEST_TMPDIR/plan.md"
  printf '%s\n' '## Settled Decisions' \
    '- Cache in Redis (session-settled: user-approved)' \
    > "$doc"
  run settled_entry "$doc"
  [ "$status" -ne 0 ]
  run missing_alternative "$doc"
  [ -n "$output" ]
}

@test "grep ignores unknown classes" {
  doc="$BATS_TEST_TMPDIR/plan.md"
  printf '%s\n' '- Use X (session-settled: agent-proposed — chosen over Y: faster)' > "$doc"
  run settled_entry "$doc"
  [ "$status" -ne 0 ]
}
