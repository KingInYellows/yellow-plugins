---
title: Freeze date in bats tests that assert exact sleep lengths
date: 2026-10-26
category: code-quality
track: knowledge
problem: 'Bats test asserting exact sleep lengths flakes on slow CI runners'
tags: [bats, flaky-test, shell-testing, yellow-review, ci]
severity: minor
component: plugins/yellow-review/tests/poll-new-threads.bats
symptoms:
  - '`Plugin Shell Tests (yellow-review)` fails at `poll-new-threads.bats:128`
    with the sleep log reading `9` instead of `10`'
  - The same commit passes locally and on a re-run
root_cause:
  poll-new-threads shortens each sleep by real `date +%s` elapsed time, and the
  test stubbed `sleep` but not `date`, so a second ticking over on a slow runner
  shrank the asserted sleep
resolution:
  setup() stubs a frozen `date` (always 1000) so elapsed time equals time slept;
  wall-clock tests keep their own advancing fake clock
---

# Freeze date in bats tests that assert exact sleep lengths

## Problem

On #1361 (a CHANGELOG-only change), `Plugin Shell Tests (yellow-review)` failed
at `poll-new-threads.bats:128`, "a zero-padded --wait is read as decimal, not
octal". The `--wait 010` half expected the sleep log to read `10` and got `9`. A
re-run passed.

## Root cause

`poll-new-threads` measures elapsed time with `date +%s` and caps each sleep at
the remaining wait. The test stubbed `sleep` (to log its argument) but used the
real `date`, so any second that passed between `START` and the first `tick` on a
slow runner reduced the remaining wait and the logged sleep.

## Fix

Stub a frozen clock in `setup()` next to the `sleep` stub:

```bash
printf '#!/bin/sh\necho 1000\n' >"${BATS_TEST_TMPDIR}/stubs/date"
```

With `date` constant, the script's `tick` falls back to the time slept, so the
sleep sequence is deterministic. Tests that exercise the wall-clock bound
(`clock_setup`) overwrite the stub with a fake clock that `sleep` and the fetch
stub advance.

## Rule

When a bats test asserts exact values derived from elapsed time, stub every
clock source the script reads (`date`, `sleep`, `SECONDS`), not only the one
whose calls are being logged.
