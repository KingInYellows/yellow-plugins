# gt-merge-queue Add-On Plugin — Brainstorm

**Date:** 2026-04-30
**Research source:** `docs/research/graphite-merge-queue-stacked-prs-coding-agents.md`
**Sibling brainstorm:** `docs/brainstorms/2026-04-30-gt-workflow-merge-queue-improvements-brainstorm.md`
**Sections cited:** research §3, §5, §6, §7; sibling brainstorm "Plugin Boundary" and "Open Questions"

---

## What We're Building

`gt-merge-queue` is an opt-in Claude Code plugin that depends on `gt-workflow`
and gives a coding agent the ability to shepherd a Graphite merge-queue PR from
"ready" through to merged. It owns ALL queue-state-aware work — the sibling
brainstorm locked this boundary and `gt-workflow` will not be modified to read
queue state.

**The gap this fills (research §6):** No existing plugin handles the full
shepherd loop — enqueue → monitor CI → conflict-detect → review-pickup →
final-merge confirmation. Community plugins exist for queue entry only.

**Plugin boundary (from sibling brainstorm):**
- `gt-workflow` — Graphite platform mechanics, queue-state-unaware, always installed
- `gt-merge-queue` — queue-state-aware shepherd loop, opt-in add-on

---

## Why This Approach

### Plugin name: `gt-merge-queue`

Pairs with `gt-workflow` (Graphite-specific tools use `gt-` prefix in this
repo). Makes the dependency relationship visible. Disambiguates from GitHub
native queue and Mergify. `subagent_type` strings: `gt-merge-queue:agents:<name>`.

### Cross-plugin dependency declaration

No formal `dependencies` key exists in the plugin.json schema (confirmed by
inspecting yellow-linear, yellow-ci, yellow-devin manifests — none use it). The
pattern is: `allowed-tools` in command frontmatter lists the other plugin's MCP
tools (fails cleanly if not installed), and CLAUDE.md documents the prose
requirement. This resolves sibling brainstorm open question #3.

### Hook collision with gt-workflow

`gt-workflow` has a PreToolUse(Bash) hook blocking raw `git push`.
`gt-merge-queue` adds a PreToolUse(Bash) hook blocking force-push while queued.
Claude Code runs all matching hooks sequentially — they do not shadow each
other. No conflict. This resolves sibling brainstorm open question #4.

### Stack-aware from day one

Graphite's queue is stack-first (research §3): when any PR is enqueued,
Graphite auto-enqueues all stack ancestors. A stack-naive plugin would not
detect cascading ejection when a parent PR is kicked. Marginal complexity is
small: one `gt log short` call on enqueue captures stack membership into the
JSONL state entry. Graphite still owns queue ordering; the agent only needs
membership awareness.

### Yield-and-resume model

Blocking-shepherd approaches hold the user's Claude session for the duration of
CI (potentially 10-30 minutes). Yield-and-resume (one state-machine step per
invocation) composes naturally with the existing `/loop` skill:
`/loop 90s /gt-merge-queue:shepherd <PR>` is the documented polling pattern.
No `--watch` flag needed in plugin code.

---

## Key Decisions

### Q&A Summary

**Round 1 — Plugin name + Stack scope**

Q-A: Plugin name — `gt-merge-queue`. Rationale: pairs with `gt-workflow`
convention; disambiguates from GitHub native queue.

Q-B: Stack scope — stack-aware from day one. Graphite is stack-first; punting
stack detection to v2 would make the plugin misleading about cascading ejection
behavior on first use.

**Round 2 — Human checkpoint set**

Q: Which checkpoints are mandatory vs config-overridable in MVP?

A: All 5 are mandatory with no config opt-out in v1. Adding config opt-out
later is purely additive (no breaking change), so cost of waiting is zero.

Confirmed checkpoint set:
- Initial enqueue — AskUserQuestion (mandatory)
- Queue ejection (any reason) — AskUserQuestion (mandatory)
- Conflict detected — AskUserQuestion (mandatory)
- New `request changes` review mid-queue — AskUserQuestion (mandatory)
- Final merge after CI green — AskUserQuestion (mandatory, no config toggle)

