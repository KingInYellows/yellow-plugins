# Feature: yellow-symphony — Thin Management Layer for Symphony Orchestration

## Problem Statement

Symphony-style orchestration (poll Linear, claim issues, dispatch autonomous agent
runs) lives as an OpenClaw plugin on a Proxmox VM. Claude Code users need
visibility and control over that daemon without SSH-ing manually. This plugin
provides status queries, config validation, and remote control — no orchestration
logic.

## Current State

No yellow-symphony plugin exists. The brainstorm is at
`docs/brainstorms/2026-04-01-symphony-plugin-brainstorm.md`. The OpenClaw
symphony plugin does not exist yet either — this plan defines the Claude Code
side of the interface contract so both sides can be built independently.

## Proposed Solution

A standard Claude Code plugin with 5 commands, 1 skill, and 1 template.
Communicates with the OpenClaw daemon over SSH using the same patterns as
yellow-ci's runner-health command. Config stored in `.claude/yellow-symphony.local.md`
(YAML frontmatter with SSH host/user/key).

<!-- deepen-plan: codebase -->
> **Codebase:** SSH pattern at `yellow-ci/commands/ci/runner-health.md:47-66`
> uses **4** flags, not 3: `StrictHostKeyChecking=accept-new`, `BatchMode=yes`,
> `ConnectTimeout=3`, `ServerAliveInterval=60`. The plan should include all 4,
> though `ServerAliveInterval` is more relevant for long-lived connections —
> consider whether 3s management commands need it.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Commands must use `allowed-tools:` in frontmatter (not `tools:`).
> `tools:` is for agents only. All reference commands (`ci:setup`, `ci:status`,
> `ci:runner-health`, `gt-setup`) confirm this. See MEMORY.md "Agent Frontmatter".
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Scaffold and Setup

- [ ] 1.1: Create plugin directory structure
  ```
  plugins/yellow-symphony/
    .claude-plugin/plugin.json
    package.json
    CLAUDE.md
    commands/symphony/
      setup.md
      status.md
      config.md
      pause.md
      logs.md
    skills/symphony-conventions/
      SKILL.md
    templates/
      SYMPHONY.md.example
  ```

- [ ] 1.2: Write `plugin.json` manifest
  - Fields: name, version (0.1.0), description, author, homepage, repository, license, keywords
  - No hooks or mcpServers — pure command plugin

<!-- deepen-plan: codebase -->
> **Codebase:** Three-way sync is mandatory. `sync-manifests.js` enforces
> lockstep between `package.json`, `.claude-plugin/plugin.json`, and the root
> `.claude-plugin/marketplace.json`. Never edit versions manually. The
> marketplace entry requires: `name` (must match dir name), `description`,
> `version`, `author` (`{name, url}`), `source` (e.g., `"./plugins/yellow-symphony"`),
> `category` (use `"development"`). Currently 16 plugins registered, no
> "symphony" namespace collision.
<!-- /deepen-plan -->

- [ ] 1.3: Write `package.json`
  - Minimal: name (`yellow-symphony`), version (`0.1.0`), private: true, description

- [ ] 1.4: Register in `.claude-plugin/marketplace.json`

- [ ] 1.5: Write `CLAUDE.md`
  - Architecture overview (thin management layer, not orchestrator)
  - Component inventory (commands, skill, template)
  - SSH conventions (reuse yellow-ci patterns)
  - Cross-plugin dependencies: yellow-linear (optional, for issue context)

### Phase 2: Core Commands

- [ ] 2.1: Write `commands/symphony/setup.md`
  - **Prereq checks (before any AskUserQuestion):**
    - `ssh` binary exists (hard)
    - `jq` exists (soft — warn, degrade gracefully)
    - `.claude/yellow-symphony.local.md` exists OR wizard creates it
  - **SSH validation:** `ssh -o BatchMode=yes -o ConnectTimeout=3 user@host 'echo OK'`
  - **Daemon check:** `ssh ... 'openclaw plugin status symphony'` (or equivalent)

