# gt-workflow Merge Queue Improvements — Brainstorm

**Date:** 2026-04-30
**Research source:** `docs/research/graphite-merge-queue-stacked-prs-coding-agents.md`
**Sections cited:** §2 (Graphite platform model), §3 (Merge Queue deep dive), §5 (agent merge patterns), §6 (Claude Code integration patterns), §7 (Plugin Design Recommendations)

---

## What We're Building

Two additive-minimal improvements to the existing `gt-workflow` plugin (v1.4.0),
motivated by findings in the Graphite merge queue research. These are
platform-level hardening changes that benefit all Graphite users — not
queue-management features, which belong in the separate `merge-queue` add-on.

**Change 1 — `gt-setup` native-queue coexistence warning**
A new check in Phase 1's prerequisite scan that detects whether GitHub's native
merge queue is enabled on the trunk branch. Emits a soft advisory (never blocks)
because Graphite and GitHub's native queue are explicitly documented as
incompatible (§3). Affects all Graphite users, not just those using Graphite's
own merge queue.

**Change 2 — `gt-cleanup` closed-not-merged guard**
When a local branch's PR is found closed with no merge (`state: CLOSED`,
`mergedAt: null`), gt-cleanup now warns before offering deletion. A batch count
warning appears in "Delete all" mode; per-branch AskUserQuestion confirmation
appears in "Review individually" mode. No label reading (`queue-ejected` label
detection stays in the merge-queue add-on). Prevents silent data loss when a
user's PR was queue-ejected, PR abandoned mid-review, or otherwise closed
without landing.

---

## Why This Approach

### Two-plugin layering (the core architectural decision)

`gt-workflow` is used on every repo where Graphite is active. Graphite's merge
queue is opt-in — used on some repos, not all. Mixing queue-state-aware logic
into `gt-workflow` would add GitHub/Graphite API calls for queue position on
every repo, adding latency and complexity for users who never use the queue.

The correct model — confirmed in Round 1 — is:

- `gt-workflow` (base, always installed for Graphite users): knows Graphite
  platform mechanics. Does NOT read queue state. No new API calls for queue
  position.
- `merge-queue` (opt-in add-on, depends on `gt-workflow`): knows Graphite merge
  queue specifically. Owns the shepherd loop, JSONL state, PreToolUse force-push
  gate, AskUserQuestion at enqueue/merge-confirm/conflict. Follows the add-on
  dependency pattern established elsewhere in yellow-plugins.

This layering matches existing precedent (`linear:delegate` requires
`yellow-devin`; `ci:report-linear` requires `yellow-linear`).

### Why these two changes and not others

The research surfaced many candidates. Each was put through a YAGNI gate:

- **Only changes that benefit ALL Graphite users** (not just queue users) belong
  in gt-workflow. Both confirmed changes meet this bar.
- **Only changes that don't require queue-state API calls** belong in gt-workflow.
  Both confirmed changes rely on data gt-workflow already fetches or can fetch
  without queue-state awareness.
- **Conventional commit `!` regex**: Verified present in `check-commit-message.sh`
  line 52 (`!?:` already in pattern). No change needed.

---

## Key Decisions

### Q&A Summary

**Round 1 — Plugin boundary**
Q: Do queue-state guards (e.g., "is this PR currently queued?") belong in
gt-workflow or exclusively in the merge-queue add-on?

A: Two-plugin layering. gt-workflow stays queue-state-unaware. Any feature
requiring a read of Graphite/GitHub queue position belongs in merge-queue. The
user uses Graphite on every repo but the merge queue only on some — the add-on
pattern is the right fit.

**Round 2 — gt-cleanup guard design**
Q: What level of protection should gt-cleanup add for closed-not-merged branches?

A: Option A — minimal warn-and-confirm. When `gh pr list` returns a branch with
`state: CLOSED` + `mergedAt: null`, show a count warning in batch mode and a
per-branch AskUserQuestion in review mode. No `queue-ejected` label reading
(that's merge-queue territory). One extra field (`mergedAt`) added to the
existing `gh pr list --json` call.

**Round 3 — gt-setup warning severity**
Q: Should the GitHub native queue warning be advisory, blocking, or
AskUserQuestion-gated?

A: Option A — soft advisory. Add `gh_native_queue: WARNING — ...` to the Phase 1
report alongside existing key-value diagnostics. Matches the existing `yq: NOT
FOUND` severity level. Fail-open: if the branch protection API call fails for
any reason, emit `gh_native_queue: COULD NOT CHECK (branch protection API
unavailable)`. Never blocks setup.

---

## Implementation Notes

### gt-setup change (Phase 1 bash block addition)

Add a single new check after the existing "Convention Files" checks. Detection
uses `gh api repos/{owner}/{repo}/branches/{trunk}/protection` and parses for
the `required_merge_queue` field (or equivalent). Fail-open on any error
(auth, no protection rules, API shape change). The warning includes the
GitHub branch settings URL and a one-line consequence statement:

```
gh_native_queue: WARNING — GitHub native merge queue is enabled on '{trunk}'.
    Graphite and GitHub native queue are incompatible; running both causes
    Graphite to restart CI on all queued commits and may produce out-of-order
    merges. Disable GitHub native queue at:
    https://github.com/{owner}/{repo}/settings/branches
```

`gh` is already a prerequisite in gt-cleanup and a soft dependency in gt-setup
(used for `gh auth status`). No new tool dependency.

### gt-cleanup change (Phase 2 PR status lookup)

The existing `gh pr list --state all --json state` call becomes
`gh pr list --state all --json state,mergedAt`. One additional field. No new
API calls, no new loop iterations.

Classification logic addition: after identifying a branch as "Closed PR"
candidate (all PRs in `CLOSED` or `MERGED` state), check whether any closed
PR has `mergedAt: null`. If so, tag the branch as `closed-not-merged`.

Display change (Phase 4, Category Actions, "Delete all" path): if any branches
in the Closed PR category are tagged `closed-not-merged`, prepend the data-loss
warning with a count: "N of these branches had PRs closed without merging (may
be queue-ejected, abandoned, or cancelled)."

