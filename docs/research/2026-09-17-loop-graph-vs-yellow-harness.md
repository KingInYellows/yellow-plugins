# Loop and graph lineages vs the yellow harness

**Date:** 2026-09-17 **Status:** research note (docs-only). No command, pin, or
marketplace change. **Verified against:** KingInYellows/yellow-plugins main
`80f125dd`; plugins/yellow-goal README SHA `9ff5eeb1`;
plugins/yellow-goal/CLAUDE.md forbid list; KingInYellows/yellow-goal /
`goal-gen` 0.2.0 consumer contract as previously inspected. Native Claude Code
`/goal` `/loop` presence on any given operator binary is **unverified**. Engine
unit tests were **not** re-run in the session that produced this note.

**Scope:** name three control-plane lineages, map them onto the harness this org
actually operates, and record what must not be imported. Mappings are analogous,
not identity.

## Three lineages (keep separate)

1. **Community Loop Engineering** (method, not a library). Design the system
   that prompts the agent instead of prompting it yourself. Claude Code session
   primitives `/goal` (until a model-judge done-condition or turn cap) and
   `/loop` (interval bursts until cancelled) are session controls if present on
   the installed `claude` binary. The native `/goal` evaluator is another model,
   not yellow-goal `verify`.
2. **Google ADK 2 Graph Engineering** (a runtime). Official docs describe
   declarative graphs, dynamic/code orchestration, and prebuilt
   sequential/parallel/loop agents. Live package observed 2026-09-15:
   `google-adk` 2.9.1. The `google-adk==2.3.0` pin is a codelab learning pin,
   not this org's runtime. ADK is out of scope unless the primary runtime
   becomes ADK Runner and Provider Protocol v1 is retired.
3. **yellow-goal / `goal-gen` GOAP** (owned third lineage). An LLM authors an
   action graph; a deterministic A\* planner with no LLM inside orders it; an
   orchestrator runs extract → plan → confirm definition of done → execute →
   ground-truth verify → bounded replan. Closest ADK analog is "graph for plan
   shape." Closest Loop Engineering analog is "execute-verify-repeat" as the
   outer cycle.

A fourth use, **knowledge graph** (entities/relations; ruvector today), is not
control flow. `yellow-mempalace` is not in `.claude-plugin/marketplace.json`
(removed in favor of `yellow-ruvector`; see
`plugins/yellow-ruvector/CHANGELOG.md` commit `f0c818d`).

Slogan to keep rejecting: "graphs replaced Loop Engineering." A graph can
contain loops. Loop Engineering is the ops layer around whatever control plane
you pick.

This marketplace must **never import ADK 2**. This plugin must **never run
`--executor claude-code`**.

## Harness in scope

```text
L1  Claude Code session          native /goal /loop if present, hooks, worktrees
L2  yellow-plugins marketplace   plugin catalog, validators, skills, MCPs
      yellow-core /flow:*        human-paced markdown DAG
      yellow-council             fan-out + join review
      yellow-goal plugin         process adapter only
L3  Process contract             spawn, never import (plugin CLAUDE.md)
L4  goal-gen engine              GOAP graph + orchestrator loop
L5  Executors                    v1 serial claude -p on the engine host
```

The development system is **Claude Code + yellow-plugins + a pinned `goal-gen`
process**. It is not DeepSeek Harness, not ADK Runner, not yellow-symphony as
the control plane.

### Human plane — yellow-core `/flow:*`

Documented session DAG for shell-based work: `/flow:brainstorm` → `/flow:plan` →
`/flow:spec` (spec-tier escalation only) → `/flow:decompose` →
`/flow:pick-next-shell` → `/flow:expand-shell` → `/flow:work` → `/flow:review` →
`/plan:complete`, then back to `/flow:pick-next-shell` for the next shell.
`/flow:brainstorm` hands off to `/flow:plan <resolved-path>`; `/flow:spec` takes
a topic, not a brainstorm file. `/flow:plan` is also the alternate entry for
non-shell plans that skip decomposition when brainstorm is skipped. State lives
on disk under `plans/`.
An operator sits between sessions. `/worktree:cleanup` exists. yellow-council is
a review join (in-process Claude plus Codex, Antigravity, OpenCode), not a
planner.

`/flow:*` writes markdown shells. GOAP writes symbolic `WorldState`. They do not
share a schema. Merging them would be a new control plane.

### Machine plane — `goal-gen` (not the plugin)

`plugins/yellow-goal` is a pinned process consumer:

- Commands: `/goal:setup`, `/goal:request`, `/goal:run-stub` only
- Pin: `goal-gen` 0.2.0, tag `v0.2.0`, asset `goal-gen-0.2.0.tgz`, SHA-256
  `7ad266b22603007552b582b83349464cc67f4976eca63bf4db56ffacc4e1663a`
