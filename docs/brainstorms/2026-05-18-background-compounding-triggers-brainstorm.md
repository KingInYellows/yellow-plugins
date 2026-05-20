# Brainstorm: Background Compounding Triggers

**Date:** 2026-05-18
**Scope:** Two-tier automatic compounding pipeline — Stop-hook stager + SessionStart cold-path reviewer
**Research base:** Repo audit (repo-research-analyst) + external framework survey (Perplexity Sonar Pro, 15 citations)
**Status:** SUPERSEDED by `plans/background-compounding-triggers.md` (V2).
Architectural revisions since this brainstorm — read the plan as authoritative:
- Stop hook is now **pure-shell, no LLM** (the diagram below showing
  `Agent(model: "haiku", background: true)` in the Stop hook subshell is
  obsolete — bash subshells cannot invoke Agent/Task per deepen-validation
  Q1/Q5; capture is now `tail | sed-redact | sha256 | atomic JSONL write`).
- staging-reviewer delegates promotion to a **new `staging-promoter` agent**,
  NOT to `knowledge-compounder` (Decision 3 below is reversed by plan D8 —
  `disallowedTools: [AskUserQuestion]` lives only in frontmatter, so a
  separate agent file is the only enforcement primitive).
- JSONL schema at the capture stage **omits Haiku-generated fields**
  (`candidate_text`, `priority`, `tags`) — those exist only after the drain
  scorer runs. Schema described at lines ~158-181 below is stale.
- Cold-path thresholds (count, age) — see plan as authoritative; brainstorm
  values are pre-revision.

---

## What We're Building

An always-on background compounding pipeline that captures learnings from every
Claude Code session without requiring manual `/workflows:compound` invocation.

The pipeline has two tiers:

1. **Hot path (Stop hook, per-session):** Yellow-core registers its first Stop
   hook. After every session, a background subshell spawns a Haiku agent that
   reads the session's recent tool-call outputs and writes a 2-3 sentence
   candidate summary to a JSONL staging ledger. The parent hook exits
   immediately — zero blocking latency.

2. **Cold path (SessionStart hook, hybrid trigger):** At the start of each new
   session, yellow-core checks the staging ledger. If entries are old enough
   (>24h) or numerous enough (>=5 pending), a background `staging-reviewer`
   agent drains the ledger, scores salience via ruvector dedup, and promotes
   survivors into `docs/solutions/` and `MEMORY.md` using existing
   `knowledge-compounder` primitives.

A manual `/compound:review-staged` command provides on-demand drain at any time.

---

## Why This Approach

Compounding is undertriggered not because the `knowledge-compounder` agent is
deficient, but because it requires a human interrupt to invoke. Bug fixes, PR
review patterns, and pure-reasoning decisions all evaporate equally often — the
whole class of "end of session" moments is affected, not just one type.

The fix is to make the trigger automatic and zero-friction, while keeping the
expensive promotion step gated (cheap-to-stage, expensive-to-promote). This
matches the two-tier pattern from memory consolidation frameworks (Letta/MemGPT's
staged archival/core distinction, Reflexion's episodic confidence-flagged
containers) and fits the existing yellow-plugins hook infrastructure cleanly.

**Why not always-promote on every Stop:** The existing `knowledge-compounder`
runs `AskUserQuestion` gates and spawns 5 parallel extraction subagents — this
is too heavy and too interactive for a background Stop hook. The staging tier
solves this by deferring all judgment to the cold path.

**Why per-session JSONL files in `pending/`, not a shared file with flock:** The
repo has zero `flock` usage today. Introducing it for a new feature creates a
new failure class (flock timeout, stale lock) with no established recovery
pattern. Per-session files in a `pending/` directory are trivially safe — each
writer is the sole owner of its own file, and the atomic move (`tmp` + `mv`) is
the exact pattern already used in `yellow-ci/hooks/scripts/session-start.sh` and
`yellow-research/hooks/lib/context7-cache.sh`.

