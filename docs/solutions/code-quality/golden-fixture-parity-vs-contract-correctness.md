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

## Related Documentation

- [posttooluse-hook-input-schema-field-paths.md](./posttooluse-hook-input-schema-field-paths.md) —
  the specific field-path bug this parity gap hid
- [codex-plugin-manifest-and-hook-contract.md](../integration-issues/codex-plugin-manifest-and-hook-contract.md) —
  primary-source hook envelope/contract facts the fixtures should have been
  checked against
