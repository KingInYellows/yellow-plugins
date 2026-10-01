---
title: 'A Negated grep in the Middle of a bats Test Never Fails'
date: 2026-10-01
category: code-quality
track: knowledge
problem: '`! grep -q pat file` mid-test passes under errexit even when the pattern is present'
tags: [bats, testing, errexit, negation, grep, shell, false-pass]
components: [yellow-council, bats-tests]
---

## Context

PR #971's `plugins/yellow-council/tests/synthesis.bats` used assertions such as
`! grep -q 'leaked finding' "$SD/forward.txt"` as guards that a string is
absent. Review (architecture) flagged them: bats runs each test under
`errexit`, and bash exempts a command whose status is inverted with `!` from
`errexit`. If the `grep` matches, `!` turns that into status 1, the shell does
not exit, and the test continues. Only a `!` on the **last** command of the test
body influences the test's result. PR #955's `skill-content.bats` review raised
the same pitfall.

## Guidance

- Do not write `! grep ...` anywhere except as the final command of a test.
- Use `run` and assert the status, which works at any position:

  ```bash
  run grep -q 'leaked finding' "$SD/forward.txt"
  [ "$status" -eq 1 ]
  ```

  (grep exits 1 for "no match", 2 for an error such as an unreadable file, so
  asserting `-eq 1` also catches a missing file that `-ne 0` would let through.)
- For several files, use `run grep -q ... a b c` and assert `1`, or loop and
  assert per file.

## Why This Matters

The assertion reads as a guard but can never fail, so a regression that leaks
the string passes silently. This is a false-pass that code review rarely
catches because the line looks correct.

## When to Apply

Any bats test (or `set -e` script) that asserts absence with `!`. Grep a test
file for lines that start with `!` and check each is the last command.

Also from the same review: name a negative test after the guard it actually
exercises. A "not ours" directory case that fails the shape check never reaches
the symlink, directory or ownership guards, so add real symlinked and
nonexistent directory cases instead of relying on one case with a misleading
name.

## Examples

```bash
# Silent false-pass: the leak is present, the test still goes green
@test "forward text carries no leaked finding" {
  ! grep -q 'leaked finding' "$SD/forward.txt"
  [ -f "$SD/reverse.txt" ]
}

# Correct
@test "forward text carries no leaked finding" {
  run grep -q 'leaked finding' "$SD/forward.txt"
  [ "$status" -eq 1 ]
  [ -f "$SD/reverse.txt" ]
}
```