Display change (Phase 4, "Review individually" path): for each
`closed-not-merged` branch, add a line to the per-branch detail block:
`PR status: closed (no merge — verify before deleting)`. The existing
AskUserQuestion serves as the confirmation step — no new prompt needed.

---

## Out-of-Scope Decisions

| Item | Decision | Rationale |
|---|---|---|
| `queue-ejected` label detection in gt-cleanup | Out of scope for gt-workflow | Label reading requires knowing it's queue-specific; belongs in merge-queue add-on |
| PreToolUse hook blocking force-push while queued | Out of scope for gt-workflow | Requires queue-state API call; merge-queue add-on responsibility |
| smart-submit "already queued?" guard before force-push | Out of scope for gt-workflow | Queue-state read; merge-queue add-on responsibility |
| JSONL idempotency state files | Out of scope for gt-workflow | Shepherd-loop feature; merge-queue add-on responsibility |
| Stack-aware enqueue cascade | Out of scope for gt-workflow | First-class merge-queue add-on feature |
| `gt-sync` ejection-state recovery path | Out of scope for gt-workflow | Merge-queue add-on's shepherd will instruct user to run `/gt-sync`; no change needed in gt-sync itself |
| Conventional commit `!` regex | No change needed | Already present: `!?:` on line 52 of `check-commit-message.sh` |
| Graphite CI optimizer step mention in gt-setup | Out of scope | CI configuration item, not a plugin behavioral gap; link in docs if needed |
| gt-setup: blocking hard-stop on native queue detection | Rejected | Severity mismatch — the user may be aware and choosing to run hybrid; advisory is correct |
| gt-cleanup: split "Closed PR" into "Merged" vs "Closed-no-merge" sub-categories | Rejected | More code for marginal UX gain; the minimal warning achieves the protection goal |

---

## Open Questions

These were not resolved in this brainstorm and are deferred to the merge-queue
add-on brainstorm:

1. **Graphite API token scopes**: Graphite's API token reference is not publicly
   documented at the detail level needed for programmatic queue management.
   Requires Graphite support consultation before implementing the shepherd.

2. **Graphite webhook events**: Whether Graphite emits webhooks the add-on can
   subscribe to (e.g., "PR ejected", "queue position changed") or whether the
   add-on must poll GitHub PR state as a proxy. Evidence gap confirmed in §3.

3. **merge-queue add-on dependency declaration**: Should `merge-queue`'s
   `plugin.json` declare `gt-workflow` as a formal dependency? Depends on
   whether the yellow-plugins manifest schema supports inter-plugin dependencies.
   Check schema before designing the add-on manifest.

4. **Hook registration collision**: The merge-queue add-on will register its own
   PreToolUse (Bash) hook for force-push gating. gt-workflow already has a
   PreToolUse (Bash) hook for `git push` blocking. Both must coexist without
   shadowing each other. Verify Claude Code's behavior when two plugins register
   PreToolUse hooks for the same matcher.

5. **gt-setup native-queue detection field**: The GitHub REST API field name for
   "merge queue enabled" on a branch protection rule should be verified against
   the live API before implementation — the exact field (`required_merge_queue`,
   `merge_queue_enforcement_level`, etc.) was not confirmed in the research.

---

## Recommendations

| Priority | Item | File(s) | Rationale |
|---|---|---|---|
| P1 | gt-setup native-queue coexistence warning | `commands/gt-setup.md` | One-time deployment guard; high value for all Graphite users; low implementation cost (one `gh api` call, fail-open) |
| P1 | gt-cleanup closed-not-merged guard | `commands/gt-cleanup.md` | Prevents silent branch deletion after queue ejection or PR abandonment; one extra JSON field in an existing API call |
| P2 | merge-queue add-on brainstorm | new plugin | Everything queue-state-aware; deferred to separate brainstorm |
| Out of scope | All other research candidates | — | YAGNI: require queue-state reads or belong entirely in the add-on |
