# Symphony-Style Orchestration Plugin Brainstorm

**Date:** 2026-04-01 (updated 2026-04-02)
**Status:** Finalized — plan at [plans/yellow-symphony-plugin.md](../../plans/yellow-symphony-plugin.md)
**Approach:** Thin management layer over OpenClaw-hosted daemon (revised from full reimplementation)
**Source:** OpenAI Symphony SPEC.md (Draft v1, language-agnostic)

> **Architectural Pivot (2026-04-02):** After research, Symphony orchestration
> belongs as an **OpenClaw plugin** (capability extension on Proxmox VM), not a
> reimplementation inside Claude Code. The Claude Code plugin
> (`yellow-symphony`) becomes a **thin remote management layer** over the
> OpenClaw-hosted daemon. See "Revised Architecture" section below.

## What We're Building

A thin Claude Code management plugin (`yellow-symphony`) that provides SSH-based
status queries, config validation, and remote control over a Symphony
orchestration daemon hosted as an OpenClaw plugin on a Proxmox VM. No
orchestration logic lives in this plugin.

## Symphony Architecture Summary

Symphony is a long-running daemon that polls Linear, creates an isolated
workspace per issue, and runs a coding agent session inside each workspace until
the issue reaches a handoff state. Core loop: **poll -> filter eligible -> claim
-> create workspace -> render prompt from WORKFLOW.md -> launch agent -> stream
events -> reconcile -> retry or release**. The orchestrator owns scheduling
state in-memory (no database) and recovers from filesystem + tracker state on
restart. Runtime behavior lives in a repo-owned `WORKFLOW.md`: YAML front matter
(tracker config, polling interval, workspace root, hooks, concurrency, Codex
settings) plus a Markdown prompt template with Liquid-style interpolation.
Symphony is a scheduler/runner and tracker _reader_ only -- ticket writes
(status transitions, PR links, comments) are the coding agent's job.

## Component Mapping Table

| Symphony Component       | OpenClaw Responsibility                                                  | Claude Code (yellow-symphony)                     |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------- |
| **Workflow Loader**      | Reads repo-local `SYMPHONY.md`, parses front matter + prompt at dispatch | `/symphony:config` validates the same schema      |
| **Config Layer**         | Loads YAML front matter at runtime; full Symphony schema                 | Validates subset via bash `case`/`if`; no dynamic reload |
| **Issue Tracker Client** | Direct Linear API calls for poll/claim/update                            | yellow-linear MCP tools for status queries (optional) |
| **Orchestrator**         | Core daemon: poll, claim, dispatch, concurrency, retry                   | `/symphony:status` queries state via SSH          |
| **Workspace Manager**    | `git worktree` per issue on the VM                                       | Not involved — OpenClaw manages worktrees         |
| **Agent Runner**         | OpenClaw Agent Runtime (configurable: Claude, Codex, etc.)               | Not involved — runner choice is daemon config     |
| **Prompt Builder**       | Renders prompt from `SYMPHONY.md` template with issue variables          | Not involved — scaffolds template only            |
| **Status Surface**       | Exposes `status --json` CLI subcommand                                   | `/symphony:status` queries via SSH, formats table |
| **Logging**              | Log files on VM under daemon-managed paths                               | `/symphony:logs` tails via SSH                    |
| **linear_graphql tool**  | Direct Linear API (daemon-side)                                          | yellow-linear MCP tools (Claude Code-side)        |

## Why This Approach

**Capability extension over reimplementation.** After researching Symphony's
architecture, the orchestration daemon (poll/claim/dispatch/reconcile) belongs as
an OpenClaw plugin — OpenClaw already provides cron scheduling, a plugin system,
Agent Runtime, and systemd lifecycle. Reimplementing this inside Claude Code
would duplicate infrastructure for zero benefit. The Claude Code plugin becomes a
remote management layer only.

**Rejected alternatives:**
- **Full reimplementation in Claude Code**: Duplicates OpenClaw infra, no
  persistent daemon support
- **Sidecar alongside OpenClaw**: Doubles operational overhead (two services, two
  log streams) for zero isolation benefit on a single VM

## Revised Architecture

