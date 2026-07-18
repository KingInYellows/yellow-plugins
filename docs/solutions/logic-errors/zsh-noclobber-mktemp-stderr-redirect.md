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
- **Documenting the fix is not the same as sweeping for the pattern.**
  Treat "grep for `mktemp` ... `2>"` " above as a required follow-up action
  taken in the same pass as writing this doc, not just prose advice for
  future authors — see the 2026-07-18 update below for what happens when
  that sweep is skipped.

## Update — 2026-07-18

The fix documented above never propagated to the skill that first
surfaced this bug. `plugins/yellow-review/commands/review/resolve-pr.md`
Step 2b ("Verify Correct Branch") still ships the exact vulnerable shape
as of this writing:

```bash
BV_ERR_FILE=$(mktemp) || { ... }
CUR_PR=$(gh pr view --json number -q .number 2>"$BV_ERR_FILE")
```

A `/review:sweep-all` batch run hit "(eval): file exists" on this precise
block during a `/review:resolve` invocation and recovered by substituting
`2>|` ad hoc mid-session — the same class of failure this doc already
described from the PR #644 session, in the very command whose Step 2b
verification logic this doc's Symptoms section references. The fix
(`2>"$BV_ERR_FILE"` → `2>|"$BV_ERR_FILE"` on the `gh pr view` line) was not
applied to the source file.

**Root cause of the propagation gap:** the original fix (PR #644) added
this document and its "grep for the pattern" prevention bullet, but no
step actually ran that grep across `commands/`, `skills/`, and `agents/`
markdown to find and fix other live instances — including the one in the
very command that triggered the original discovery. A documented fix
without a sweep only prevents *new* instances; it does nothing for
instances that already shipped before the doc existed.

**Full sweep result (run 2026-07-18, not yet fixed anywhere):** running the
grep this doc's own Prevention section prescribes
(`mktemp` followed by a same-block `2>"$X"` / `>"$X"` without a `2>|`/`>|`
override) across `plugins/*/commands`, `plugins/*/skills`, and
`plugins/*/agents` markdown found the pattern live in at least these
locations — including `plan/complete.md` Gate C, the *other* site this
doc's own Symptoms section named as already having hit the bug once:

- `plugins/yellow-review/commands/review/resolve-pr.md` — Step 2b, `gh pr view ... 2>"$BV_ERR_FILE"`
- `plugins/yellow-review/commands/review/resolve-stack.md` — `get-pr-comments ... >"$PC_OUT" 2>"$PC_OUT.err"` (the `>"$PC_OUT"` half is the vulnerable one; `$PC_OUT.err` is a fresh path so its own redirect is safe)
- `plugins/yellow-core/commands/plan/complete.md` — Gate C, `gh pr list ... 2>"$GH_ERR"`
- `plugins/yellow-core/commands/workflows/compound.md` — `gh pr view ... 2>"$_PR_STDERR_FILE"`
- `plugins/gt-workflow/commands/gt-setup.md` — two sites, `gh repo view ... 2>"${mq_err_log:-/dev/null}"` and `gh api graphql ... 2>"${mq_err_log:-/dev/null}"`
- `plugins/yellow-browser-test/agents/testing/test-reporter.md` — `cat > "$BODY_FILE" <<'EOF'`
- `plugins/yellow-browser-test/commands/browser-test/explore.md` — `curl ... 2>"$CURL_ERR"`
- `plugins/yellow-browser-test/commands/browser-test/test.md` — two sites, `curl ... 2>"$CURL_ERROR"`
- `plugins/yellow-codex/agents/research/codex-analyst.md` — codex invocation `2>"$STDERR_FILE"`
- `plugins/yellow-codex/agents/review/codex-reviewer.md` — codex invocation `2>"$STDERR_FILE"`
- `plugins/yellow-codex/agents/workflow/codex-executor.md` — codex invocation `2>"$STDERR_FILE"`
- `plugins/yellow-codex/commands/codex/rescue.md` — two sites, codex invocation `2>"$STDERR_FILE"`
- `plugins/yellow-codex/commands/codex/review.md` — two sites, codex invocation `2>"$STDERR_FILE"`
- `plugins/yellow-codex/commands/codex/setup.md` — `codex exec ... 2>"$SETUP_ERR_FILE"`
- `plugins/yellow-core/agents/research/best-practices-researcher.md` — `printf '%s' "$docs_body" > "$docs_file"` (prose-embedded one-liner)
- `plugins/yellow-research/skills/library-context/SKILL.md` — `printf '%s' "$docs_body" > "$docs_file"` (near-duplicate of the site above — both write context7 docs back to the tier2 cache the same way)
- `plugins/yellow-semgrep/skills/semgrep-conventions/SKILL.md` — `semgrep scan ... 2>"$SCAN_STDERR"`

Not exhaustively re-verified: `yellow-council`'s `gemini-reviewer.md`,
`opencode-reviewer.md`, and `council-patterns/SKILL.md` also call `mktemp`
repeatedly but route output through tool-native `-o`/output-file
arguments rather than a shell `>`/`2>` operator in the instances checked —
worth a closer read before assuming they're clear, but no vulnerable
redirect was found in this pass.

**Prevention addendum:** after landing a shell-pattern fix doc like this
one, run the grep it prescribes as a mandatory last step of the same PR,
not as a suggestion left for whoever reads the doc next — treat "0
remaining instances" as part of the fix's own done-criteria, not a
separate, optional follow-up task that can silently never happen. This
sweep found 16+ live instances across 7 plugins nearly five months after
the pattern was first documented — the gap compounds the longer the sweep
is deferred, since every new command/skill/agent written in the meantime
had nothing wrong with it locally (each one independently reinvented the
same "mktemp then redirect stderr" idiom, correctly under bash's default
semantics, with no local signal that zsh's `noclobber` would break it).