Hotfix fast-track: deferred to v2 (research §7 MVP list also excludes it).

**Round 3 — State persistence location**

Q: Per-user (`~/.claude/merge-queue/`) vs per-project (`.claude/merge-queue/`)?

A: Per-user. Worktree workflow makes per-user the obvious choice — state must
be checkout-independent. Repo-slug must be deterministic: derive from
`gh repo view --json nameWithOwner -q .nameWithOwner` (returns `owner/name`),
sanitize `/` → `-`. Final path: `~/.claude/merge-queue/<owner>-<repo>/<pr-number>.jsonl`.

Notes locked in:
- `~/.claude/merge-queue/` is new ground in yellow-plugins (no existing plugin
  writes runtime state here); document the convention.
- State survives plugin uninstall — v2 nice-to-have: `/gt-merge-queue:cleanup`
  command or doc note about `rm -rf ~/.claude/merge-queue/<repo>/`.

**Round 4 — Auth + Hook scope + Yield model (two inline lock-ins + one question)**

Inline lock-in — Auth: `gh` CLI for GitHub API calls (zero new credential
surface); `GRAPHITE_TOKEN` in `plugin.json userConfig` for Graphite-specific
calls. No GitHub App in MVP (v2 upgrade path). Merge actor is the user's own
GitHub identity via `gh` CLI.

Inline lock-in — Hook scope: PreToolUse force-push gate is a blunt glob check.
If any `~/.claude/merge-queue/<owner>-<repo>/*.jsonl` file has a non-`complete`
final event, block force-push. No per-PR awareness needed in the hook; glob
read is ~1ms per Bash call.

Q: Blocking shepherd vs yield-and-resume vs hybrid?

A: Yield-and-resume (B). Each invocation does one state-machine step and exits.
`/loop 90s /gt-merge-queue:shepherd <PR>` is the documented babysitting
pattern. No `--watch` flag in plugin code.

No-args invocation behavior: auto-resume if exactly one active (non-`complete`)
session; AskUserQuestion to pick if multiple active.

**Round 5 — Failure-mode triage + smart-submit boundary**

Inline lock-in — Smart-submit boundary: `gt-workflow`'s `smart-submit` stays
clean (no `--enqueue` flag). Adding it would require `gt-workflow` to
conditionally call an optional add-on — wrong layering direction. The
`gt-merge-queue` CLAUDE.md documents: "after `gt submit`, run
`/gt-merge-queue:shepherd <PR>`."

Q: New `request-changes` review detection — poll on each shepherd invocation
only, or also on SessionStart, or document the gap and recommend `/loop`?

A: Document the risk and recommend `/loop`. No SessionStart polling complexity.
The final-merge AskUserQuestion checkpoint displays "N new comments since last
invocation" as a safety net even without continuous polling.

Failure-mode triage:

| Failure Mode | MVP Handling |
|---|---|
| Queue ejection (CI failure) | Core shepherd loop — AskUserQuestion |
| Queue ejection (conflict) | Core shepherd loop — AskUserQuestion |
| New `request changes` mid-queue | Poll on each invocation; document `/loop` mitigation |
| Double-merge attempt | `pull_request.merged == true` guard at start of every invocation |
| Session crash mid-merge | JSONL state + yield-and-resume makes resume free |
| PR closed externally | Detect + notify + archive; shepherd exits cleanly |
| Force-push by external actor | Detect SHA mismatch → notify + dequeue |
| CI flake with auto-retry | Deferred to v2 |
| Graphite queue paused | Detect + report "queue paused"; shepherd exits |
| `main` advanced while queued | Graphite handles transparently; agent waits for new CI result |

---

## MVP Scope

### Commands

**`/gt-merge-queue:shepherd [PR-number-or-URL]`** — primary entry point.
One state-machine step per invocation. Reads JSONL state on entry; writes
updated state on exit. State machine:

```
Validating -> HumanCheckpoint(enqueue) -> Queued -> MonitoringCI
  -> MergeConfirmation -> Merging -> PostMergeAudit -> Complete
                        |-> Ejected -> HumanCheckpoint(ejection)
                        |-> ReviewChange -> HumanCheckpoint(request-changes)
                        |-> ClosedExternally -> Archive
```

