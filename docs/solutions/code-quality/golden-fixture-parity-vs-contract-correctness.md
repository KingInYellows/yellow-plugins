---
title: 'Golden-fixture parity proves bug parity, not contract correctness'
date: 2026-07-22
category: 'code-quality'
track: knowledge
problem: 'Bash-to-Node hook port passed a 100% fixture-parity harness while the ported hook never fires against a real host envelope'
tags:
  - testing
  - characterization-testing
  - golden-fixtures
  - parity-harness
  - bash-to-node-port
components:
  - plugins/gt-workflow/tests/hook-parity.bats
  - plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js
---

# Golden-fixture parity proves bug parity, not contract correctness

## Problem

When porting an implementation from one language/runtime to another (e.g.
bash to Node), a common validation strategy is a "parity harness": fixtures
capture the old implementation's input/output, then get replayed against the
new implementation to prove equivalence. This catches *regressions*
introduced by the port. It provides zero evidence the ported behavior is
*correct* against the real external contract, because the fixtures were
fabricated from the code under test, not an independent primary source (real
hook payloads, protocol docs).

In gt-workflow's bash-to-Node hook port, `policy-check-git-push.js`
deliberately reproduced `check-git-push.sh`'s field-path bug — reading
`command` at the envelope root instead of `tool_input.command` (see
[posttooluse-hook-input-schema-field-paths.md](./posttooluse-hook-input-schema-field-paths.md)'s
2026-07-22 update). The fixtures backing `hook-parity.bats` were built to
match that same wrong shape, so the harness reports full parity while the
underlying hook never fires against a real PreToolUse envelope from either
host.

> **Update (2026-09-16):** resolved for this hook — the field path was
> corrected, the `check-git-push` fixtures now carry the real nested
> envelope, and the parity charter is retired for that hook. See the
> 2026-09-16 update in
> [posttooluse-hook-input-schema-field-paths.md](./posttooluse-hook-input-schema-field-paths.md).
> The lesson above stands: the harness reported 100% parity for two months
> while the hook never fired.

## Detection

Ask where each fixture's shape came from — the implementation under test, or
an independent source. A parity/characterization suite with 100% pass and
zero fixtures sourced from live/real payloads is a signal, not a guarantee.
Watch for doc-comments claiming "preserves X exactly" / "matches legacy
behavior" paired with a field path that contradicts primary-source docs
elsewhere in the repo.

## Fix or Guidance

Parity harnesses answer "did the port change behavior?" not "is the
behavior correct?" — these need separate fixture sources. When a
characterization-testing charter says "reproduce the original exactly,
don't fix bugs," record that decision AND file a follow-up to fix the
underlying bug. At least one fixture per contract-sensitive hook should be
captured from (or cross-checked against) a live/real payload or the host's
primary-source docs, not derived from the implementation under test.

---

## Update — 2026-09-17

### Fixing the field path was not the whole fix — a review still found three stale-invariant artifacts

`/review:pr` on the 2026-09-16 fix (above) found that correcting the field
path and retiring the parity charter left three artifacts still asserting
the pre-fix invariant — each one true when it was written, each one now
false as a side effect of the correctness fix, and none of them caught by
running the code or the fixtures:

- `plugins/gt-workflow/tests/hook-parity.bats`'s file header still said
  every golden fixture was captured from the deleted bash script. Re-running
  that capture procedure on the `check-git-push` goldens (now hand-built
  Node-contract fixtures, not bash captures) would have silently inverted
  them back to the never-fires shape.
- `plugins/gt-workflow/CLAUDE.md` said hook behavior was "unchanged from
  the original bash hooks" and that the parity gate "reproduces the deleted
  bash hooks' behavior exactly" — both literally true before 2026-09-16 and
  false after, with nothing marking the sentence as stale.
- `plugins/github-workflow/hooks/scripts/lib/policy-check-git-push.js`'s
  header comment still said gt-workflow's sibling read a root-level field;
  only the inline comment near the actual read had been updated in the
  original fix.

None of these were "the bug" — they were prose asserting a behavioral
invariant (parity, no-change, field shape) that the bug fix invalidated as
a side effect. The general lesson: **a correctness fix that makes a
previously-inert guard fire for the first time isn't done when the code and
fixtures are done.** Grep every artifact whose truth depended on the old
(never-firing) behavior — test-harness header comments describing capture
provenance, the owning plugin's `CLAUDE.md` prose about "unchanged"
behavior, and header/doc comments in sibling files that read the same
envelope shape — not just the fixtures a parity harness replays.

This blast radius isn't bounded by the plugin that owns the fix, either:
`plugins/yellow-devin/commands/devin/review-prs.md:449` documents a
degraded-mode exception ("fall back to raw `git push`") that assumed the
gt-workflow guard would never actually block it. Once the guard started
firing for real, that documented exception became a hard stop under
`READY_GRAPHITE` — a correctness fix in one plugin silently broke a
documented workaround in an unrelated plugin that keyed off the same host
behavior. That cross-plugin instance was flagged as an advisory follow-up,
not fixed in the same change — sweeping for this class of drift should
include sibling plugins that reference the same hook/guard, not just the
owning plugin's own docs and tests.

Separately, the same review also found a second recurrence of the
fail-open-on-shape-mismatch class this fix was meant to close: see the
2026-09-17 update in
[bash-to-node-port-drops-fail-closed-and-bounds.md](../security-issues/bash-to-node-port-drops-fail-closed-and-bounds.md).

## Related Documentation

- [posttooluse-hook-input-schema-field-paths.md](./posttooluse-hook-input-schema-field-paths.md) —
  the specific field-path bug this parity gap hid
- [codex-plugin-manifest-and-hook-contract.md](../integration-issues/codex-plugin-manifest-and-hook-contract.md) —
  primary-source hook envelope/contract facts the fixtures should have been
  checked against
- [bash-to-node-port-drops-fail-closed-and-bounds.md](../security-issues/bash-to-node-port-drops-fail-closed-and-bounds.md) —
  the fail-open/fail-closed class the same fix's follow-up review found a
  third instance of (present-but-wrong-type input)
