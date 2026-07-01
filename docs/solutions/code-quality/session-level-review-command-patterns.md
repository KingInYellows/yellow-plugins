---
title: "Session-Level Review Command Patterns"
date: 2026-03-20
category: code-quality
track: knowledge
problem: 'Session-Level Review Command Patterns'
tags: [review, commands, git, graphite, delegation, stacks]
components: [yellow-core]
---

# Session-Level Review Command Patterns

Nine patterns discovered while building and reviewing session-level review commands that orchestrate multi-PR analysis, fix application, and stack-aware diffing.

---

## Pattern 1: workflows:work Delegation Paradox

### Problem

A session-level review command needed to apply fixes autonomously across multiple PRs. The initial design delegated fix application to `workflows:work`, which seemed like the natural choice since it handles code changes.

### Context

`workflows:work` is designed for interactive developer workflows. It always creates new branches via `gt create` and contains 4+ `AskUserQuestion` call sites that block execution. Delegating to it from an autonomous review pipeline causes the pipeline to hang waiting for user input that should never be needed.

### Solution

Apply fixes directly via the Edit tool within the review command itself, following the `review:pr` Step 6 pattern. The review command already has full context about what needs to change -- adding an intermediary that creates branches and asks questions adds complexity without value.

### Why It Works

Review commands already hold the diff context, file paths, and fix descriptions. Direct application via Edit is deterministic and non-interactive. The `workflows:work` abstraction is valuable for its intended use case (developer-initiated work sessions) but counterproductive when called from automated pipelines.

---

## Pattern 2: Cross-PR Coherence -- Use Parent-Branch Diffs for Linear Stacks

### Problem

When analyzing coherence across PRs in a linear stack (`trunk -> A -> B -> C`), using `git diff trunk...branchB` shows the cumulative diff of A+B combined. This makes it impossible to identify what changed specifically in B versus what was already in A.

### Context

Graphite stacks can be either linear (each branch based on the previous) or parallel (all branches based on trunk). The correct diff strategy depends on the topology.

### Solution

For linear stacks, diff each branch against its immediate parent:

```bash
# Linear stack: trunk -> A -> B -> C
git diff branchA...branchB   # shows only B's changes
git diff branchB...branchC   # shows only C's changes
```

For parallel stacks (all off trunk), trunk-based diffs are correct:

```bash
# Parallel stack: trunk -> A, trunk -> B, trunk -> C
git diff trunk...branchA
git diff trunk...branchB
```

### Why It Works

The three-dot diff (`A...B`) shows changes on B since it diverged from A. In a linear stack, each branch diverged from its parent, so parent-based diffs isolate per-PR changes. In parallel stacks, every branch diverged from trunk, so trunk-based diffs are already correct.

---

## Pattern 3: Argument Disambiguation -- Branch Names with `/`

### Problem

A command that accepts both file paths and branch names as arguments used "contains `/`" as a heuristic to detect file paths. This misclassified branch names like `feat/session-level-review` as file paths.

### Context

Git branch naming conventions commonly use `/` as a namespace separator (e.g., `feat/`, `fix/`, `chore/`). File paths also contain `/`. A naive contains-slash check cannot distinguish between them.

### Solution

Use more specific heuristics that match file path characteristics rather than generic path separators:

- Ends in a known extension: `.md`, `.js`, `.ts`, `.json`, etc.
- Starts with an explicit path prefix: `./`, `../`, `plans/`

Do NOT flag arguments solely because they contain `/`.

### Why It Works

Branch names almost never end in file extensions, and they never start with `./` or `../`. These heuristics have near-zero false positives on branch names while still catching the file path misuse case the guard was designed for.

---

## Pattern 4: Multi-Bot Convergence as P1 Signal (Reinforcement)

### Problem

Individual review bot findings had approximately a 50% false positive rate. Without a triage heuristic, reviewers waste time investigating findings that turn out to be noise.

### Context

This session reinforced the existing MEMORY.md entry on multi-bot convergence. When 3+ independent bots flagged the same issue, the false positive rate dropped to 0% (every convergent finding was a real problem). Single-bot findings remained at ~50% false positive.

### Solution

When triaging automated review findings:

1. Group findings by the underlying issue they describe (not by bot name).
2. If 3+ independent bots flag the same issue, classify as P1 immediately.
3. Single-bot findings require manual verification before acting.

### Why It Works

Independent bots use different analysis strategies (AST, regex, heuristic). When multiple independent strategies converge on the same finding, it is strong evidence of a real issue. A single strategy triggering alone may be an artifact of that strategy's blind spots.

---

## Pattern 5: Untracked Files Blocking Git Status Checks

### Problem

A review command wrote output files (e.g., review docs to `docs/reviews/`), then later ran `git status --porcelain` to check for a clean working directory before proceeding. The untracked output files caused the check to report a dirty tree, blocking re-runs.

### Context

`git status --porcelain` includes untracked files (prefixed with `??`) by default. Commands that produce output artifacts within the repo tree will always see a dirty status if they check after writing.

### Solution

Use the `--untracked-files=no` flag when the intent is to check for modified tracked files only:

```bash
git status --porcelain --untracked-files=no
```

If untracked files matter for the check, explicitly filter them:

```bash
git status --porcelain | grep -v '^??'
```

### Why It Works

The flag tells git to exclude files that are not tracked, which is the correct semantics when checking whether tracked content has uncommitted modifications. Output artifacts are intentionally untracked and should not block pipeline logic.