```text
Proxmox VM (OpenClaw plugin)              Claude Code (yellow-symphony)
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ openclaw-symphony plugin     │          │ yellow-symphony plugin       │
│  ├─ poll Linear (cron 30s)   │          │  ├─ /symphony:status         │
│  ├─ claim + state machine    │  ←ssh→   │  ├─ /symphony:config         │
│  ├─ create worktree          │          │  ├─ /symphony:pause/resume   │
│  ├─ dispatch agent runtime   │          │  ├─ /symphony:logs           │
│  ├─ log + reconcile          │          │  └─ symphony-conventions     │
│  └─ cleanup on terminal      │          │     (SYMPHONY.md schema ref) │
└──────────────────────────────┘          └──────────────────────────────┘
```

**Why capability extension, not sidecar:**

- OpenClaw already has cron scheduling, plugin system, Agent Runtime, and
  systemd lifecycle
- Symphony's orchestrator is intentionally stateless — recovers from tracker +
  filesystem
- Sidecar doubles operational overhead (two services, two log streams,
  duplicated credentials) for zero isolation benefit on a single VM
- Clean internal interface between tracker/state-machine and dispatch enables
  future sidecar extraction if needed

**Scope split:**

- **OpenClaw plugin** (separate repo): poll/claim/dispatch/reconcile/log/recover
  — the daemon
- **yellow-symphony** (this repo): remote status/config/control + workflow
  contract authoring conventions

## Plugin Structure (Revised — thin management layer)

```text
plugins/yellow-symphony/
  .claude-plugin/plugin.json
  package.json
  CLAUDE.md
  CHANGELOG.md
  README.md
  commands/symphony/
    setup.md         # Validate SSH to Proxmox, OpenClaw running, plugin installed
    status.md        # Query daemon state (running sessions, queue, completions)
    config.md        # Validate + edit repo-local SYMPHONY.md
    pause.md         # Toggle daemon polling off
    resume.md        # Toggle daemon polling on
    logs.md          # Tail logs for a specific issue run
  skills/symphony-conventions/
    SKILL.md         # SYMPHONY.md schema, prompt template patterns, conventions
```

## Decision Points

### DECISION-1: Reimplement orchestrator or wrap Elixir reference?

**RESOLVED → A: Reimplement as OpenClaw plugin (Node.js).** SPEC.md says
"implement your own hardened version." OpenClaw's Gateway is already Node.js. No
Elixir dependency.

### DECISION-2: Persistent daemon or on-demand session?

**RESOLVED → OpenClaw capability extension.** The orchestrator runs inside
OpenClaw's Gateway process as a cron-scheduled plugin action. Persistent by
default (systemd manages OpenClaw). Claude Code plugin is management-only — no
daemon responsibility.

### DECISION-3: Linear-only or abstract tracker?

**RESOLVED → A: Linear-only.** YAGNI. OpenClaw plugin talks to Linear API
directly. Claude Code side uses yellow-linear MCP for status queries.

### DECISION-4: Workspace isolation strategy

**RESOLVED → A: git worktree per issue.** OpenClaw plugin manages worktree
creation/cleanup on the VM. Claude Code plugin has no workspace
responsibilities.

### DECISION-5: Agent runner — what replaces Codex app-server?

**RESOLVED → OpenClaw Agent Runtime.** The dispatch bridge uses OpenClaw's
existing Agent Runtime rather than spawning raw subprocesses. Runner type
(Claude, Codex, etc.) is configurable in SYMPHONY.md. Claude Code plugin not
involved in execution.

### DECISION-6: Proof of Work validation

**OPEN.** Still applies to the OpenClaw plugin side. MVP: agent-driven (prompt
instructs agent to run tests, create PR). Target: hybrid with orchestrator-side
hook verification.

### DECISION-7: Coexistence with OpenClaw

**RESOLVED → Symphony IS an OpenClaw capability.** No coexistence problem — the
orchestration logic is a plugin within OpenClaw, using the same Agent Runtime,
credentials, and infrastructure. Label-based partitioning may still be useful to
distinguish Symphony-managed issues from manually-triggered OpenClaw sessions.

