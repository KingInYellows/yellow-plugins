---
title: 'Bash-to-Node hook port silently dropped fail-closed exit and a documented stdin bound'
date: 2026-07-22
category: 'security-issues'
track: knowledge
problem: 'Porting a bash security hook to Node preserved happy-path logic but flipped an error path from fail-closed to fail-open and dropped a documented stdin size cap'
tags:
  - hook-port
  - fail-open
  - fail-closed
  - resource-bound
  - migration
  - exit-codes
components:
  - plugins/gt-workflow/hooks/scripts/entrypoint-claude.js
  - plugins/gt-workflow/hooks/scripts/lib/run-hook.js
---

# Bash-to-Node hook port silently dropped fail-closed exit and a documented stdin bound

## Problem

Porting `check-git-push.sh` (and siblings) to `entrypoint-claude.js` +
`lib/run-hook.js` preserved happy-path logic but dropped two safety
properties that existed only as edge-case/defensive code in the bash
originals — neither exercised by normal-case fixtures:

1. **Fail-closed became fail-open.** The bash version exits 2 (block) on a
   missing dependency (e.g. `jq` not found) — a deliberate fail-closed
   choice for a security-relevant hook. `entrypoint-claude.js`'s top-level
   `.catch()` handler (around line 13) catches any uncaught error and sets
   `process.exitCode = 1`, which Claude Code treats as non-blocking/allow.
   The same failure class now fails open — the inversion of the original's
   intent.
2. **A documented bound silently disappeared.** The bash version had a
   commented-out 64KB cap on stdin read size — a recorded design decision,
   even though inactive. `lib/run-hook.js`'s `readStdin` (around line 29)
   reads unbounded stdin in the Node port; the bound was not ported
   forward, active or as a comment.

Neither gap is caught by a parity harness (see
[golden-fixture-parity-vs-contract-correctness.md](../code-quality/golden-fixture-parity-vs-contract-correctness.md))
because both are edge-case paths that normal-case fixtures don't exercise.

## Detection

When porting shell to another language, diff exit codes on every
non-happy-path branch (missing deps, malformed input, unexpected
exceptions), not just happy-path output. Grep the original source for
comments describing bounds/caps/limits — even commented-out ones — before
treating a port as complete; a commented-out safety measure is a recorded
decision, not dead code to drop silently. For any hook whose original had
explicit `exit N` on error paths, verify the port's top-level error handler
maps to the same exit-code family.

## Fix or Guidance

Reinstate the fail-closed exit code for `check-git-push`'s uncaught-error
path in `entrypoint-claude.js`. Reinstate a stdin size cap in
`run-hook.js`'s `readStdin`. Migration checklists for shell-to-language
ports should include an explicit "exit-code contract" and "bounds/limits"
section, not just "output matches."

## Related Documentation

- [golden-fixture-parity-vs-contract-correctness.md](../code-quality/golden-fixture-parity-vs-contract-correctness.md) —
  why the parity harness that validated this port didn't catch either gap
- [codex-plugin-manifest-and-hook-contract.md](../integration-issues/codex-plugin-manifest-and-hook-contract.md) —
  the cross-host hook contract this port implements
