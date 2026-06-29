---
title: 'Bash Pipe + head Exit-Code Masking in Presence Guards'
date: 2026-06-29
category: logic-errors
track: bug
problem: '`cmd | head -N || error` presence guards never fire: head exits 0 on empty stdin, masking upstream emptiness so the error path is unreachable'
tags:
  - bash
  - shell
  - pipe
  - exit-code
  - guard
  - silent-failure
  - command-authoring
---

# Bash Pipe + `head` Exit-Code Masking in Presence Guards

## Problem

In a shell pipeline without `set -o pipefail`, the pipeline's exit code is
the exit code of the **rightmost** command. `head` exits `0` on empty stdin.
So this "no files found" guard never reaches its `||` branch:

```bash
ls -t plans/specs/*.md 2>/dev/null | head -10 || { printf 'no specs\n' >&2; exit 1; }
```

When there are no matching files: `ls` exits non-zero, `head` receives empty
stdin and exits `0`, and that `0` becomes the pipeline's exit code — masking
the upstream emptiness. Execution continues past the guard as if specs were
found, with empty/blank input.

## Symptoms

- A "no files found" / "nothing to do" error path is written but never triggers.
- The command proceeds with empty or blank input downstream.
- Adding `set -e` to the surrounding context does not help — the pipeline's
  exit code is genuinely `0`.
- The bug is invisible in testing whenever at least one file exists; it only
  shows up in the empty case.

## What Didn't Work

Adding `2>/dev/null` to the upstream command and relying on `||` to catch the
absence. The redirect only silences `ls`'s stderr; it does nothing about the
pipeline exit code, which still belongs to `head`.

## Solution

Capture the upstream output first, then test it separately — never let `head`
own the exit code of a presence check:

```bash
SPEC_LIST=$(ls -t plans/specs/*.md 2>/dev/null)
if [ -z "$SPEC_LIST" ]; then
  printf '[decompose] No specs found in plans/specs/. Run /workflows:spec first.\n' >&2
  exit 1
fi
printf '%s\n' "$SPEC_LIST" | head -10
```

The `head` now runs only for display, after the presence decision is already
made on the captured value.

## Rule

Never rely on `cmd | head ... || error` (or any `cmd | filter ... || error`)
as a presence/emptiness guard. The trailing filter's exit code masks the
upstream result. Either:

- Capture first and test with `[ -z "$VAR" ]` (preferred for command `.md`
  files, where `set -o pipefail` is not always in scope), or
- Add `set -o pipefail` so the pipeline reports the first non-zero exit — but
  note this changes behavior for *every* pipeline in the script, so prefer the
  capture-then-test form for a localized guard.

## Related

- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  — broader catalog of bash-in-command-`.md` pitfalls.