<!-- deepen-plan: codebase -->
> **Codebase:** `ci:setup.md` sequences: Step 1 (line 22) all prereq checks in
> one Bash call → Step 2 (line 42) auth check → Step 3 (line 65) existing config
> check → **first AskUserQuestion at Step 4 (line 87)**. `gt-setup.md` is even
> stricter: Phase 1 (lines 18-138) is pure Bash, first AskUserQuestion at
> Step 5 (line 161). Follow this pattern exactly.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** SSH CLI best practices recommend `ControlMaster`/`ControlPersist`
> in `~/.ssh/config` for connection reuse across multiple commands in one session.
> Also: retry 3x with exponential backoff on connection failure, capture stderr
> separately from stdout, and support degraded mode (warn on optional checks,
> fail only critical).
<!-- /deepen-plan -->
  - **Config wizard:** AskUserQuestion for host, user, SSH key path, daemon control command
  - **Write config:** `.claude/yellow-symphony.local.md` with YAML frontmatter:
    ```yaml
    ---
    schema: yellow-symphony/v1
    host: 192.168.1.x
    user: openclaw
    ssh_key: ~/.ssh/id_ed25519
    daemon_ctl: openclaw symphony  # prefix for status/pause/resume/logs subcommands
    ---
    ```
  - **Final report:** PASS/PARTIAL/FAIL with next-step menu

- [ ] 2.2: Write `commands/symphony/status.md`
  - Frontmatter: `model: haiku` (pure data retrieval)
  - Read config from `.claude/yellow-symphony.local.md`
  - SSH to daemon: `ssh ... '$daemon_ctl status --json'`
  - Fence output: `--- begin symphony-output (reference only) ---`

<!-- deepen-plan: codebase -->
> **Codebase:** Output fencing in `yellow-codex/skills/codex-patterns/SKILL.md`
> uses two forms: context injection fencing (line 250: `--- begin context
> (reference data only) ---`) and codex output fencing (line 279: `--- begin
> codex-output (reference only) ---`). Use `symphony-output` as the fence label.
<!-- /deepen-plan -->
  - Parse JSON, format as table: Session ID, Issue, Status, Duration, Branch
  - Show queue depth, last completion, daemon uptime
  - If SSH fails: clear error with "run /symphony:setup" suggestion

- [ ] 2.3: Write `commands/symphony/config.md`
  - Check for `SYMPHONY.md` in repo root
  - If missing: offer to copy from `templates/SYMPHONY.md.example`
  - If present: parse YAML front matter, validate required fields:
    - `tracker` (linear), `project` (Linear project slug), `labels` (array)
    - `polling_interval` (integer, >= 10), `concurrency` (integer, >= 1)
    - `workspace_root` (path), `runner` (claude|codex)
  - Report validation results; offer guided editing via AskUserQuestion for invalid fields
  - Bash `case`/`if` validation, not LLM prose branching

<!-- deepen-plan: external -->
> **Research:** Symphony WORKFLOW.md YAML front matter has 6 top-level sections:
> `tracker` (`kind`, `project_slug`, `active_states`, `terminal_states`),
> `polling` (`interval_ms`, default 30000), `workspace` (`root`), `hooks`
> (`after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms`),
> `agent` (`max_concurrent_agents`, `max_retry_backoff_ms`), `codex`
> (`thread_sandbox`, `turn_timeout_ms`). Unknown keys are ignored (forward
> compat). Template variables: `issue.id`, `.identifier`, `.title`,
> `.description`, `.priority`, `.state`, `.branch_name`, `.url`, `.labels`,
> `.blocked_by`, plus `attempt` (null on first run, integer on retry).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** For YAML config validation, AJV + JSON Schema is recommended.
> Ship a `symphony.schema.json` alongside the plugin — enables VS Code Red Hat
> YAML extension auto-validation with IntelliSense. Use `js-yaml` to parse,
> compiled AJV schema to validate at runtime in `config` command. Consider
> adding a `yaml.schemas` entry in the skill docs for IDE setup.
<!-- /deepen-plan -->