### DECISION-8: WORKFLOW.md location

**RESOLVED → A: Repo-root `SYMPHONY.md`.** Upstream convention;
version-controlled with code. The Claude Code `/symphony:config` command
validates and edits this file.

## Integration Points (Revised)

| System                 | Role                                 | Mechanism                                 |
| ---------------------- | ------------------------------------ | ----------------------------------------- |
| **OpenClaw (Proxmox)** | Hosts the orchestrator plugin        | SSH from Claude Code for status/control   |
| **yellow-linear**      | Status queries from Claude Code side | MCP tools (`list_issues`, `get_issue`)    |
| **yellow-review**      | Review PRs created by Symphony runs  | `/review:pr` on PRs tagged `symphony`     |
| **gt-workflow**        | Not used by this plugin              | OpenClaw manages worktrees directly on VM |
| **yellow-codex**       | Not used by this plugin              | Runner choice is OpenClaw plugin config   |

## MVP Scope (Revised — thin management layer only)

**Ships first (Phase 1) — Claude Code plugin:**

- `/symphony:setup` — validate SSH connectivity to Proxmox VM, OpenClaw running,
  symphony plugin installed, `SYMPHONY.md` exists in current repo
- `/symphony:status` — SSH to daemon, query running sessions, queue depth,
  recent completions, display formatted table
- `/symphony:config` — parse and validate repo-local `SYMPHONY.md` against
  schema, offer guided editing
- `symphony-conventions` skill — SYMPHONY.md schema reference, prompt template
  patterns
- `SYMPHONY.md.example` template — starter workflow contract

**Phase 2 — remote control:**

- `/symphony:pause` / `/symphony:resume` — toggle daemon polling via SSH command
- `/symphony:logs` — tail/search logs for a specific issue ID

**Phase 3 — integration:**

- Auto-review: hook into yellow-review when Symphony PRs land
- Metrics: token spend, success rate, time-to-PR per issue

**Out of scope for this repo:** poll loop, issue claiming, worktree management,
agent dispatch, retry/reconciliation — all OpenClaw plugin responsibilities.

## Risk Register (Revised)

| Risk                                             | Impact | Mitigation                                                                                       |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------ |
| SSH connectivity to Proxmox unreliable           | Medium | `/symphony:setup` validates; show clear error with reconnect instructions                        |
| OpenClaw symphony plugin API changes             | Medium | Version the status/control protocol; pin to known OpenClaw plugin version                        |
| SYMPHONY.md schema drift between repos           | Low    | Skill documents canonical schema; `/symphony:config` validates                                   |
| User edits SYMPHONY.md without validation        | Low    | Pre-commit hook (optional) or `/symphony:config` as primary edit path                            |
| OpenClaw daemon down, no feedback in Claude Code | Medium | `/symphony:status` shows daemon health; recommend systemd alerting                               |
| Prompt injection via issue descriptions          | High   | Document fencing requirement in symphony-conventions skill; enforcement is OpenClaw plugin's job |

## Open Questions (Revised)

1. **OpenClaw plugin API contract:** ~~What status/control interface should the
   OpenClaw symphony plugin expose? REST endpoint? Unix socket? CLI command?~~
   **RESOLVED → CLI subcommands over SSH.** See plan Assumptions section.
2. **SSH vs API for remote control:** ~~SSH is simplest but requires key
   management.~~ **RESOLVED → SSH + CLI.** Key management handled by setup
   wizard. See plan Assumptions section.
3. **SYMPHONY.md schema:** Define the exact YAML front matter schema for the
   workflow contract. What fields from Symphony SPEC.md are relevant when
   OpenClaw manages dispatch?
4. **Log format/location:** Where does the OpenClaw plugin write logs?
   Structured JSON for parsing, or plain text for `tail`?
5. **SPEC.md stability:** Draft v1 may have breaking changes. Pin to specific
   behaviors or stay loose?
6. **Cross-repo workflow contracts:** Can one SYMPHONY.md reference another
   repo's config, or is it strictly per-repo?
7. **Auth for status queries:** If OpenClaw exposes an HTTP API, what auth
   mechanism? API key? mTLS? Bearer token from existing credentials?
