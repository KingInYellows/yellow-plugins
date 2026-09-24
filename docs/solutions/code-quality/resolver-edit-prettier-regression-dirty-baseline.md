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
   place: `pnpm exec prettier --stdin-filepath <file> < <file>`. This produces
   Prettier's fully-reformatted version without touching the working tree.
2. Run the same stdin-filepath pass on the `HEAD` blob:
   `git show HEAD:<file> | pnpm exec prettier --stdin-filepath <file>`.
3. Get the edited line ranges with `git diff -U0 HEAD -- <file>` so staged and
   unstaged resolver edits are both included.
4. Build two formatting deltas: current file vs its stdin-filepath output, and
   `HEAD` blob vs its stdin-filepath output.
5. Inside the edited ranges, **overlap alone is not proof of a regression**, and
   raw delta hunks cannot be compared directly: an edit that changes the text of
   an already-drifted line changes both hunks even when it adds no new
   formatting problem. Map each edited line to its `HEAD` origin using the
   `git diff -U0 HEAD` hunks instead, then compare the specific formatter edits
   on each mapped line rather than whether the line was dirty. The formatter
   edit is what Prettier changes on a line (a wrap, spacing, quotes). A line has
   a regression when its current formatter edit contains a change the `HEAD`
   counterpart's formatter edit does not — for example a new over-width wrap on
   a line that was only missing spaces before. Newly added lines count any
   formatter edit. Fix only those new changes (indentation, wrap width, quote
   style) without a blanket `prettier --write` that would also rewrite
   pre-existing drift.
6. Formatter edits that the `HEAD` counterpart already needed are pre-existing
   drift, even on a line whose text changed. Leave those as they were; fixing
   them is a separate, out-of-scope cleanup.

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

# Per-run private scratch dir: parallel resolvers must not share snapshot
# files, and copied source may contain the very secret a review is removing.
old_umask=$(umask); umask 077
tmp=$(mktemp -d) || { umask "$old_umask"; echo "mktemp failed" >&2; exit 1; }
trap 'rm -rf "$tmp"' EXIT
umask "$old_umask"

# 1. What would Prettier produce for current and HEAD content?
# pnpm exec runs the repo-locked Prettier, not a global or missing one.
pnpm exec prettier --stdin-filepath "$file" < "$file" > "$tmp/pretty-current.md"
git show "HEAD:$file" | pnpm exec prettier --stdin-filepath "$file" > "$tmp/pretty-head.md"

# 2. Which lines did the resolver actually touch (staged + unstaged)?
git diff -U0 HEAD -- "$file"

# 3. Per-line formatter edits for current and baseline
git show "HEAD:$file" > "$tmp/head.md"
git diff --no-index -U0 "$file" "$tmp/pretty-current.md" > "$tmp/fmt-current.diff"
git diff --no-index -U0 "$tmp/head.md" "$tmp/pretty-head.md" > "$tmp/fmt-head.diff"

# 4. Map and compare (the part a raw diff of the two files cannot do):
#    - map each edited current line to its HEAD line through step 2's hunks
#      (purely added lines have no HEAD line);
#    - for each edited line, take its formatter edit from fmt-current.diff and
#      its HEAD counterpart's formatter edit from fmt-head.diff;
#    - a regression is a change present in the current edit but absent from
#      the HEAD one (e.g. a new wrap on a line that only lacked spaces), or any
#      formatter edit on a purely added line. Fix only those.
```
