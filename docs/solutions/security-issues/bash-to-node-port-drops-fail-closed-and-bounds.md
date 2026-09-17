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

**Update (PR #661 review):** The 64KB stdin cap was reinstated in the
initial port. During code review, a security issue was identified: when
input exceeded 64KB and was truncated, the resulting malformed JSON would
trigger fail-open behavior for `check-git-push`, allowing a large payload
starting with `git push` to bypass the blocker. This was fixed to fail
closed (deny) on truncation for the PreToolUse hook specifically, while
preserving the original fail-open behavior for PostToolUse's parse
failures.

**Update (2026-09-17, PR #802 review):** A third variant of the same
fail-open-on-shape-mismatch class surfaced once `policy-check-git-push.js`
was fixed to read `toolInput.command` (see
[posttooluse-hook-input-schema-field-paths.md](../code-quality/posttooluse-hook-input-schema-field-paths.md)'s
2026-09-16 update). A present-but-non-string `tool_input.command` (e.g. a
number or object, not the missing-field case) was coerced to `''` and
silently allowed — no fixture exercised that shape, the same blind spot
that let the missing-dependency and truncation variants ship undetected.
Fixed to deny with `MALFORMED_MESSAGE` when `command` is present but not a
string, mirroring `run-hook.js`'s existing truncation-deny path; `undefined`
(field genuinely absent) still allows — that shape means "not a Bash
tool call, nothing to check," not "can't verify," so it stays an
intentional allow rather than joining the fail-closed cases below. The
three variants found across two reviews of the same hook — missing
dependency, truncated/malformed JSON, and present-but-wrong-type field —
say the same thing three times: **for a security-relevant guard, don't
special-case "can't verify the input" as allow.** Any shape the guard
receives but can't positively confirm as safe (present-but-truncated,
present-but-wrong-type) should fail closed by default, and each new
ported/edited hook should get a fixture for all three variants (absent,
truncated, wrong-type) up front instead of waiting for a review to find
the next one.

## Related Documentation

- [golden-fixture-parity-vs-contract-correctness.md](../code-quality/golden-fixture-parity-vs-contract-correctness.md) —
  why the parity harness that validated this port didn't catch either gap
- [codex-plugin-manifest-and-hook-contract.md](../integration-issues/codex-plugin-manifest-and-hook-contract.md) —
  the cross-host hook contract this port implements