**`/gt-merge-queue:status [PR-number-or-URL]`** — read-only; prints current
JSONL state without advancing the state machine. Useful for inspection without
triggering AskUserQuestion.

**`/gt-merge-queue:dequeue [PR-number-or-URL]`** — safely dequeue with reason.
AskUserQuestion for reason (using "Other" button for free-text input per
MEMORY.md patterns), then calls Graphite/gh to remove from queue, writes
terminal JSONL event.

### Agents

**`merge-queue-shepherd`** — core agent; owns the full state machine described
above. Single file (no artificial split for line-count reasons — MEMORY.md
confirms this is correct). Handles: stack membership detection on enqueue, JSONL
read/write, all AskUserQuestion checkpoints, review polling, PR state checks,
and PostToolUse audit log delegation.

No separate `merge-queue-conflict-analyzer` or `merge-queue-review-monitor`
agents in MVP — those are v2 candidates. The shepherd handles conflict
reporting inline (detect + AskUserQuestion; user resolves manually).

### Hooks

**PreToolUse (Bash)** — force-push gate:
- Glob: `~/.claude/merge-queue/**/*.jsonl`
- Condition: any JSONL file whose last event is not `{"event":"complete",...}`
- Action: block with message `[gt-merge-queue] Blocked: force operations not
  permitted while PR is in shepherd state. Run /gt-merge-queue:dequeue first.`

**PostToolUse (Bash)** — audit logger:
- Matcher: commands containing `gh pr merge` or `gt submit`
- Action: append audit event to the active JSONL state file (PR, SHA, actor,
  timestamp, idempotency token)

**SessionStart** — state resume notification:
- If any non-`complete` JSONL state file exists, inject system message:
  "Shepherd state exists for PR #N in <repo> (step: <step>). Run
  `/gt-merge-queue:shepherd <N>` to check status."
- Must output `{"continue": true}` on ALL paths (MEMORY.md: no `set -e` in
  hooks that emit JSON; use `json_exit()` helper pattern).

### State Schema (JSONL, append-only)

```jsonl
{"schema":"1","ts":"...","event":"enqueue_requested","pr":123,"repo":"owner/repo","slug":"owner-repo","idempotency_token":"uuid","stack":["#121","#122","#123"],"speculative_sha":null,"step":"awaiting_queue_entry"}
{"schema":"1","ts":"...","event":"queued","speculative_sha":"abc123","queue_position":3,"step":"monitoring_ci"}
{"schema":"1","ts":"...","event":"review_polled","last_seen_review_id":456,"new_changes_requested":false,"step":"monitoring_ci"}
{"schema":"1","ts":"...","event":"ci_pass","step":"awaiting_merge_confirmation"}
{"schema":"1","ts":"...","event":"human_approved","actor":"user","comment_delta":2,"step":"merging"}
{"schema":"1","ts":"...","event":"merged","merged_sha":"def456","step":"complete"}
```

Fields tracked: `pr`, `repo`, `slug`, `stack`, `speculative_sha`,
`last_seen_review_id`, `conflict_state`, `idempotency_token`, `step`,
`schema` (always `"1"` for forward compatibility per MEMORY.md).

### Plugin Manifest Shape

```json
{
  "name": "gt-merge-queue",
  "version": "1.0.0",
  "description": "Shepherd a Graphite merge-queue PR from ready to merged — conflict detection, mid-queue review pickup, and idempotent resume. Requires gt-workflow.",
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/check-queue-state.sh", "timeout": 2 }] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/post-merge-audit.sh", "timeout": 1 }] }],
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh", "timeout": 3 }] }]
  },
  "userConfig": {
    "GRAPHITE_TOKEN": { "description": "Graphite API token for queue management", "secret": true, "required": true }
  }
}
```

Cross-plugin dependency is enforced via `allowed-tools` in command frontmatter
listing `gt-workflow`'s MCP tools (e.g., `mcp__plugin_gt-workflow_graphite__*`)
— fails cleanly if `gt-workflow` is not installed. Documented as prose
requirement in CLAUDE.md.