**Why Haiku for the hot path:** Zero-LLM shell heuristics (git diff size, tool
call count) produce low-signal entries that push the entire classification burden
onto the cold-path reviewer. Haiku at ~$0.001-0.003/session produces pre-digested
prose the reviewer can score with high confidence, at acceptable always-on cost.
The main-agent self-assessment alternative (option C) is the broken status quo
reframed — it requires the compounding reflex the trigger is designed to provide.

**Why a new `staging-reviewer` agent, not extending `compound-lifecycle`:** The
`compound-lifecycle` skill was designed for interactive use with `AskUserQuestion`
confirmation gates and a broad catalog scan. Wiring it to a SessionStart
background invocation would fight its existing interaction model. A focused
`staging-reviewer` agent can be non-interactive by design and delegate promotion
to the existing `knowledge-compounder` for file writes — reusing the write
primitives without inheriting the interactive gates.

---

## Decision Matrix

| Question | Options considered | Chosen | Rationale |
|---|---|---|---|
| Q1: What sessions are undertriggered? | Specific bug fixes / PR patterns / pure reasoning | All of the above | Every end-of-session moment is affected equally |
| Q2: Who decides to compound? | Main agent / classifier / always-compound / hybrid heuristic | Always-compound with two-tier staging | Low capture bar on hot path, judgment deferred to cold path |
| Q3: When does cold path fire? | SessionStart / manual / threshold / cron / hybrid | Hybrid: SessionStart age guard + count threshold + manual override | Pure SessionStart is unsafe without age guard; pure manual re-creates the original failure mode; cron is overkill given SessionStart precedent |
| Q4: Ledger format | JSONL / markdown / ruvector native / hybrid | JSONL staging files, ruvector for dedup at promotion time | JSONL: append-safe from shell, machine-parseable, schema-evolvable; framework consensus (Letta, LangChain, LlamaIndex, mem0 all use structured records) |
| Q5: Hot-path stager cost model | Zero-LLM shell / Haiku summary / main-agent cooperative | Haiku summary | Higher signal than shell metrics; cost acceptable at ~$0.001-0.003/session |
| Q6: Ledger location | Per-worktree `.claude/` / per-project `~/.claude/projects/<hash>/` / global `~/.claude/` | Per-project `~/.claude/projects/<hash>/compound-staging/` | Mirrors auto-memory location; survives worktree cleanup; scoped to project |
| Q7: Concurrency model | flock / per-session files + atomic move / accept last-write-wins | Per-session JSONL files + atomic move into `pending/` | No flock precedent in this repo; per-session files are trivially safe; dedup catches any content overlap |
| Q8: Cold-path reviewer | Extend `compound-lifecycle` / new `staging-reviewer` agent | New `staging-reviewer` agent | `compound-lifecycle` is interactive-first; a dedicated non-interactive agent is cleaner |

---