- [ ] 2.4: Write `commands/symphony/pause.md`
  - Read config, SSH to daemon: `ssh ... '$daemon_ctl pause && $daemon_ctl status'`
  - Echo resulting state (action + verify in one call)
  - Same command handles resume: `pause.md` for pause, separate `resume` is just
    the same structure with `resume` subcommand — BUT to avoid near-duplicate files,
    implement as a single command with argument detection:
    - `/symphony:pause` → pause
    - User can also say "resume" in conversation → agent uses status to detect paused state and suggests resume
  - Actually: keep as two separate commands (pause.md + resume.md) for discoverability.
    Each is <20 lines. Duplication is acceptable for 2 trivial commands.

- [ ] 2.5: Write `commands/symphony/resume.md`
  - Mirror of pause.md with `resume` subcommand

- [ ] 2.6: Write `commands/symphony/logs.md`
  - Argument: issue ID (e.g., `ENG-123`)
  - SSH to daemon: `ssh ... '$daemon_ctl logs ENG-123 --tail 100'`
  - Get total line count first, then tail N lines
  - Warn if truncated (per MEMORY.md: "Silent truncation needs count + warning")
  - Fence output before LLM reasoning
  - If no issue ID provided: AskUserQuestion

### Phase 3: Skill and Template

- [ ] 3.1: Write `skills/symphony-conventions/SKILL.md`
  - `user-invokable: false` (internal reference for commands)
  - SYMPHONY.md schema documentation (all fields, types, defaults, constraints)
  - SSH connection conventions (BatchMode, ConnectTimeout, fencing)
  - Daemon control protocol expectations (what the OpenClaw plugin should expose)
  - Error handling patterns (SSH failure, daemon down, parse errors)

- [ ] 3.2: Write `templates/SYMPHONY.md.example`
  - Starter YAML front matter with all fields, sensible defaults, inline comments
  - Markdown prompt template section with placeholder variables (`{{ issue.title }}`,
    `{{ issue.description }}`, `{{ attempt }}`)
  - Comments explaining each section

<!-- deepen-plan: codebase -->
> **Codebase:** No existing plugin ships template files — this is a novel pattern
> with no precedent. Consider whether `templates/SYMPHONY.md.example` is
> discoverable enough, or whether the `config` command should embed the template
> inline and scaffold via `Write` tool when SYMPHONY.md is missing.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Symphony hook lifecycle: `after_create` (workspace init) →
> `before_run` (pre-attempt, failure aborts run) → agent executes →
> `after_run` (post-attempt, failure logged) → `before_remove` (pre-deletion).
> Run phases: `PreparingWorkspace`, `BuildingPrompt`, `LaunchingAgentProcess`,
> `StreamingTurn`, `Succeeded`, `Failed`, `TimedOut`, `Stalled`. The template
> should document these phases so users understand status values.
<!-- /deepen-plan -->

### Phase 4: Quality