- Never imports engine TypeScript; never `analyze`; never
  `run --executor claude-code`
- Plugin version and engine version are independent identities

Engine CLI `inspect` means **packet-compiler repo inspection**
(`request → inspect → analyze → compile → packet verify` →
`repository-goal-packet@1` ZIP). It is not a GOAP plan dump. There is no `plan`
verb on 0.2.0. Plugin CLAUDE.md forbids exposing inspect / analyze / compile as
plugin commands.

Repository claim for the engine: M0 planner + M1 single-executor core are
implemented. Treat "tests green" as repo-asserted; this note did not rerun
`npm test`. Specified defaults previously read from engine `guardrails.ts`:
$20/run, 5 replans, ≤2 re-extractions, 60-minute wall clock, 3 retries/action,
same subgoal failing the same way twice → stop and escalate, concurrency 1.
Worktrees on the engine are collision-avoidance, not a sandbox. M2 (Codex +
Antigravity, dependency-graph parallelism, containers, dashboard) remains future
in the engine PRD.

## Correspondence table (analogous, not identity)

| Pattern                           | Already in this stack                               | Missing / blocked                         |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| Sequential pipeline               | `/flow:*`; A\* plan order                           | —                                         |
| Fan-out / join                    | yellow-council; `/flow:pick-next-shell` depends_on  | GOAP parallelism (M2)                     |
| Evaluator-optimizer loop          | goal-gen verify + replan                            | Plugin cannot start a live until-done run |
| Human gate                        | `/flow:*` session breaks; engine confirm / sign-off | —                                         |
| Worktrees                         | engine per-action; `/worktree:cleanup`              | Containers (M2)                           |
| Durable harness state             | `plans/` + MEMORY.md + ruvector                     | Unified flow + GOAP view                  |
| Scheduled outer loop              | hooks, CI                                           | No unattended `/loop` scheduler           |
| ADK-style persisted graph runtime | —                                                   | Intentionally absent                      |
| Native `/goal` `/loop`            | Session controls if present                         | Unverified; no marketplace wrap           |

## What to do / not do

**Do now (docs and operator practice only):**

- Keep the two planes separate: `/flow:*` for human-paced work; `goal-gen` on
  the engine host for machine GOAP.
- If the installed `claude` binary actually has `/goal` and `/loop`, use native
  `/goal <measurable condition + turn cap>` _inside_ an existing `/flow:work`
  session. Ground truth stays tests / CI / `/flow:review`. Do not treat the
  native evaluator as yellow-goal `verify`. `/goal clear` (if present) stops the
  native run.
- Do not add `/goal:inspect`, `/goal:analyze`, `/goal:compile`, or `/goal:run`
  with a real executor.

**Do later, only with an engine-first ADR:**

- A **new** engine verb with a distinct name (`plan-dump` / `graph-show`) on the
  pinned tarball, then a pin bump, then a plugin command that is not
  `/goal:inspect`.
- Live `/goal:run --executor claude-code` from the plugin. Protocol milestone,
  not a plugin feature. Correctly withheld on 0.2.0.
- M2 parallelism and per-run containers, already sequenced in the engine PRD.

**Never for this question:**

- `google-adk` or LangGraph as the yellow-plugins control plane
- Shadowing native `/goal` / `/loop` with marketplace commands
- Importing `goal-gen` TypeScript into the plugin
- Replacing `/flow:*` with GOAP or GOAP with ADK nodes
- A scheduled unattended `/flow:work` cron against production repos
- Treating mempalace as a live plugin
- Treating an unlisted DeepSeek "everything is a plugin" fork as this harness

## Flip conditions

Stay on this recommendation unless one of these changes:

- Claude Code is no longer the operator surface and ADK Runner is.
- `goal-gen capabilities --json` on the **pinned tarball** grows a read-only
  GOAP dump that does not call extract/analyze/executors.
- Native `/goal` swallows the `/goal:` plugin prefix — then freeze new `/goal:*`
  commands and pick another namespace.
- The requirement is unattended multi-hour execution with durable process
  resume. That is durable execution (Temporal-class), which neither ADK graphs
  nor a LangGraph checkpointer nor `/loop` on a laptop gives you by itself.

## Open probes

- Operator `claude` binary: does it expose `/goal` and `/loop`?
- Coexistence of native `/goal` vs plugin `/goal:setup`
- Exact 0.2.0 `capabilities --json` from the pinned tarball
- Whether a `repository-goal-packet@1` ZIP is readable without `analyze`