---

## Pattern 6: Fix Loop Semantics -- Cycle = Fix-Then-Verify

### Problem

A review command claimed "max 2 review-fix cycles" but the implementation only performed 1 fix application + 1 re-review verification. This is 1 cycle, not 2.

### Context

A "review-fix cycle" means: (1) apply fixes based on review findings, then (2) re-review to check for regressions or remaining issues. If the re-review finds new issues, that starts a second cycle. The initial review that discovers the issues is not itself a cycle.

### Solution

If the specification says "max N cycles," ensure the loop can execute N iterations of (apply-fixes, re-review):

```
Initial review -> findings
  Cycle 1: apply fixes -> re-review -> new findings?
  Cycle 2: apply fixes -> re-review -> done
```

A loop with `max_cycles=2` needs to be able to apply fixes twice, not once.

### Why It Works

The off-by-one error comes from conflating "review iterations" with "fix-then-verify cycles." The initial review is iteration 0 (discovery). Each cycle is an iteration that starts with fix application. Naming the loop variable `fix_cycles` instead of `review_iterations` prevents the confusion.

---

## Pattern 7: gt upstack restack Placement

### Problem

In a per-branch fix loop that applies fixes across a linear stack, running `gt upstack restack` after fixing each branch (inside the loop) caused rebase conflicts on downstream branches that had not yet been fixed.

### Context

`gt upstack restack` rebases all downstream branches onto the current branch's new tip. If downstream branches still contain the old (pre-fix) code, the rebase may conflict with the fixes just applied to the current branch.

### Solution

Run `gt upstack restack` once AFTER the entire fix loop completes, not inside it:

```bash
# Wrong: restack inside the loop
for branch in $BRANCHES; do
  gt checkout "$branch"
  apply_fixes
  gt upstack restack  # conflicts on unfixed downstream branches
done

# Right: restack after all fixes applied
for branch in $BRANCHES; do
  gt checkout "$branch"
  apply_fixes
done
gt checkout "$FIRST_BRANCH"
gt upstack restack  # all branches already have fixes, clean rebase
```

### Why It Works

When all branches in the stack have their fixes applied before restacking, the rebase operations encounter consistent content at each level. Restacking mid-loop creates a mismatch: the rebased downstream branch expects the old content, but the upstream branch has new fixes.

---

## Update — 2026-07-01

Two more patterns from finishing out a `/review:sweep-all` pass (PR #598),
running `/review:resolve` after the review's own findings had already
applied fixes.

## Pattern 8: Reply-and-Defer as a Third Disposition for /review:resolve

### Problem

`resolve-pr.md`'s disposition model is three-way: fix-and-mark-resolved
(Step 7), leave-unresolved via a structured `CONFLICT:` sentinel (Step 5),
or drop-as-non-actionable (Step 3c, LGTM/nit). There is no lane for a finding
that is real, well-corroborated, and *not* resolve-time-safe — e.g. it
requires an API signature redesign across multiple call sites, or a coupled
trade-off a resolver can't decide unilaterally (add an eviction cap vs.
accept unbounded growth).

### Context

On PR #598, 10 of 16 bot-flagged threads pointed at exactly this shape of
issue. Neither documented disposition fit: "silently fix it" risks a
partial/regressive patch assembled under time pressure; "decline as false
positive" mislabels a tracked, real bug.

### Solution

Post a reply that states the disposition and rationale — why this isn't
being resolved now, and where the follow-up is tracked (a doc, a linked
issue, a noted "open" status in a solution doc) — then leave the GraphQL
thread genuinely unresolved. This is a deliberate third outcome, not a
degraded fix or a mislabeled decline.

### Why It Works

Matches ordinary human PR-review conventions, where "acknowledged, tracked
separately" is a normal response distinct from both "fixed" and "not a bug."
It keeps `/review:resolve`'s resolved/unresolved thread state honest — a
thread stays open exactly when there's still real work behind it.

### When to Apply

Any resolve-time pipeline modeled as fix-or-decline needs a third
"defer-with-reply" lane, or it will either force bad patches under time
pressure or mislabel tracked bugs as false positives. This is a pipeline-design
gap in `resolve-pr.md` as currently spec'd — Step 3c's actionability filter
has no bucket for "real, but not resolve-safe" distinct from drop/fix.

## Pattern 9: Severity and Autofix-Safety Are Orthogonal Axes

`review-pr.md` Step 7 already encodes the mechanism (`safe_auto` + P0/P1
auto-applies; P2 `safe_auto` requires promotion via added evidence;
`gated_auto`/`manual`/`advisory` never auto-apply regardless of severity —
see "Severity gate is deliberate" in that doc). PR #598 confirmed it in
practice: a P2 finding tagged `safe_auto` with confidence 100 and 3-reviewer
corroboration (silent-failure-hunter, correctness-reviewer, pr-test-analyzer
all independently flagging the same line) was the one legitimate auto-apply,
promoted via that corroboration per the documented rule — while a P1 finding
tagged `gated_auto` (the tier1 rebuild-wipe bug, equally well-corroborated,
including a live reproduction) was correctly *not* auto-applied despite
higher severity.

Worth flagging because the rule was written down and an agent still
defaulted to naive "P0/P1 only" severity filtering mid-session until
corrected. When triaging findings for auto-apply, check `autofix_class`
first — severity alone is never a routing signal for auto-apply eligibility.
