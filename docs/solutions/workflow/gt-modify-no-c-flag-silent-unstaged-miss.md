---
title: '`gt modify` silently misses unstaged edits in non-interactive agent contexts'
date: 2026-05-18
category: workflow
track: bug
problem: gt modify (with or without -c) silently drops unstaged file edits when its stage-prompt is swallowed by a non-interactive agent flow; output looks successful and the -c flag does not fix it
tags: [graphite, gt-modify, unstaged, commit, silent-failure, non-interactive]
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
---

## Update — 2026-08-06: another recurrence, this time mid-batch across parallel resolver agents — caught only by the NEXT iteration's dirty-tree pre-flight

A `/review:sweep-all` run spanning PRs #695 and #697 hit this same
underlying mechanism again (already documented in this doc's earlier
sections from a prior single-file incident). The new wrinkle here is the
trigger shape and, more usefully, what actually caught it.

**Trigger shape:** mid-batch, after a wave of parallel `pr-comment-resolver`
sub-agents had each edited their assigned file region, the orchestrator ran
`gt modify -m "fix: ..."` to fold the resolver edits into the branch commit
before pushing. Because the resolver edits were unstaged at that point, the
amend was message-only — same underlying mechanism this doc already
documents (non-interactive `gt modify` swallows the stage prompt) — but the
scale made it worse than a single hand-edited file: **19 review threads were
marked resolved and their fixes were reported as pushed, when in fact the
push contained none of the resolver output.** `gt submit` reported success;
nothing in that command's output distinguished "pushed the fixes" from
"pushed a renamed commit with no new content."

**What actually caught it:** not a check run at the point of the `gt modify`
call itself (the existing `git status --short` Prevention step below would
have caught it if run, but wasn't, in the heat of a multi-PR batch) — it was
caught one PR later, when `/review:sweep-all`'s pre-flight check for the
*next* PR in the batch found the working tree unexpectedly dirty (the 19
resolver edits were still sitting unstaged, never cleared, from the previous
PR's failed amend). The dirty-tree state was the detectable symptom;
tracing it back revealed the fixes had never landed.

**Recovery:** `git add <the exact resolver-edited paths>` (not `git add
-A` — see
[background-agent-repo-writes-during-batch.md](background-agent-repo-writes-during-batch.md)
for why exact-path staging matters specifically during multi-branch/
multi-agent batches), then
`gt modify -c -m "fix: ..."` to create a proper commit containing the
edits, then re-push and re-verify each of the 19 threads against the new
commit content before re-confirming them resolved.

**Added guidance — a batch-level backstop for this whole failure class:**
this doc's existing Prevention section (verify `git status --short` before
every `gt modify`/`gt commit`) is still correct but is a per-call discipline
that's easy to skip under batch pressure with many resolver agents in
flight. A **between-iteration dirty-tree pre-flight** — checking
`git status --porcelain` is empty before starting the *next* unit of work in
any loop that walks multiple PRs/branches/todos and uses `gt modify` to fold
in agent-produced edits — is a cheap, structural backstop that catches this
specific silent-miss class even when the per-call discipline lapses. Treat
"is the tree clean before I start the next iteration" as a required gate in
any sweep/batch loop, not just a nice-to-have sanity check.

**Components (this Update):** `/review:sweep-all` batch loop
(`plugins/yellow-review/commands/review/sweep-all.md`,
`plugins/yellow-review/commands/review/sweep.md`), any orchestrator using
`gt modify` to fold parallel-resolver output into a branch commit.