## Architecture

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  SESSION END (Stop hook fires)                                  │
 │                                                                 │
 │  stop.sh (yellow-core, NEW)                                     │
 │    │                                                            │
 │    ├── spawns (subshell) >/dev/null 2>&1 &  [morph pattern]    │
 │    │     │                                                      │
 │    │     └── Agent(model: "haiku", background: true)           │
 │    │           reads: last N tool-call outputs from hook input  │
 │    │           writes: candidate_text (2-3 sentences) + tags    │
 │    │           writes to: tmp/<session-id>.jsonl                │
 │    │           atomic-moves to: pending/<session-id>.jsonl      │
 │    │                                                            │
 │    └── printf '{"continue": true}\n'  [exits immediately]      │
 └─────────────────────────────────────────────────────────────────┘
                              │
                              │ pending/<session-id>.jsonl accumulates
                              ▼
 ~/.claude/projects/<hash>/compound-staging/
   pending/
     <session-id-1>.jsonl
     <session-id-2>.jsonl
     ...
   tmp/                      (ephemeral, reaped on SessionStart)

 ┌─────────────────────────────────────────────────────────────────┐
 │  SESSION START (SessionStart hook fires)                        │
 │                                                                 │
 │  session-start.sh (yellow-core, NEW or extended)               │
 │    │                                                            │
 │    ├── check pending/ count + oldest file age                   │
 │    │     if count >= 5 OR oldest > 24h:                        │
 │    │       spawn staging-reviewer (background, disown)          │
 │    │     else:                                                   │
 │    │       skip                                                  │
 │    │                                                            │
 │    └── printf '{"continue": true}\n'  [exits immediately]      │
 └─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  staging-reviewer agent (NEW, Sonnet)                           │
 │                                                                 │
 │  1. Read all pending/*.jsonl entries                            │
 │  2. Dedup via ruvector hooks_recall (cosine >= 0.82 = skip)    │
 │  3. Score salience (priority field + candidate_text quality)    │
 │  4. For survivors:                                              │
 │       spawn knowledge-compounder (non-interactive mode)         │
 │       → writes docs/solutions/<category>/<slug>.md             │
 │       → writes MEMORY.md entry                                  │
 │  5. Delete drained pending/<session-id>.jsonl files             │
 └─────────────────────────────────────────────────────────────────┘

 Manual override at any time:
   /compound:review-staged  →  drain pending/ immediately
```

---

## JSONL Schema

Each entry written by the Haiku stager. Schema version `"1"` per yellow-plugins
queue convention (matches ruvector JSONL pattern from MEMORY.md):

```json
{
  "schema": "1",
  "timestamp": "2026-05-18T14:32:00Z",
  "session_id": "<claude-code-session-id>",
  "content_hash": "sha256:<hex>",
  "candidate_text": "Fixed a PostToolUse hook input-field path bug: hook input nests command at .tool_input.command, not root .command. This affected 3 hooks across 2 plugins and caused silent pass-through on all tool interceptions.",
  "tags": ["hook-pattern", "posttooluse", "input-schema"],
  "source": "stop-hook",
  "priority": 0.8,
  "review_status": "new",
  "session_metadata": {
    "git_diff_lines": 47,
    "tool_calls_count": 23,
    "files_touched": [
      "plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh",
      "plugins/gt-workflow/hooks/check-commit-message.sh"
    ]
  }
}
```

`content_hash` is sha256 of `candidate_text` — the dedup primitive before
ruvector cosine is available (cheap exact-match first pass).

`priority` is Haiku-assigned (0.0–1.0). Suggested Haiku prompt guidance:
0.9+ = security finding or correctness bug; 0.7–0.9 = non-obvious pattern or
decision; 0.5–0.7 = workflow improvement; below 0.5 = status check or
trivial session (stager should consider skipping the write entirely below 0.4).

---

## Key Decisions

### Decision 1: Morph-prewarm pattern for all background hook work

Both the Stop-hook stager and the SessionStart cold-path launcher use the exact
pattern from `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`:

- Parent script spawns `(subshell) >/dev/null 2>&1 &` and calls `disown`
- Parent immediately prints `{"continue": true}` and exits within timeout budget
- Subshell owns all long-running work and is the sole release point for any
  acquired locks
- `set -uo pipefail` (no `-e`) — mandatory for hooks that must output JSON on
  all paths

This is the only proven async-work-from-hook pattern in this repo. Do not
introduce a new pattern.

### Decision 2: Yellow-core gets its first hooks

Yellow-core currently has zero hooks registered in its `plugin.json` (confirmed
by repo audit). This design adds two new hook registrations:

- `Stop` — stager
- `SessionStart` — cold-path drain check

Both are registered in yellow-core's `plugin.json` `hooks` block. The Stop hook
is the only active Stop hook in the entire marketplace besides yellow-ruvector's.

### Decision 3: Staging-reviewer invokes knowledge-compounder for writes

The `staging-reviewer` agent does NOT reimplement `docs/solutions/` write
logic or MEMORY.md write logic. It delegates to
`knowledge-compounder` (`subagent_type: "yellow-core:workflow:knowledge-compounder"`)
for all file writes. This means knowledge-compounder needs a non-interactive
invocation mode — currently it always runs `AskUserQuestion` M3 gates. The
plan phase must address how to add a `--no-confirm` or `mode: background` path
without breaking the interactive flow.

### Decision 4: Cold-path thresholds are configurable but hardcoded for MVP

Default thresholds: age > 24h OR count >= 5. These are hardcoded constants in
the SessionStart hook for MVP. Per the `local-config` skill pattern, they can
later be exposed as `yellow-plugins.local.md` keys
(`compound_staging.drain.age_hours`, `compound_staging.drain.count_threshold`).
Do not add config machinery in the initial implementation.

### Decision 5: Ruvector is the dedup oracle, content-hash is the fast pre-check

Two-pass dedup in the staging-reviewer:

1. **Fast pass:** sha256 content-hash exact match across all pending entries.
   Catches duplicate sessions that wrote the same summary (e.g., two sessions
   hit the same bug on the same day).
2. **Semantic pass:** `hooks_recall` cosine similarity >= 0.82 against existing
   `MEMORY.md` content and `docs/solutions/` problem fields. Catches near-
   duplicates. This threshold matches `compound-lifecycle` skill's established
   calibration.

If ruvector is unavailable (`.ruvector/` not present), skip the semantic pass
and promote based on content-hash dedup + priority threshold alone.

---

## Open Questions

These are deferred to `/workflows:plan` — do not resolve here.

1. **Knowledge-compounder non-interactive mode.** Currently the agent always
   runs `AskUserQuestion` M3 gates before any write. The staging-reviewer needs
   to call it without user prompts. Options: add `mode: background` flag to
   the Task prompt that suppresses M3 and applies auto-routing; or extract the
   write primitives into a lower-level utility the reviewer calls directly.
   Compounding rules already have a "when spawned by `/workflows:compound`
   all findings are worthy" path — the background invocation should use the
   same auto-routing logic without the confirmation gate.

2. **Per-project hash derivation.** What does `<hash>` in
   `~/.claude/projects/<hash>/` resolve to? The auto-memory system already
   uses this convention. Confirm the exact derivation (likely `md5(git-root)`
   or the project slug used in `knowledge-compounder`'s Phase 0 pre-flight).
   The stager and reviewer must use the identical derivation or they will look
   in different directories.

3. **Orphaned `tmp/` file reaping.** If the Stop hook background subshell
   crashes between writing `tmp/<session-id>.jsonl` and atomic-moving to
   `pending/`, the tmp file is stranded. The SessionStart hook is the natural
   reaper — it already scans the staging directory. Add a cleanup step that
   deletes any `tmp/*.jsonl` files older than 1 hour before checking `pending/`
   count. Define "older than 1 hour" via mtime.

4. **Haiku agent prompt.** The per-session stager needs a tight system prompt:
   what to read from the hook input (tool call types, outputs, error signals),
   what to produce (candidate_text length, tag vocabulary, priority scoring
   rubric), and what to skip (status checks, passing tests, trivial sessions
   with priority < 0.4). This prompt is the highest-leverage design surface in
   the entire pipeline — a weak prompt produces low-signal ledger entries that
   the cold-path reviewer cannot rescue.

5. **Cost ceiling.** At ~$0.002/session average, 10 sessions/day = ~$0.60/month
   for the hot path. Cold-path Sonnet reviewer at ~$0.01 per drain, firing
   roughly every 5 sessions = ~$0.60/month. Total: ~$1.20/month at 10
   sessions/day. Confirm this is acceptable; define a monthly cap and where the
   cap check runs (SessionStart hook could skip if a monthly-cost counter
   exceeds threshold, stored in the same staging directory).

6. **First-run / migration.** Sessions before the hook lands have no staged
   entries. No backfill from existing chat logs is planned — the pipeline
   starts capturing from the first session after install. Document this in
   the plugin's CLAUDE.md as expected behavior.

7. **Compound-lifecycle interaction.** The `compound-lifecycle` skill's Step 1
   excludes `docs/solutions/archived/**` and `_lifecycle-runs/**` but does not
   exclude staging-reviewer-promoted entries from its candidate set. This is
   correct — promoted entries should be part of the lifecycle audit. Confirm
   there is no interaction between the staging-reviewer's promotion writes and
   a concurrent `compound-lifecycle` run (both use `knowledge-compounder`,
   which writes atomically and validates paths).

---

## Cross-References

**Existing components this builds on:**

- `plugins/yellow-core/commands/workflows/compound.md` — the manual compounding
  command; the `/compound:review-staged` override command lives alongside this
- `plugins/yellow-core/agents/workflow/knowledge-compounder.md` — handles all
  file writes; staging-reviewer delegates promotion to this agent
- `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` — cold-path catalog
  maintenance; distinct from staging-reviewer but shares the 0.82 cosine
  dedup threshold
- `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` — canonical background
  subshell pattern for hooks; Stop-hook stager uses this pattern verbatim
- `plugins/yellow-research/hooks/lib/context7-cache.sh` — `_lc_atomic_write()`
  function: `tmp.$$` + `mv` pattern for safe file writes from hooks; stager
  uses the same approach for JSONL files
- `plugins/yellow-ci/hooks/scripts/session-start.sh` — SessionStart hook
  structure: latency budget, `json_exit()` helper, TTL-gated cache check pattern
- `plugins/yellow-ruvector/hooks/scripts/stop.sh` — only existing Stop hook;
  reference for hook timeout (10s), `set -uo pipefail` (no `-e`), `json_exit()`
  pattern
- Auto-memory location `~/.claude/projects/<hash>/memory/` — the staging
  directory `~/.claude/projects/<hash>/compound-staging/` follows the same
  per-project convention
- `plugins/yellow-core/skills/memory-remember-pattern/SKILL.md` — Tiered-
  Remember-After-Act pattern; the staging-reviewer's promotion step is
  effectively a deferred Auto-tier remember across a batch of sessions

**External research findings:**

- Letta/MemGPT tiered memory (core/archival/recall) validates the staged-vs-
  promoted separation; their archival tier is the closest analog to the pending
  ledger
- Reflexion agent memory: structured episodic containers with confidence scores
  and promote-flags — the `priority` field in the JSONL schema follows this
- JSONL as staging format: consensus across LangChain (JSON docs in store),
  LlamaIndex (typed memory blocks), mem0 (structured extraction records)

---

## Out of Scope / Future Work

- **Backfill from existing chat logs.** No mechanism planned. Capture starts
  at first session post-install.
- **Cross-project compounding.** The staging ledger is per-project. A global
  ledger (`~/.claude/compound-staging.jsonl`) that captures cross-project
  patterns is a natural follow-on but introduces cross-project write contention.
  Defer.
- **User-visible staging dashboard.** A `/compound:status` command showing
  pending entry count, oldest entry age, and last drain timestamp would close
  the feedback loop. Useful but not required for the MVP to function.
- **PostToolUse staging.** Capturing mid-session "micro-learnings" as
  individual tool-call outputs arrive (rather than once at Stop) would improve
  signal granularity. Deferred — Stop-hook capture is simpler and sufficient
  for V1.
- **Config exposure via `yellow-plugins.local.md`.** Drain thresholds
  (`age_hours`, `count_threshold`) and cost ceiling. Hardcode for MVP, expose
  via local-config skill schema as follow-on.
