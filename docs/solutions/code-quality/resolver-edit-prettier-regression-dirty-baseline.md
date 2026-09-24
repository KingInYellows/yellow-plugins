---
title:
  "Verifying a resolver edit didn't introduce a Prettier regression when the
  file isn't Prettier-clean at HEAD"
date: 2026-09-24
category: code-quality
track: knowledge
problem:
  'prettier --check fails on files that already have pre-existing formatting
  drift, so it cannot verify whether a specific edit introduced a NEW wrap
  regression'
tags:
  - prettier
  - review-resolver
  - format-check
  - verification-technique
  - review-sweep
components:
  - plugins/yellow-review/agents/workflow/pr-comment-resolver.md
---

## Context

During `/review:sweep-all` over yellow-plugins PR #840 (2026-09-24), one of the
resolver agents applying a verified review finding edited a file that was
already not Prettier-clean at HEAD (pre-existing drift, unrelated to the edit).
The edit itself introduced a line-wrap regression. Running
`prettier --check <file>` on the whole file is useless here: it fails whether or
not the new edit is the cause, because the file was already failing before the
edit. `prettier --write <file>` is also unsafe to run blind — it would reformat
the pre-existing drift too, turning a narrowly-scoped resolver fix into a large,
unrelated diff.

## Guidance

To check whether a specific edit — not the whole file — introduced a Prettier
regression:

1. Run Prettier against the file's _current_ content through stdin, not in
   place: `prettier --stdin-filepath <file> < <file>`. This produces Prettier's
   fully-reformatted version without touching the working tree.
2. Run the same stdin-filepath pass on the `HEAD` blob:
   `git show HEAD:<file> | prettier --stdin-filepath <file>`.
3. Get the edited line ranges with `git diff -U0 HEAD -- <file>` so staged and
   unstaged resolver edits are both included.
4. Build two formatting deltas: current file vs its stdin-filepath output, and
   `HEAD` blob vs its stdin-filepath output.
5. Inside the edited ranges, **overlap alone is not proof of a regression**.
   Only mismatches that appear in the current delta but not in the `HEAD` delta
   count as newly introduced — fix those (indentation, wrap width, quote style)
   without running a blanket `prettier --write` that would also rewrite
   pre-existing drift.
6. Mismatches that already existed at `HEAD` inside the edited region are
   pre-existing drift, unrelated to the resolver's change — leave them alone.
   Fixing them is a separate, out-of-scope cleanup.

This is the file-scoped analogue of a full-file `prettier --check`: it answers
"did _my_ edit regress formatting" instead of "is this file formatted," which is
the only question that matters when the file was never clean to begin with.

## Why This Matters

A resolver agent (or any automated fix) that runs `prettier --write` to "clean
up" after itself on a file with pre-existing drift silently expands its own diff
to include unrelated reformatting — noisy at review time and risky if the
pre-existing drift was itself protecting something (e.g. a
`<!-- prettier-ignore -->`'d metadata block, per
[public-release-stale-references-and-prettier-formatting.md](./public-release-stale-references-and-prettier-formatting.md)).
Conversely, skipping verification entirely because `prettier --check` "already
fails on this file" lets a real regression from the resolver's own edit ship
unnoticed. Comparing current and `HEAD` formatting deltas inside the edited
ranges is the only check that is both accurate and minimal.

## When to Apply

- Any automated or agent-driven edit (resolver agents, `/review:resolve` fix
  application, batch sweeps) to a file that is not already Prettier-clean at
  HEAD.
- Not needed when the file is Prettier-clean at HEAD — a plain
  `prettier --check <file>` after the edit is sufficient and cheaper.

## Examples

```bash
file=plugins/yellow-review/commands/review/sweep-all.md

# 1. What would Prettier produce for current and HEAD content?
prettier --stdin-filepath "$file" < "$file" > /tmp/pretty-current.md
git show "HEAD:$file" | prettier --stdin-filepath "$file" > /tmp/pretty-head.md

# 2. Which lines did the resolver actually touch (staged + unstaged)?
git diff -U0 HEAD -- "$file"

# 3. Formatting deltas for current and baseline
diff "$file" /tmp/pretty-current.md > /tmp/delta-current.diff
git show "HEAD:$file" > /tmp/head.md
diff /tmp/head.md /tmp/pretty-head.md > /tmp/delta-head.diff

# 4. Inside the edited ranges, only mismatches in delta-current that
#    delta-head does not already have count as regressions.
```
