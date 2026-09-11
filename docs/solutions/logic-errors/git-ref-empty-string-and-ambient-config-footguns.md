---
title: 'Empty git ref resolves to the index, and ambient diff config silently changes what a script reads'
date: 2026-09-05
category: logic-errors
track: bug
problem: 'Unchecked git merge-base failure turns "REF:path" into ":path", which git reads as the staged index; ambient diff.renames config silently changes rename detection results'
tags:
  - git
  - shell
  - config
  - correctness
  - cli-readiness
  - command-authoring
components:
  - plugins/yellow-review/commands/review/review-pr.md
---

# Empty git ref resolves to the index, and ambient diff config silently changes what a script reads

PR #769 (yellow-review's thermonuclear line-count injection) added a shell
block to `/review:pr` that reads file content at two commits via
`git show REF:path` and computes rename-aware `--numstat` diffs. Review found
two related but distinct git footguns in that block, both belonging to the
same family: **git silently substitutes a different, plausible-looking data
source instead of erroring, when a caller assumes a ref or a config value is
what it usually is.**

## Problem 1 — an empty ref in `REF:path` reads the index, not an error

```bash
MERGE_BASE=$(git merge-base "$DIFF_BASE" HEAD)
git show "$MERGE_BASE:$base_path"
```

`git merge-base` can fail and print nothing to stdout — an unrelated
histories case, a shallow clone missing the common ancestor, or any
transient git error. If `$MERGE_BASE` is empty, `"$MERGE_BASE:$base_path"`
becomes the literal string `:$base_path`. Git's `<rev>:<path>` syntax treats
a ref-less colon-prefixed path as **the staged index**, not as an error. The
command silently succeeds, returning whatever is currently staged for
`base_path` in the working tree that happens to be running this script —
content that has no relationship to either commit the diff is supposed to
span. Downstream, a "base line count" that is actually "whatever is staged
right now" produces a confidently-wrong crossing/shrink signal with no
error anywhere in the chain.

This is the same class of footgun as `git-diff-name-status-nul-safe-parsing.md`'s
C-style path quoting: a git subcommand has a secondary, silent interpretation
of malformed input that looks like a smaller version of the same operation,
rather than failing.

**Fix:** check the ref for emptiness immediately after resolving it, before
it is ever interpolated into a `REF:path` expression:

```bash
MERGE_BASE=$(git merge-base "$DIFF_BASE" HEAD) || exit 1
if [ -z "$MERGE_BASE" ]; then
  printf '[review:pr] Warning: merge-base unresolved; omitting file-line-counts\n' >&2
  exit 1
fi
```

Both checks are needed: `|| exit 1` catches a non-zero exit from
`merge-base` itself (e.g., unrelated histories), and the `-z` check catches
the case where `merge-base` exits `0` but still prints nothing (can happen
with certain shallow-clone configurations). Neither check alone covers both
failure shapes.

**General rule:** any `<rev>:<path>` git syntax, `git log <rev>`,
`git show <rev>`, or similar ref-taking command must have its ref value
validated non-empty (and its resolution command's own exit status checked)
before the ref is interpolated into a string. Git's `rev:path` grammar
reads an empty rev-side as "use the index" for several such expressions,
not as a parse error — treat every ref variable as a variable whose empty
value has valid-but-wrong git semantics, not an obviously-invalid one.

## Problem 2 — ambient `diff.renames` config changes what rows mean, without changing the command

```bash
git diff -z --numstat "$DIFF_BASE"...HEAD
```

`git diff --numstat`'s rename detection is controlled by the `diff.renames`
config value, which defaults to `true` in modern git but can be `false` in
a user's or CI runner's global/system config, or unset entirely in an
unusual environment. With rename detection off, a file rename shows up as
two unrelated numstat records — a full delete of the old path and a full add
of the new path — rather than one `R100 oldpath newpath` record. A line-count
script that expects the `R`/`C` two-path record shape to signal a rename
will instead read the new path's row as base=0 (it wasn't "found" at the
base under its new name), producing a phantom "0 → N lines" crossing for a
file that never actually changed size.

The failure is silent because the script's *logic* is correct for the
record shape it receives — it is the record shape itself that is
environment-dependent, and nothing in the numstat output or the script's own
invocation signals that the config differed from what the script assumed.

**Fix:** pass `--find-renames` explicitly on the `git diff` invocation
instead of relying on the ambient default:

```bash
git diff -z --numstat --find-renames "$DIFF_BASE"...HEAD
```

This pins the behavior the script is written against, independent of the
`diff.renames` config in whatever environment the script runs.

**General rule:** any git subcommand whose output *shape* (not just content)
is controlled by a config value with a non-obvious default (`diff.renames`,
`core.quotePath`, `core.autocrlf`, `diff.mnemonicPrefix`, etc.) should pin
that behavior with an explicit flag when a script parses the output
structurally. Relying on "the default is X" is an assumption about the
execution environment's config, not about git's behavior — and CI runners,
contributor machines, and this repo's own multi-shell (bash/zsh) environment
are exactly the kind of heterogeneous execution contexts where that
assumption breaks first.

## Prevention Checklist

- [ ] Every `git merge-base` (or other ref-resolving subcommand) result is
      checked for both non-zero exit status and empty output before being
      interpolated into a `REF:path` expression.
- [ ] Any git command whose output shape depends on a config default
      (renames, quoting, line endings, prefixes) pins that default with an
      explicit flag rather than relying on ambient config.
- [ ] A code-review pass on new git-invoking shell blocks explicitly asks
      "what does this command do if its ref/config input is empty or
      differs from my assumption?" rather than only "does this command do
      what I want on the happy path?"

## Related

- `docs/solutions/logic-errors/git-diff-name-status-nul-safe-parsing.md` —
  adjacent git-output-shape footgun: `core.quotePath` silently C-quoting
  non-ASCII paths.
- `docs/solutions/logic-errors/bash-pipe-head-exit-code-masking.md` — the
  same PR's companion finding: staging git command output to files instead
  of piping, so a failed git command can't hide behind a downstream
  consumer's clean exit status.