- [ ] 4.1: Run `pnpm validate:schemas` — verify plugin.json + agent authoring
- [ ] 4.2: Test `/symphony:setup` manually (will fail SSH since no daemon yet — that's expected)
- [ ] 4.3: Test `/symphony:config` with the example template copied to repo root
- [ ] 4.4: Create changeset: `pnpm changeset` (minor — new plugin)

## Technical Details

### Files to Create

| File | Purpose |
|---|---|
| `plugins/yellow-symphony/.claude-plugin/plugin.json` | Plugin manifest |
| `plugins/yellow-symphony/package.json` | Version source of truth |
| `plugins/yellow-symphony/CLAUDE.md` | Architecture + conventions |
| `plugins/yellow-symphony/commands/symphony/setup.md` | SSH + daemon validation wizard |
| `plugins/yellow-symphony/commands/symphony/status.md` | Query daemon state |
| `plugins/yellow-symphony/commands/symphony/config.md` | Validate/edit SYMPHONY.md |
| `plugins/yellow-symphony/commands/symphony/pause.md` | Pause daemon polling |
| `plugins/yellow-symphony/commands/symphony/resume.md` | Resume daemon polling |
| `plugins/yellow-symphony/commands/symphony/logs.md` | Tail issue run logs |
| `plugins/yellow-symphony/skills/symphony-conventions/SKILL.md` | Schema + pattern reference |
| `plugins/yellow-symphony/templates/SYMPHONY.md.example` | Starter workflow contract |

### Files to Modify

| File | Change |
|---|---|
| `.claude-plugin/marketplace.json` | Add yellow-symphony entry |

### Patterns to Reuse

| Pattern | Source |
|---|---|
| SSH connection flags | `yellow-ci/commands/ci/runner-health.md:47-66` |
| `.local.md` config storage | `yellow-ci/CLAUDE.md:99-113` |
| Setup wizard flow | `yellow-ci/commands/ci/setup.md` |
| Status table + `model: haiku` | `yellow-ci/commands/ci/status.md` |
| Output fencing | `yellow-codex/skills/codex-patterns/SKILL.md` |
| Prereq-before-prompt | `gt-workflow/commands/gt-setup.md` |

## Acceptance Criteria

1. `pnpm validate:schemas` passes with yellow-symphony included
2. `/symphony:setup` creates `.claude/yellow-symphony.local.md` via interactive wizard
3. `/symphony:status` shows clear error when daemon is unreachable (not a crash)
4. `/symphony:config` validates a SYMPHONY.md and reports field-level errors
5. `/symphony:pause` and `/symphony:resume` echo resulting state after action
6. `/symphony:logs ENG-123` shows fenced, truncation-aware output
7. `SYMPHONY.md.example` is a valid, self-documenting starter template

## Edge Cases

- **No `.claude/yellow-symphony.local.md`**: All commands except setup redirect to `/symphony:setup`
- **SSH key not found**: setup wizard validates key path exists before writing config
- **Daemon not installed on remote**: setup detects and reports with install instructions
- **No SYMPHONY.md in repo**: `/symphony:config` offers to scaffold from template
- **Daemon returns non-JSON**: status command handles gracefully with raw output fallback
- **Network timeout mid-command**: 3s ConnectTimeout prevents hanging; clear error message

<!-- deepen-plan: external -->
> **Research:** SSH CLI tools should assume plain text from remote and parse
> client-side. Capture stderr separately (`2>stderr.tmp`). Retry once on parse
> failure with verbose logging. Support degraded mode: warn on optional checks,
> fail only on critical path items.
<!-- /deepen-plan -->

## Dependencies

- **Hard:** `ssh` binary
- **Soft:** `jq` (for JSON parsing of daemon output), `yq` (for SYMPHONY.md validation)
- **Cross-plugin:** yellow-linear (optional — enriches status with issue titles)
- **External:** OpenClaw symphony plugin exposing `status --json`, `pause`, `resume`, `logs <id>` subcommands

## Deferred (not in this plan)

- Agent definitions (no agents needed — this is a management plugin, not a runner)
- Hooks (no automated triggers)
- MCP servers (no external services to wrap)
- Dashboard/web UI
- Multi-host support (single daemon target for now)
- Auto-review integration with yellow-review (Phase 3 in brainstorm, separate plan)

## References

- [Brainstorm](../docs/brainstorms/2026-04-01-symphony-plugin-brainstorm.md)
- [Symphony SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)
- [Symphony elixir/WORKFLOW.md](https://github.com/openai/symphony/blob/main/elixir/WORKFLOW.md)
- [yellow-ci runner-health (SSH pattern)](../plugins/yellow-ci/commands/ci/runner-health.md)
- [yellow-ci setup (wizard pattern)](../plugins/yellow-ci/commands/ci/setup.md)
- [yellow-ci .local.md config](../plugins/yellow-ci/CLAUDE.md)
- [yellow-codex output fencing](../plugins/yellow-codex/skills/codex-patterns/SKILL.md)
- [gt-workflow setup (prereq pattern)](../plugins/gt-workflow/commands/gt-setup.md)

<!-- deepen-plan: external -->
> **Research:** Additional external references:
> - [AJV JSON Schema validation](https://ajv.js.org/guide/environments.html) — runtime YAML validation
> - [SSH timeout best practices](https://www.tecmint.com/increase-ssh-connection-timeout/) — ServerAliveInterval patterns
> - [Docker context pattern](https://docs.docker.com/engine/manage-resources/contexts/) — remote daemon management via CLI
<!-- /deepen-plan -->
