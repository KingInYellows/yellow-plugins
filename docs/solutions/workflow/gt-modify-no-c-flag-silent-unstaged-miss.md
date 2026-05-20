---
title: '`gt modify` without `-c` silently misses unstaged edits'
date: 2026-05-18
category: workflow
track: bug
problem: gt modify without -c amends prior commit and ignores unstaged file edits; output looks successful
tags: [graphite, gt-modify, unstaged, commit, silent-failure]
components: [workflow, graphite]
---

## Problem

Running `gt modify -m "fix: ..."` after applying a file edit (e.g., via the Edit
tool) produces output like:

```text
1 file changed, 3 insertions(+), 2 deletions(-)
```

But the reported diff belongs to the **prior commit's total content**, not the
new edit. The unstaged file change was never included.

## Symptoms

- `git status` shows the edited file still dirty after `gt modify`
- `git show HEAD` does not contain the intended change
- The commit subject changed, but the file diff did not land
- No error or warning was printed by gt

## Root Cause

The real failure mode is **calling `gt modify` from a non-interactive
agent context with unstaged changes** — not the absence of `-c`.

Per Graphite's own command reference, `gt modify` (in both amend and
`--commit`/`-c` modes) prompts the user to stage unstaged changes when
it detects them. The `-c` flag only switches between amending the
previous commit vs. creating a new one. When the surrounding agent
flow swallows that interactive prompt (or runs gt with stdin closed),
the prompt resolves to "no stage" and the unstaged hunk is silently
dropped from the resulting commit/amend.

Git's amend itself only includes already-staged changes — which is
correct behavior — but the staging gap was supposed to be caught by
gt's prompt. The "X files changed" output then refers to the amended
commit's cumulative diff relative to its parent, not to the just-edited
file, so the failure looks like success.

**Adding `-c` does NOT fix this.** `gt modify -c` exhibits the same
silent-miss behavior in non-interactive agent contexts because the
underlying staging prompt is what's being swallowed.

## Solution

Three correct patterns:

**Option A — stage first, then amend:**

```bash
git add <file>
gt modify -m "fix: descriptive message"
```

Use when you want to fold the change into the previous commit.

**Option B — create a new commit:**

```bash
git add <file>
gt modify -c -m "fix: descriptive message"
```

The `-c` flag creates a new commit rather than amending. Preferred when the
prior commit is already meaningful on its own. **The `-c` flag itself does
not prevent the silent unstaged miss** — the explicit `git add` above is
what makes the change visible to gt. Use `-c` based on whether you want a
new commit vs. an amend, not as a fix for staging.

**Option C — use git commit directly:**

```bash
git add <file>
git commit -m "fix: descriptive message"
```

Valid fallback; Graphite tracks the commit either way.

## Why This Works

`git add` moves the file change from the working tree into the index. Only
indexed (staged) changes are included in an amend or new commit, regardless
of which subcommand path gt takes. The `-c` flag is what distinguishes
"new commit" from "amend" in `gt modify`; it does NOT change staging
behavior. Explicit `git add` before any `gt modify` invocation makes the
fix robust whether gt prompts or not, and whether `-c` is present or not.

## Prevention

Before any `gt modify` or `gt commit` call, verify staged state:

```bash
git status --short
```

If the file you edited appears as ` M` (unstaged) rather than `M ` (staged),
run `git add <file>` first.

In automated agent workflows: always `git add <specific-file>` immediately after
applying an edit, before the commit step. Never rely on gt to pick up unstaged
changes automatically.
