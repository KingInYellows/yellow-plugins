# Feature: yellow-symphony — Thin Management Layer for Symphony Orchestration

**Status:** Draft -- not started

## Problem Statement

Symphony-style orchestration (poll Linear, claim issues, dispatch autonomous
agent runs) lives as an OpenClaw plugin on a Proxmox VM. Claude Code users need
visibility and control over that daemon without SSH-ing manually. This plugin
provides status queries, config validation, and remote control — no
orchestration logic.

## Current State

No yellow-symphony plugin exists. The brainstorm is at
`docs/brainstorms/2026-04-01-symphony-plugin-brainstorm.md`. The OpenClaw
symphony plugin does not exist yet either — this plan defines the Claude Code
side of the interface contract so both sides can be built independently.

## Proposed Solution

A standard Claude Code plugin with 6 commands and 1 skill.
Communicates with the OpenClaw daemon over SSH using the same patterns as
yellow-ci's runner-health command. Config stored in
`.claude/yellow-symphony.local.md` (YAML frontmatter with SSH host/user/key).

<!-- deepen-plan: codebase -->

> **Codebase:** SSH pattern at `yellow-ci/commands/ci/runner-health.md:47-66`
> uses **4** flags, not 3: `StrictHostKeyChecking=accept-new`, `BatchMode=yes`,
> `ConnectTimeout=3`, `ServerAliveInterval=60`.
>
> **RESOLVED:** Use 3 flags for short-lived commands (setup, status, config,
> pause, resume). Add `ServerAliveInterval=60` as a 4th flag for
> `/symphony:logs` only, since log tailing may transfer larger output. All
> commands use `timeout 10 ssh ...` to prevent hangs when the daemon accepts the
> connection but stalls (consistent with yellow-ci's runner-health pattern).

<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->

> **Codebase:** Commands must use `allowed-tools:` in frontmatter (not
> `tools:`). `tools:` is for agents only. All reference commands (`ci:setup`,
> `ci:status`, `ci:runner-health`, `gt-setup`) confirm this. See MEMORY.md
> "Agent Frontmatter".

<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Scaffold and Setup

- [ ] 1.1: Create plugin directory structure

  ```text
  plugins/yellow-symphony/
    .claude-plugin/plugin.json
    package.json
    CLAUDE.md
    CHANGELOG.md
    README.md
    commands/symphony/
      setup.md
      status.md
      config.md
      pause.md
      resume.md
      logs.md
    skills/symphony-conventions/
      SKILL.md
  ```

- [ ] 1.2: Write `plugin.json` manifest
  - Fields: name, version (0.1.0), description, author, homepage, repository,
    license, keywords
  - No hooks or mcpServers — pure command plugin

<!-- deepen-plan: codebase -->

> **Codebase:** Three-way sync is mandatory. `sync-manifests.js` enforces
> lockstep between `package.json`, `.claude-plugin/plugin.json`, and the root
> `.claude-plugin/marketplace.json`. Never edit versions manually. The
> marketplace entry requires: `name` (must match dir name), `description`,
> `version`, `author` (`{name, url}`), `source` (e.g.,
> `"./plugins/yellow-symphony"`), `category` (use `"development"`). Currently 16
> plugins registered, no "symphony" namespace collision.

<!-- /deepen-plan -->

- [ ] 1.3: Write `package.json`
  - Minimal: name (`yellow-symphony`), version (`0.1.0`), private: true,
    description

- [ ] 1.4: Register in `.claude-plugin/marketplace.json`

- [ ] 1.5: Write `CLAUDE.md`
  - Architecture overview (thin management layer, not orchestrator)
  - Component inventory (commands, skill, template)
  - SSH conventions (reuse yellow-ci patterns)
  - Cross-plugin dependencies: yellow-linear (optional, for issue context)

### Phase 2: Core Commands

> **Note:** The brainstorm deferred pause/resume/logs to a separate Phase 2, but
> since all 6 commands are thin SSH wrappers (each under 20 lines), implementing
> them together is lower risk than maintaining a partial release.

- [ ] 2.1: Write `commands/symphony/setup.md`
  - **Prereq checks (before any AskUserQuestion):**
    - `ssh` binary exists (hard)
    - `jq` exists (soft — warn, degrade gracefully)
    - `.claude/yellow-symphony.local.md` exists OR wizard creates it
  - **SSH validation:**
    - Normalize ssh_key before SSH calls: `ssh_key="${ssh_key/#\~/$HOME}"`
    - `timeout 10 ssh -i "$ssh_key" -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=3 user@host 'echo OK'`
  - **Daemon check:** `ssh ... 'openclaw symphony status'`

<!-- deepen-plan: codebase -->

> **Codebase:** `ci:setup.md` sequences: Step 1 (line 22) all prereq checks in
> one Bash call → Step 2 (line 42) auth check → Step 3 (line 65) existing config
> check (conditional AskUserQuestion at line 80 if config already exists) →
> **first unconditional AskUserQuestion at Step 4 (line 87)**. `gt-setup.md` is
> even stricter: Phase 1 (lines 18-138) is pure Bash, first AskUserQuestion at
> Step 5 (line 161). Follow this pattern: all hard prereq checks must complete
> before any user interaction.

<!-- /deepen-plan -->

<!-- deepen-plan: external -->

> **Research:** SSH CLI best practices recommend
> `ControlMaster`/`ControlPersist` in `~/.ssh/config` for connection reuse
> across multiple commands in one session. Also: retry 3x with exponential
> backoff on connection failure, capture stderr separately from stdout, and
> support degraded mode (warn on optional checks, fail only critical).

<!-- /deepen-plan -->

- **Config wizard:** AskUserQuestion for host, user, SSH key path, daemon
  control command
- **Write config:** `.claude/yellow-symphony.local.md` with YAML frontmatter:

  ```yaml
  ---
  schema: 1
  host: 192.168.1.x
  user: openclaw
  ssh_key: ~/.ssh/id_ed25519
  daemon_ctl: openclaw symphony # prefix for status/pause/resume/logs subcommands
  ---
  ```

- **Final report:** PASS/PARTIAL/FAIL with next-step menu

- [ ] 2.2: Write `commands/symphony/status.md`
  - Frontmatter: `model: haiku` (pure data retrieval)
  - Read config from `.claude/yellow-symphony.local.md`
  - Define common SSH invocation (reused by all commands):
    `ssh_cmd="timeout 10 ssh -i \"$ssh_key\" -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=3 \"$user@$host\""`
  - SSH to daemon: `$ssh_cmd "$daemon_ctl status --json"` (stderr captured to
    temp file via `2>ssh_stderr.tmp`; inspected on non-zero exit before fencing
    stdout)
  - Fence output per Security Considerations

<!-- deepen-plan: codebase -->

> **Codebase:** Reuse the repository's existing output-fencing pattern, e.g.
> `plugins/yellow-semgrep/commands/semgrep/status.md`:
> `--- begin semgrep-api-response (reference only) ---`. Use `symphony-output`
> as the fence label.

<!-- /deepen-plan -->

- Parse JSON, format as table: Session ID, Issue, Status, Duration, Branch
- Show queue depth, last completion, daemon uptime
- If SSH fails: clear error with "run /symphony:setup" suggestion

- [ ] 2.3: Write `commands/symphony/config.md`
  - Check for `SYMPHONY.md` in repo root
  - If missing: offer to scaffold via Write tool (template embedded in command)
  - If present: parse YAML front matter, validate required fields using upstream
    nested key structure (subset — unknown keys ignored per Symphony convention):
    - `tracker.kind` (must be `linear`), `tracker.project_slug` (Linear project
      slug), `tracker.active_states` (array of Linear status names),
      `tracker.terminal_states` (non-empty array of Linear status names)
    - `polling.interval_ms` (integer, >= 10000)
    - `agent.max_concurrent_agents` (integer, >= 1)
    - `workspace.root` (path)
  - The embedded starter template and validator must use the same nested keys so
    a config accepted locally is also valid for the daemon
  - Report validation results; offer guided editing via AskUserQuestion for
    invalid fields
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
>
> **RESOLVED:** Use Bash `case`/`if` field-by-field validation for the `config`
> command (consistent with every other command in this codebase). AJV + JSON
> Schema is a future enhancement for CI-time validation via `pnpm validate:schemas`
> extension, not a runtime command dependency.

<!-- /deepen-plan -->

- [ ] 2.4: Write `commands/symphony/pause.md`
  - Frontmatter: `model: haiku` (pure data retrieval, same as status)
  - Read config, SSH to daemon (two separate calls for clarity):
    `ssh ... "$daemon_ctl pause"` then `ssh ... "$daemon_ctl status --json"`
  - Check pause exit code before querying status; report failure clearly
  - Echo resulting state
  - Two separate commands (pause.md + resume.md) for discoverability. Each is
    <20 lines; minor duplication is acceptable for trivial commands.

- [ ] 2.5: Write `commands/symphony/resume.md`
  - Frontmatter: `model: haiku` (mirror of pause.md)
  - Mirror of pause.md with `resume` subcommand

- [ ] 2.6: Write `commands/symphony/logs.md`
  - Frontmatter: `model: haiku` (pure data retrieval)
  - Argument: issue ID (e.g., `ENG-123`)
  - Validate issue ID before SSH: `^[A-Z]{2,5}-[0-9]{1,6}$` (repo-standard Linear format)
  - SSH to daemon (with `ServerAliveInterval=60` for longer transfers):
    `timeout 30 ssh ... -o ServerAliveInterval=60 "$daemon_ctl logs ENG-123 --tail 100"`
  - Tail N lines directly (`tail` already handles short files safely)
  - If the daemon reports truncation metadata, surface a warning in the result
  - Fence output per Security Considerations
  - If no issue ID provided: AskUserQuestion

### Phase 3: Skill and Template

- [ ] 3.1: Write `skills/symphony-conventions/SKILL.md`
  - `user-invokable: false` (internal reference for commands)
  - SYMPHONY.md schema documentation (all fields, types, defaults, constraints)
  - SSH connection conventions (BatchMode, ConnectTimeout, fencing)
  - Daemon control protocol expectations (what the OpenClaw plugin should
    expose)
  - Error handling patterns (SSH failure, daemon down, parse errors)

- [ ] 3.2: Embed `SYMPHONY.md` starter template in `config.md` command
  - Replaces brainstorm's standalone `SYMPHONY.md.example` deliverable —
    embedding avoids introducing a `templates/` directory pattern that no
    existing plugin uses
  - The `config` command scaffolds `SYMPHONY.md` via `Write` tool when missing
  - Starter YAML front matter with all fields, sensible defaults, inline
    comments
  - Markdown prompt template section with placeholder variables using
    `{{ issue.title }}`, `{{ issue.description }}`, `{{ attempt }}` syntax
    (OpenClaw-side Liquid-style interpolation — this plugin scaffolds the
    template but does not perform interpolation itself)
  - Comments explaining each section

<!-- deepen-plan: external -->

> **Research:** Symphony hook lifecycle: `after_create` (workspace init) →
> `before_run` (pre-attempt, failure aborts run) → agent executes → `after_run`
> (post-attempt, failure logged) → `before_remove` (pre-deletion). Run phases:
> `PreparingWorkspace`, `BuildingPrompt`, `LaunchingAgentProcess`,
> `StreamingTurn`, `Succeeded`, `Failed`, `TimedOut`, `Stalled`. The template
> should document these phases so users understand status values.

<!-- /deepen-plan -->

### Phase 4: Quality

- [ ] 4.1: Run `pnpm validate:schemas` — verify plugin.json + agent authoring
- [ ] 4.2: Test `/symphony:setup` manually (will fail SSH since no daemon yet —
      that's expected)
- [ ] 4.3: Test `/symphony:config` with the example template copied to repo root
- [ ] 4.4: Create changeset: `pnpm changeset` (minor — new plugin)

## Technical Specifications

### Files to Create

| File                                                           | Purpose                        |
| -------------------------------------------------------------- | ------------------------------ |
| `plugins/yellow-symphony/.claude-plugin/plugin.json`           | Plugin manifest                |
| `plugins/yellow-symphony/package.json`                         | Version source of truth        |
| `plugins/yellow-symphony/CLAUDE.md`                            | Architecture + conventions     |
| `plugins/yellow-symphony/commands/symphony/setup.md`           | SSH + daemon validation wizard |
| `plugins/yellow-symphony/commands/symphony/status.md`          | Query daemon state             |
| `plugins/yellow-symphony/commands/symphony/config.md`          | Validate/edit SYMPHONY.md      |
| `plugins/yellow-symphony/commands/symphony/pause.md`           | Pause daemon polling           |
| `plugins/yellow-symphony/commands/symphony/resume.md`          | Resume daemon polling          |
| `plugins/yellow-symphony/commands/symphony/logs.md`            | Tail issue run logs            |
| `plugins/yellow-symphony/CHANGELOG.md`                         | Auto-generated by Changesets   |
| `plugins/yellow-symphony/README.md`                            | Plugin overview + usage        |
| `plugins/yellow-symphony/skills/symphony-conventions/SKILL.md` | Schema + pattern reference     |

### Files to Modify

| File                                        | Change                                           |
| ------------------------------------------- | ------------------------------------------------ |
| `.claude-plugin/marketplace.json`           | Add yellow-symphony entry                        |
| `plugins/yellow-core/commands/setup/all.md` | Add setup command mapping and inventory coverage |

### Patterns to Reuse

| Pattern                       | Source                                              |
| ----------------------------- | --------------------------------------------------- |
| SSH connection flags          | `yellow-ci/commands/ci/runner-health.md:47-66`      |
| `.local.md` config storage    | `yellow-ci/CLAUDE.md:99-113`                        |
| Setup wizard flow             | `yellow-ci/commands/ci/setup.md`                    |
| Status table + `model: haiku` | `yellow-ci/commands/ci/status.md`                   |
| Output fencing                | `plugins/yellow-semgrep/commands/semgrep/status.md` |
| Prereq-before-prompt          | `gt-workflow/commands/gt-setup.md`                  |

## Acceptance Criteria

1. `pnpm validate:schemas` passes with yellow-symphony included
2. `/symphony:setup` creates `.claude/yellow-symphony.local.md` via interactive
   wizard
3. `/symphony:status` shows clear error when daemon is unreachable (not a crash)
4. `/symphony:config` validates a SYMPHONY.md and reports field-level errors
5. `/symphony:pause` and `/symphony:resume` echo resulting state after action
6. `/symphony:logs ENG-123` shows fenced, truncation-aware output
7. `/symphony:config` scaffolds a valid, self-documenting `SYMPHONY.md` when missing

## Assumptions

- **SSH + CLI transport**: The plan assumes the OpenClaw daemon exposes CLI
  subcommands (`status --json`, `pause`, `resume`, `logs <id>`) accessible via
  SSH. This resolves brainstorm Open Questions #1 and #2. If OpenClaw later
  exposes an HTTP API, the command files would need rewriting (replacing
  `ssh ...` with `curl ...`). The `daemon_ctl` config value is a shell command
  prefix, not a transport abstraction — switching transport is a non-trivial
  change. This is acceptable for MVP per YAGNI.
- **SYMPHONY.md schema is stable enough for MVP**: A subset of Symphony SPEC.md
  fields is sufficient. Full schema will be refined during OpenClaw plugin
  development (brainstorm Open Question #3).

## Security Considerations

- **SSH key management**: `.claude/yellow-symphony.local.md` stores the SSH key
  path (not the key itself). The setup wizard validates the key file exists and
  has correct permissions (`600`/`400`). Key content is never logged or displayed.
- **Command injection via daemon_ctl**: The `daemon_ctl` config value is used in
  SSH remote commands. The setup wizard must validate it against an allowlist
  regex: `^[a-z][a-z0-9 _/-]{0,63}$` (lowercase alphanumeric, spaces, hyphens,
  underscores, forward slashes — aligned with
  `docs/solutions/security-issues/ssh-daemon-command-dispatch-security-patterns.md`).
  Commands use double-quoted `"$daemon_ctl ..."` to preserve word boundaries
  (not `eval`); the config value is passed as a single quoted SSH remote command
  string and the remote shell handles word splitting. Each subcommand (pause,
  status, etc.) is passed as a separate SSH call rather than chained with `&&`
  in a single remote command string, reducing the injection surface.
- **Prompt injection**: Issue descriptions from Linear may contain adversarial
  content. Fencing requirements are documented in `symphony-conventions` skill.
  Enforcement is the OpenClaw plugin's responsibility, not this plugin's.
- **Shell authoring pitfalls**: Commands must handle tilde expansion in config
  paths (`ssh_key="${ssh_key/#\~/$HOME}"`) and split `local` from command
  substitution per
  `docs/solutions/security-issues/shell-binary-downloader-security-patterns.md`.
- **Config file exposure**: `.claude/yellow-symphony.local.md` contains SSH
  host, user, and key path. The repo root `.gitignore` already excludes
  `.claude/`, covering this file. For repos that track `.claude/`, the setup
  wizard should warn: "Add `.claude/*.local.md` to `.gitignore`."
- **Output fencing**: All daemon output (including logs that may contain
  attacker-controlled Linear issue content) is wrapped in `--- begin/end ---`
  fences with `(reference only)` advisory before LLM reasoning. Fencing wraps
  the entire raw SSH stdout; individual fields must not be extracted and
  displayed outside the fence.

## Edge Cases

- **No `.claude/yellow-symphony.local.md`**: All commands except setup redirect
  to `/symphony:setup`
- **SSH key not found**: setup wizard validates key path exists before writing
  config
- **Daemon not installed on remote**: setup detects and reports with install
  instructions
- **No SYMPHONY.md in repo**: `/symphony:config` offers to scaffold from
  template
- **Daemon returns non-JSON**: status command handles gracefully with raw output
  fallback
- **Host key changed (VM rebuild)**: SSH refuses connection with MITM warning;
  setup command detects this error and advises `ssh-keygen -R <host>`
- **Network timeout mid-command**: 3s ConnectTimeout prevents hanging; clear
  error message

<!-- deepen-plan: external -->

> **Research:** SSH CLI tools should assume plain text from remote and parse
> client-side. Capture stderr separately (`2>stderr.tmp`). Retry once on parse
> failure with verbose logging. Support degraded mode: warn on optional checks,
> fail only on critical path items.

<!-- /deepen-plan -->

## Dependencies

- **Hard:** `ssh` binary
- **Soft:** `jq` (for JSON parsing of daemon output)
- **Cross-plugin:** yellow-linear (optional — enriches status with issue titles)
- **External:** OpenClaw symphony plugin exposing `status --json`, `pause`,
  `resume`, `logs <id>` subcommands

## Deferred (not in this plan)

- Agent definitions (no agents needed — this is a management plugin, not a
  runner)
- Hooks (no automated triggers)
- MCP servers (no external services to wrap)
- Dashboard/web UI
- Multi-host support (single daemon target for now)
- Auto-review integration with yellow-review (Phase 3 in brainstorm, separate
  plan)

## References

- [Brainstorm](../docs/brainstorms/2026-04-01-symphony-plugin-brainstorm.md)
- [Symphony SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)
- [Symphony elixir/WORKFLOW.md](https://github.com/openai/symphony/blob/main/elixir/WORKFLOW.md)
- [yellow-ci runner-health (SSH pattern)](../plugins/yellow-ci/commands/ci/runner-health.md)
- [yellow-ci setup (wizard pattern)](../plugins/yellow-ci/commands/ci/setup.md)
- [yellow-ci .local.md config](../plugins/yellow-ci/CLAUDE.md)
- [yellow-semgrep output fencing](../plugins/yellow-semgrep/commands/semgrep/status.md)
- [gt-workflow setup (prereq pattern)](../plugins/gt-workflow/commands/gt-setup.md)

<!-- deepen-plan: external -->

> **Research:** Additional external references:
>
> - [AJV JSON Schema validation](https://ajv.js.org/guide/environments.html) —
>   runtime YAML validation
> - [SSH timeout best practices](https://www.tecmint.com/increase-ssh-connection-timeout/)
>   — ServerAliveInterval patterns
> - [Docker context pattern](https://docs.docker.com/engine/manage-resources/contexts/)
>   — remote daemon management via CLI

<!-- /deepen-plan -->
