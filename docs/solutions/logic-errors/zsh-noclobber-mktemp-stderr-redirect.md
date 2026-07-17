---
title: 'zsh `noclobber` breaks mktemp-then-redirect error capture in skill bash blocks'
date: 2026-07-17
category: logic-errors
track: bug
problem: 'zsh noclobber turns `2>"$(mktemp)"` into a silent no-op, masking real results as false negatives'
tags: [zsh, noclobber, mktemp, shell-portability, skill-authoring, silent-failure]
components: [yellow-review, yellow-core]
---

# zsh `noclobber` breaks mktemp-then-redirect error capture in skill bash blocks

## Problem

Several skill bash blocks capture a command's stderr by pre-creating a temp
file with `mktemp` and then redirecting into it:

```bash
ERR_FILE=$(mktemp)
some_command 2>"$ERR_FILE" || { echo "no evidence found"; ... }
```

This pattern silently assumes bash's default clobber-permissive redirection
semantics. The actual interactive shell in this environment is zsh, and when
`noclobber` is set, redirecting `>`/`2>` onto a path that already exists
(which `mktemp` guarantees — it creates the file before returning its path)
fails immediately with a shell-level "file exists" error. `some_command`
never runs at all; the block's own `|| { ... }` fallback fires instead — not
because the command failed, but because the shell never attempted it.

## Symptoms

Hit repeatedly in the same PR #644 review session:

- `/review:resolve-pr` Step 2b branch-verification collapsed to "no
  evidence"/"gh error" three separate times.
- `/plan:complete` Gate C's branch/PR check hit the same failure once.

In every case, manually re-running the identical `git`/`gh` command directly
in the shell succeeded — the underlying operation was never broken. Only the
skill's own mktemp-then-redirect wrapper failed.

## What Didn't Work

Nothing was attempted to "fix" the underlying command — the failures looked
like real check failures (empty output, non-zero exit) until the redirect
itself was identified as the point of failure, since `set -uo pipefail`
propagates the redirect failure indistinguishably from a real command
failure.

## Solution

Two independent fixes, either sufficient on its own:

1. **Force-clobber the redirect explicitly**, regardless of the invoking
   shell's `noclobber` setting:

   ```bash
   ERR_FILE=$(mktemp)
   some_command 2>|"$ERR_FILE"   # >| / 2>| override noclobber for this redirect only
   ```

2. **Don't pre-create the file before redirecting** — `noclobber` only
   blocks redirecting onto a file that already exists:

   ```bash
   ERR_FILE="${TMPDIR:-/tmp}/err.$$"   # name only, not yet created
   some_command 2>"$ERR_FILE"
   ```

## Why This Works

`>|` (and `2>|`) is standard zsh/bash/POSIX-adjacent syntax for forcing a
single redirection to clobber an existing file irrespective of `noclobber`,
so the block's behavior no longer depends on the invoking shell's clobber
setting. Skipping `mktemp`'s pre-creation sidesteps the interaction
entirely, since `noclobber` only fires when the target file is already
present at redirect time.

## Prevention

- Any skill/command bash block that does `X=$(mktemp); ... 2>"$X"` (or
  `>"$X"`) should use `2>|`/`>|`, or avoid pre-creating the file with
  `mktemp` and let the redirect create it fresh.
- This is a cross-cutting authoring pattern, not specific to one plugin —
  grep for `mktemp` followed by a later `2>"` / `>"` in the same bash block
  across `commands/`, `skills/`, and `agents/` markdown.
- Do not assume a code fence labeled ` ```bash ` runs under bash's default
  semantics — the actual execution shell in this environment (and
  potentially any environment where the Bash tool's profile pulls in zsh)
  can differ, and `noclobber` is a real, silently-masking difference.
