---
title: 'Rebasing a Graphite stack whose earlier branch changed requires --onto per descendant, not gt sync alone'
date: 2026-09-05
category: workflow
track: knowledge
problem: >-
  Amending an earlier branch in a Graphite stack that later branches were
  already built on top of requires rebasing each descendant with git
  rebase --onto plus gt track --parent, and verifying with git cherry
  before force-submitting, or gt submit silently pushes a stack whose
  descendants still point at the pre-amend commit
tags: [graphite, gt-workflow, stacked-prs, rebase, force-push, review-sweep]
severity: medium
module: gt-workflow
problem_type: stacked-branch-rebase
solution_type: procedure
components: [gt-workflow, workflow]
---

# Rebasing a Graphite stack whose earlier branch changed requires `--onto` per descendant

## Context

A `/review:sweep-all` batch working two overlapping Graphite stacks (PRs
#741–#748 as one stack, #767–#770 as a second stack built on top of #748)
needed to amend an earlier branch in a stack after later branches had
already been created on top of it — the ordinary case of a mid-stack fix
landing after descendants exist. `gt sync` alone does not re-parent
descendant branches onto a rewritten ancestor commit; it will bring remote
changes into the branch you're on, but it does not rewrite the descendants'
history for you.

## Problem

If only the changed ancestor branch is amended/force-pushed and the
descendants are left alone, `gt submit --no-interactive --force` on a
descendant will push exactly what's already in its local ref — which still
points at the ancestor's pre-amend commit as its parent. No error is
raised; the push succeeds and looks identical to a healthy submit. The
descendant PR's diff on GitHub then either silently includes the
pre-amend content again (if GitHub's merge-base recomputation resurrects
it) or produces a confusing diff that doesn't match what review actually
approved.

## Solution

Snapshot every current descendant tip **before** rewriting anyone. After a
parent is rebased and force-submitted, neither the local parent ref nor
`origin/<parent>` still names the child's old exclusion boundary.

```bash
# 0. Capture old tips first (parent, child, grandchild, …).
old_parent=$(git rev-parse <parent-branch>)
old_child=$(git rev-parse <child-branch>)
old_grandchild=$(git rev-parse <grandchild-branch>)
```

Then, for each descendant, in stack order (parent before child):

```bash
# 1. Rebase the descendant onto the new tip of its parent, replaying only
#    the commits that are unique to the descendant (everything after the
#    captured OLD parent tip — never the rewritten parent ref).
git rebase --onto <new-parent-sha-or-branch> "$old_parent" <descendant-branch>

# 2. Re-link Graphite's own stack metadata to the (possibly new) parent —
#    gt's tracked-parent pointer does not follow a raw git rebase
#    automatically.
gt track --parent

# 3. Before force-pushing, verify the local branch's commits are genuinely
#    rebased versions of what's already on the remote, not divergent work.
#    Syntax is `git cherry [<upstream> [<head>]]`: upstream first, then
#    head. That lists commits reachable from local HEAD that are not
#    ancestors of the remote, compared by patch-id. Equivalent-content
#    commits with new SHAs from the rebase show as "-" (already
#    upstream-equivalent); any truly new/divergent local commit shows as
#    "+". Reversing the arguments (`git cherry HEAD origin/<branch>`)
#    lists the remote relative to local and hides local-only commits.
git cherry origin/<descendant-branch> HEAD

# 4. Only after confirming the "+"/"-" output matches expectations
#    (rebased versions of prior commits are the "-" set):
gt submit --no-interactive --force
```

Repeat for each descendant in dependency order — a grandchild branch must
wait for its immediate parent to be re-rebased and re-tracked first, since
`gt track --parent` needs the parent's ref to already reflect the new
history.

## Related gotchas hit in the same operation

- **`gt checkout` of a branch already checked out in another worktree fails
  silently in this flow** — before starting the rebase loop, confirm no
  other worktree/checkout holds a branch you're about to touch. See
  [worktree-batch-pipeline-branch-held-elsewhere.md](worktree-batch-pipeline-branch-held-elsewhere.md).
- **`gt modify -m "..."` without `-c` amends the message only** if the
  intended file changes were never staged — this bit again mid-rebase when
  a conflict-resolution edit was applied but not `git add`ed before the
  next `gt` command. See
  [gt-modify-no-c-flag-silent-unstaged-miss.md](gt-modify-no-c-flag-silent-unstaged-miss.md).
- **Generated host copies go stale the instant a canonical edit lands
  earlier in the stack.** Any plugin with generated per-host mirrors
  (Cursor/Codex distribution copies of a skill) will silently diverge from
  the canonical source after a rebase replays an earlier PR's canonical
  edit forward — run `pnpm generate:manifests` (and re-run
  `pnpm validate:generated`) after every rebase in the loop above, before
  running tests or pushing, not just once at the end of the whole stack.

## Prevention

- Treat "amend an ancestor branch with descendants already open" as
  requiring the full `rebase --onto` + `gt track --parent` + `git cherry`
  loop above, not `gt sync` — `gt sync`'s job is pulling remote state into
  your current branch, not re-parenting a whole stack's descendants after a
  local ancestor rewrite.
- Never force-submit a descendant branch without a `git cherry` (or
  equivalent patch-id) check first when the immediate parent was just
  rebased — a clean-looking `gt submit --force` gives no signal that the
  descendant is still pointing at stale history.
- Run `pnpm generate:manifests` as a standing step after any rebase inside
  a stack that includes a plugin with generated host-distribution copies,
  not only after the final rebase of a multi-PR sweep.
