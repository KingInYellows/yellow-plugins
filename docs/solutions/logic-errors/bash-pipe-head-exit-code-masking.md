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

## Update — 2026-09-05: the same masking happens with `while` loops and `awk`, not just `head`

PR #769 (yellow-review's thermonuclear line-count injection,
`plugins/yellow-review/commands/review/review-pr.md`) hit two more instances
of the same underlying primitive — a downstream command's clean exit status
absorbing an upstream failure — neither of which involves `head`:

1. **`git diff | while read ...` swallowed a failed `git diff`.** The
   original draft piped `git diff -z --numstat` directly into the `while`
   loop that builds line-count rows. A `while` loop fed by a pipe runs in a
   subshell (bash) or the current shell with the pipe as stdin (zsh) — either
   way, a failed `git diff` upstream hands the loop an empty stream, which it
   reads zero times and exits with whatever status the loop itself produced
   (typically `0`), not `git diff`'s failure. This is the exact same shape as
   `cmd | head -N || error`: the rightmost/consuming command's exit status is
   what `||` or `$?` observes, and an empty stream is indistinguishable from
   a successful-but-empty one.

   **A second, sharper failure mode specific to `while`:** even ignoring the
   upstream-failure case, a `while` loop run inside a pipe subshell cannot
   use `exit` to stop the *calling* script — `exit` only terminates the
   subshell, and the calling script continues past the loop as if it
   completed normally. A truncated record mid-loop (e.g., a rename record
   missing its second path field) that tries to `exit 1` on detection would
   appear to succeed with whatever rows were emitted before the truncation —
   worse than the `head` case, because the output isn't just non-empty,
   it's a plausible-looking partial result.

   **Fix:** stage the pipeline's output to a file first (`git diff -z
   --numstat ... >|"$LC_NUMSTAT" || exit 1`), check that command's own exit
   status directly, then read the `while` loop from the file
   (`done <"$LC_NUMSTAT"`) instead of from a pipe. The loop now runs in the
   current shell, so `exit` inside it actually stops the enclosing script.

2. **`git show | awk` masked a failed `git show` as a count of `0`.** Reading
   a file's line count via `git show REF:path | awk 'END{print NR}'` has the
   same shape as `cmd | head`: if `git show` fails (e.g., a transient
   `cat-file` error even after the object-existence probe passed), `awk`
   receives an empty stream, counts zero lines, and exits `0` — a failed read
   is indistinguishable from a genuinely empty file, and either way the
   pipeline's exit status is `awk`'s clean `0`. In a size-threshold reviewer
   context, a masked failure that reads as `head=0` looks exactly like a file
   that was deleted, silently producing a false "file shrank to nothing"
   crossing signal instead of an error.

   **Fix:** same as (1) — write through a file (`git show ... >|"$LC_TMP" ||
   exit 1`) and check `git show`'s own exit status before running `awk` on
   the file, rather than piping the two together.

**General rule (broadens this doc beyond `head` specifically):** the masking
primitive is not particular to `head` — it is any pipeline where a
non-erroring consumer (`head`, `awk`, a `while read` loop, `sort`, `wc`, ...)
sits downstream of a command that can fail, and the consumer's own exit
status is what a caller observes. `set -o pipefail` fixes this at the shell
level (with the caveat already noted: it changes every pipeline in the
script). Where that is too broad, the fix is always the same shape: **stage
the potentially-failing command's output to a variable or a file, check that
command's exit status directly, then feed the already-checked capture to the
downstream consumer** — never let the consumer's own successful-on-empty
exit status stand in for the producer's.

**Components (this Update):** `plugins/yellow-review/commands/review/review-pr.md`.

See also `docs/solutions/logic-errors/git-ref-empty-string-and-ambient-config-footguns.md`
— the same PR's companion findings on unchecked `git merge-base` and ambient
`diff.renames` config, both in the same shell block.