### Invocation Pattern (documented in CLAUDE.md)

```
# After gt submit:
/gt-merge-queue:shepherd 123

# Continuous monitoring (compose with /loop skill):
/loop 90s /gt-merge-queue:shepherd 123

# Check state without advancing:
/gt-merge-queue:status 123

# Safe dequeue:
/gt-merge-queue:dequeue 123
```

---

## v2 Candidates (Deferred)

| Feature | Deferral trigger |
|---|---|
| Hotfix fast-track command (`/gt-merge-queue:hotfix`) | First user request; needs Graphite fast-track API confirmed |
| Conflict analyzer agent (auto-suggest, not auto-apply) | After 3+ manual conflict resolutions — pattern emerges |
| Background review monitor (continuous, not invocation-triggered) | When `/loop` pattern proves insufficient in practice |
| CI flake auto-retry with bounded count | After first flake incident; add `max_retries` to JSONL schema |
| `gt-merge-queue:cleanup` command | After first request about orphaned state files |
| Stack-aware atomic enqueue (enqueue whole stack in one command) | After first user complaint about manual multi-PR enqueue |
| Graphite queue pause/resume integration | If Graphite publishes webhook schema |
| `autoMergeOnCIGreen` config opt-out | After first user request; purely additive to manifest |
| Metrics (time-in-queue, conflict rate, CI pass rate) | After 50+ shepherd sessions — enough data to be useful |
| GitHub App identity for merge actor | If audit requirements demand bot identity over user identity |

---

## Open Questions (Unresolved)

1. **Graphite API token scopes** (research §6, §8): Graphite's API token
   reference is not publicly documented at the level of detail needed for
   programmatic enqueue/dequeue. Which token type — user token, org token, or
   service account token — is required? Can enqueue/dequeue be done via API
   without dashboard interaction? Requires Graphite support consultation before
   implementing the shepherd's enqueue step. Workaround: MVP may invoke
   `gt submit --merge-queue` via CLI rather than a direct API call, deferring
   the Graphite REST dependency.

2. **Graphite webhook events** (research §3, §8): Whether Graphite emits
   webhooks the plugin can subscribe to ("PR ejected", "queue position changed",
   "batch merged") or whether polling GitHub PR state is the only option. MVP
   assumes polling-only. If Graphite publishes a webhook schema, the v2 review
   monitor agent can switch to event-driven detection, removing the `/loop`
   composition requirement.

3. **`gt log short` stack membership output format**: The exact output format
   of `gt log short` (or equivalent `gt` CLI command) for extracting stack
   membership needs verification against the live Graphite MCP tool
   (`mcp__plugin_gt-workflow_graphite__*`). May use `gt stack` or the Graphite
   MCP server directly instead of parsing CLI output.

---

## Out-of-Scope Table

| Item | Decision | Rationale |
|---|---|---|
| `--enqueue` flag on smart-submit | Out of scope | Wrong layering — gt-workflow must not conditionally call an add-on |
| GitHub native merge queue support | Out of scope | Graphite and GitHub native queue are incompatible (research §3); user must pick one |
| Auto-resolving semantic conflicts | Out of scope (any version) | Industry consensus April 2026: always escalate semantic conflicts to human |
| Force-merge outside Graphite queue | Out of scope | Anti-pattern per research §5; PreToolUse hook blocks it |
| `gt-workflow` modifications for queue-state | Out of scope | Sibling brainstorm locked this boundary |
| CI re-triggering / workflow dispatch | Out of scope | Graphite handles CI restart after `main` advances; agent just waits |
| Queue position reporting (dashboard parity) | Out of scope MVP | `/gt-merge-queue:status` reports step from JSONL only; queue position from Graphite API is v2 |
| Per-project state files | Rejected | Worktree workflow requires checkout-independent state; per-user wins |
| SessionStart hook polling reviews | Rejected | Adds `gh api` calls to every session open; `/loop` mitigation is sufficient |
| Graphite CI optimizer step (GH Actions config) | Out of scope | CI configuration item, not plugin behavior; link in docs |
