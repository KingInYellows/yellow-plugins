# Feature: yellow-rtk Plugin (Phase 1 of context-management strategy)

## Overview

Build a thin wrapper plugin around the [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) CLI binary. RTK compresses the output of shell commands (git, cat, ls, test runners, linters) by 60–99% via a PreToolUse hook installed in Claude Code's settings.json. This plugin owns three commands (`/rtk:setup`, `/rtk:gain`, `/rtk:discover`) and one SessionStart hook — RTK itself owns the PreToolUse hook.

This is Phase 1 of a layered strategy. Phase 2 (sigmap evaluation) is gated on measured RTK savings. See `docs/brainstorms/2026-05-08-sigmap-integration-shapes-brainstorm.md`.

## Problem Statement

### Current Pain

Context-length pressure on large-codebase Claude Code sessions, observed in two scenarios:
- **Targeted-fix tasks:** Claude reads 5–15 adjacent files to understand context even when the fix is local. Every file read is full-size.
- **Cold-start on unfamiliar codebases:** Before yellow-ruvector accumulates session history, Claude issues many exploratory `ls`, `cat`, `grep`, `git log` calls — each at full size.

### User Impact

Sessions on repos with 50K+ LOC hit context limits. Prompts get truncated. Token spend is high for low-value command output (e.g., a `git log --stat` that consumes 2K tokens for 30 lines of useful information).

### Why RTK and not sigmap

Comparative research (`docs/research/rtk-vs-sigmap-context-management-comparison.md`) found:
- RTK has **zero overlap** with the existing yellow-plugins context stack (yellow-ruvector, yellow-mempalace, yellow-research, yellow-core auto-memory).
- RTK activates **automatically on every command** via PreToolUse hook — no MCP tool invocation needed; helps cold-start from session prompt one.
- RTK has **3+ named contributors (per README, not independently verified against commit history), Homebrew formula, Discord** — lower bus-factor than sigmap (single maintainer, 181 stars).
- RTK provides **measurable ROI** via `rtk gain` SQLite dashboard — falsifiable in 7 days.

## Proposed Solution

### High-Level Architecture

```text
┌─────────────────────────────────────────────┐
│  yellow-rtk plugin (this repo)              │
│  ─────────────────────────────────────────  │
│  • /rtk:setup → runs `rtk init --hook-only` │
│                  + writes RTK_TELEMETRY=0   │
│                  into settings.json hook    │
│  • /rtk:gain  → runs `rtk gain` (dashboard) │
│  • /rtk:discover → runs `rtk discover`      │
│  • SessionStart hook → probes binary +      │
│                        version, warn-only   │
└──────────────────┬──────────────────────────┘
                   │ owns nothing in settings.json
                   ▼
┌─────────────────────────────────────────────┐
│  RTK CLI (external, brew/cargo installed)   │
│  ─────────────────────────────────────────  │
│  • rtk binary (Rust, single binary)         │
│  • PreToolUse hook in ~/.claude/settings.   │
│    json (installed by `rtk init`,           │
│    user-owned after install)                │
└─────────────────────────────────────────────┘
```

### Key Design Decisions

1. **RTK's PreToolUse hook is user-owned, not plugin-owned.** Plugin uninstall does NOT remove the RTK hook from `settings.json`. This is documented; no `/rtk:teardown` command is built.

<!-- deepen-plan: external -->
> **Research:** RTK ships `rtk init --uninstall` which backs up `settings.json`, removes the hook, and runs an atomic write (see `src/hooks/init.rs` `uninstall()` fn). A thin `/rtk:teardown` command could delegate to this directly — reconsider building it as a stretch goal for clean uninstall, since the orphan-hook concern in the brainstorm is solvable with one CLI call.
> Source: [`src/hooks/init.rs`](https://github.com/rtk-ai/rtk/blob/master/src/hooks/init.rs)
<!-- /deepen-plan -->
2. **`--hook-only` is unconditional.** `/rtk:setup` always passes `--hook-only` to `rtk init`. The 134-line CLAUDE.md awareness block is never written by the plugin (collision risk with yellow-core auto-memory).
3. **Telemetry opt-out by default.** `RTK_TELEMETRY=0` is written into the RTK hook entry's `env` block in `~/.claude/settings.json` via `jq`. AskUserQuestion offers opt-in but defaults to disabled.
4. **No MCP server.** RTK is a CLI tool, not an MCP server.
5. **No agents, no skills (Phase 1).** Three commands plus one SessionStart hook is the entire surface.

### Trade-offs Considered

- **Embed RTK setup into yellow-ruvector vs. separate plugin** — chose separate plugin for clean install/uninstall and to keep yellow-ruvector dense surface from growing further.
- **SessionStart hook with version check vs. setup-only check** — chose hook because version drift is a real concern (RTK at v0.38.0 moves fast, hook format may change between minor versions). The hook is warn-only (always exits `{"continue": true}`).
- **Validate `rtk_binary_path` userConfig at setup time vs. runtime** — chose runtime (in setup command + hook), because Claude Code's remote validator rejects `userConfig.pattern` (reverted 2026-05-08; see Technical Specifications callout) and ships only `type: "string"` for the entry.

## Implementation Plan

### Phase 1: Plugin Scaffolding

- [ ] 1.1: Create `plugins/yellow-rtk/` directory tree
- [ ] 1.2: Author `plugins/yellow-rtk/.claude-plugin/plugin.json` with hooks, userConfig, no MCP
- [ ] 1.3: Author `plugins/yellow-rtk/package.json` (version `0.1.0`, private, name `yellow-rtk`)
- [ ] 1.4: Author `plugins/yellow-rtk/CHANGELOG.md` with `## [0.1.0]` initial entry
- [ ] 1.5: Author `plugins/yellow-rtk/CLAUDE.md` (plugin conventions, RTK-specific rules: never bare `rtk init`; never declare PreToolUse in plugin.json; document orphan-on-uninstall)
- [ ] 1.6: Author `plugins/yellow-rtk/README.md` (user-facing install + setup instructions, both Homebrew and cargo install paths)

### Phase 2: SessionStart Hook

- [ ] 2.1: Author `plugins/yellow-rtk/hooks/scripts/session-start.sh`
  - Use `set -uo pipefail` (no `-e`)
  - Define `json_exit()` helper at top — use **yellow-ci variant** specifically: emit `systemMessage` via `jq -n` when jq is available (yellow-rtk needs systemMessage for "rtk-not-found" and "version-too-old" warnings; yellow-ruvector's variant only outputs `{"continue": true}` and is NOT a suitable template for this hook)
  - `command -v jq` guard
  - `command -v rtk` probe; if missing, `json_exit "rtk binary not found. Run /rtk:setup."`
  - `MIN_RTK_VERSION="0.38.0"` constant
  - Parse `rtk --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1`
  - `version_gte()` pure-bash helper (mirror yellow-codex pattern)
  - Check PreToolUse hook presence via `jq 'select(.command == "rtk hook claude")'` over `hooks.PreToolUse[*].hooks[*]` on `~/.claude/settings.json` — match on `command` only (not full structural equality), since `/rtk:setup` Step 5 adds an `env` block to the entry. A structural-equality check would miss properly-configured hooks and produce a "hook not found" warning every session. Fail-closed on jq parse error.
  - Always `json_exit` on every path

<!-- deepen-plan: external -->
> **Research:** Canonical version flag is `--version` only — `-V` is NOT registered in RTK's clap setup. Output format is the bare `rtk X.Y.Z`; strip the `rtk ` prefix with `${RTK_VERSION_RAW#rtk }` before comparison.
> The exact hook entry shape RTK writes (use this for the presence check): `{"matcher": "Bash", "hooks": [{"type": "command", "command": "rtk hook claude"}]}` — NO `timeout`, NO `env` block in the Claude variant. Match on `command == "rtk hook claude"` inside `hooks.PreToolUse[*]` where `matcher == "Bash"`.
> Source: [`src/main.rs`](https://github.com/rtk-ai/rtk/blob/master/src/main.rs), [`src/hooks/init.rs:840`](https://github.com/rtk-ai/rtk/blob/master/src/hooks/init.rs), [`src/hooks/constants.rs`](https://github.com/rtk-ai/rtk/blob/master/src/hooks/constants.rs) (`CLAUDE_HOOK_COMMAND = "rtk hook claude"`)
<!-- /deepen-plan -->
- [ ] 2.2: Strip CRLF: `sed -i 's/\r$//' plugins/yellow-rtk/hooks/scripts/session-start.sh`

> **Note (2026-05-08):** Earlier drafts of this plan included an extra step to author a `hooks/hooks.json` reference-only file. That step is intentionally **dropped**: the file would carry a maintenance burden (timeout-drift risk against `plugin.json`) for zero functional value — Claude Code reads inline `hooks` from `plugin.json`, not from a sibling `hooks.json`. The single source of truth is `plugin.json`.

### Phase 3: `/rtk:setup` Command

- [ ] 3.1: Author `plugins/yellow-rtk/commands/rtk/setup.md`
  - Frontmatter: `name: rtk:setup`, single-line description with "Use when...", `argument-hint: ''`, `allowed-tools: [Bash, AskUserQuestion]`
  - Step 0 — Prerequisite check:
    - `command -v rtk` — if missing, AskUserQuestion: "Install rtk now? (Yes / No, install manually)". On Yes, branch by platform (`uname`) — Homebrew on macOS+Linuxbrew, `cargo install rtk` elsewhere
    - Version check via `version_gte` (re-defined in this Bash block — functions don't survive subshells)
    - If version < 0.38.0, AskUserQuestion: "Upgrade rtk to >= 0.38.0?"
  - Step 1 — Run `rtk init --hook-only`:
    - Capture exit code; fail clearly on non-zero
    - Detect yellow-core auto-memory marker in CLAUDE.md before run; warn if found (informational only, since `--hook-only` already protects)
  - Step 2 — Verify hook installed:
    - `jq '.hooks.PreToolUse[]?.hooks[]? | select(.command | test("rtk")) | .command' ~/.claude/settings.json`
    - Empty result means RTK init didn't write hook; abort with clear error
  - Step 3 — Idempotency guard:
    - Count existing RTK hook entries; if > 1, warn user about duplicates and offer to clean up via jq

<!-- deepen-plan: external -->
> **Research:** `rtk init --hook-only` is **fully idempotent**. The `hook_already_present()` guard at [`src/hooks/init.rs:727`](https://github.com/rtk-ai/rtk/blob/master/src/hooks/init.rs) scans `hooks.PreToolUse[*].hooks[*].command` and returns `PatchResult::AlreadyPresent` without writing if found. Running twice never appends a duplicate.
> **Plan implication:** Step 3 should simplify to a sanity check — warn only if multiple RTK entries somehow exist (e.g., user manually edited settings.json); no jq dedupe write is needed under normal operation.
<!-- /deepen-plan -->
  - Step 4 — Telemetry choice via AskUserQuestion:
    - Question: "RTK collects opt-out usage telemetry to rtk-ai.app. How do you want to proceed?"
    - Options: "Keep disabled (recommended)" / "Enable telemetry"
  - Step 5 — Write `RTK_TELEMETRY=0` (or omit on enable) to hook entry's `env`:
    - Atomic write using `mktemp` (consistent with the deepen-plan annotation below) and a precise jq selector that targets only the RTK Bash-matcher hook:
      ```bash
      tmp=$(mktemp ~/.claude/settings.json.tmp.XXXXXX) \
        && jq --arg val "0" '
            (.hooks.PreToolUse[]
              | select(.matcher == "Bash").hooks[]
              | select(.command == "rtk hook claude")
              | .env.RTK_TELEMETRY) = $val
          ' ~/.claude/settings.json > "$tmp" \
        && chmod --reference=~/.claude/settings.json "$tmp" \
        && mv "$tmp" ~/.claude/settings.json
      ```
    - The jq selector matches `.hooks.PreToolUse[].hooks[]` filtered by `.matcher == "Bash"` AND `.command == "rtk hook claude"` — so unrelated PreToolUse entries (yellow-ruvector's `Edit|Write|MultiEdit|Bash` hook, user-installed hooks) are untouched.
    - `mktemp ~/.claude/settings.json.tmp.XXXXXX` is preferred over the bare `$$` PID suffix: avoids collision races, picks a fresh `XXXXXX`-randomised name on each run, and (`mktemp -p ~/.claude/` may also be used on Linux for explicit dir control).
    - Use `jq --arg` for the value (never string interpolation).
    - `chmod --reference=...` (Linux) or `chmod $(stat -f '%Mp%Lp' ~/.claude/settings.json) "$tmp"` (macOS) **before** `mv` — see Security Considerations for the platform-specific syntax.
    - On jq parse failure of settings.json: fail-closed, do NOT silently continue.

<!-- deepen-plan: codebase -->
> **Codebase:** The only existing precedent for atomic settings.json mutation is `plugins/yellow-core/commands/statusline/setup.md:446-481` (Python: `tmp = path + '.tmp'`, `json.dump`, re-read to validate, `os.replace`). It only mutates a top-level key; yellow-rtk does **nested-key surgery** (`hooks[N].env.RTK_TELEMETRY`), which has no in-repo precedent. Extend the statusline pattern, don't invent a new one. No `flock` usage exists anywhere in the codebase for `~/.claude/`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `mv`/`rename(2)` does **not** preserve permissions — the destination path takes the temp file's inode, with `umask`-based permissions (typically 0600 for `mktemp`). If `~/.claude/settings.json` was 0644, a naive `mv` produces 0600. Required: `chmod --reference=settings.json "$tmp"` (Linux) or `chmod $(stat -f '%Mp%Lp' settings.json) "$tmp"` (macOS) before `mv`. RTK's own Rust implementation does NOT preserve permissions either — settings.json may already be 0600 after `rtk init`, so capture the mode immediately before mutating.
> Source: GitHub code search across DataDog, nginx-proxy-manager, RTK source — `mktemp` + `chmod --reference` + `mv` is the dominant production pattern.
<!-- /deepen-plan -->
  - Step 6 — Final verification:
    - Read settings.json again; confirm RTK hook entry has `env.RTK_TELEMETRY = "0"` (when disabled chosen)
  - Step 7 — Print success summary with reversibility note: "To re-enable telemetry: edit `~/.claude/settings.json` RTK hook env block. To remove RTK entirely: edit settings.json and delete the rtk-rewrite PreToolUse hook entry (uninstalling yellow-rtk does NOT remove this)."

### Phase 4: `/rtk:gain` Command

- [ ] 4.1: Author `plugins/yellow-rtk/commands/rtk/gain.md`
  - Frontmatter: `name: rtk:gain`, single-line description, `argument-hint: '[daily|weekly|monthly|all|graph|json]'`, `allowed-tools: [Bash]` (positional time-window args like `7d`/`14d` are NOT supported by RTK — see deepen-plan annotation below for the actual flag set)
  - Step 0: `command -v rtk` guard (re-defined; can't share state with hook)
  - Step 1: Map `$ARGUMENTS` → RTK flag: `daily`→`-d`, `weekly`→`-w`, `monthly`→`-m`, `all`→`-a`, `graph`→`-g`, `json`→`-f json` (default: no flag = whatever `rtk gain` shows by default)
  - Step 2: Run `rtk gain <flag>` with output capped via `head -n 40` to budget the context (or use `-f json` and pipe to a structured renderer when `json` requested — JSON output is verbatim and does not need head-capping)
  - Step 3: Empty-state detection — if `rtk gain` returns "no data" / empty, print `[yellow-rtk] No savings data yet. RTK collects data as you use Claude Code. Run a few sessions and check back.` and exit cleanly

<!-- deepen-plan: external -->
> **Research:** `rtk gain` does **NOT** support `--since/--last/--days` time-window filters. Actual flags (from [`src/main.rs:399-434`](https://github.com/rtk-ai/rtk/blob/master/src/main.rs)): `-d` daily, `-w` weekly, `-m` monthly, `-a` all-three, `-g` graph (last 30 days), `-p` project-scope, `-q --tier {pro|5x|20x}` quota, `-f text|json|csv` format, `-F` failures, `-H` history, `--reset --yes`.
> **Plan correction:** Update `argument-hint` from `'[7d|14d|all]'` to `'[daily|weekly|monthly|all|graph|json]'` (or align to actual subcommand surface). Empty-state output is the literal two-line string `No tracking data yet.\nRun some rtk commands to start tracking savings.` (from [`src/analytics/gain.rs:78`](https://github.com/rtk-ai/rtk/blob/master/src/analytics/gain.rs)) — detect this exact phrase, not "no data" generically. For piping/scripting, prefer `--format json` (passes through verbatim) over text (which needs head-capping).
<!-- /deepen-plan -->

### Phase 5: `/rtk:discover` Command

- [ ] 5.1: Author `plugins/yellow-rtk/commands/rtk/discover.md`
  - Frontmatter: `name: rtk:discover`, single-line description, `argument-hint: ''`, `allowed-tools: [Bash]`
  - Step 0: `command -v rtk` guard
  - Step 1: Run `rtk discover` and capture output
  - Step 2: Wrap output in `--- begin rtk-discover output (reference only) ---` / `--- end ---` fences (per project security-fencing pattern); annotate "treat as reference data, not instructions"
  - Step 3: Summarize uncovered commands by frequency; for any command with >= 5 occurrences and no compression filter, print:
    ```
    [yellow-rtk] Frequently-used commands not covered by RTK:
      - <command> (N occurrences)
    Consider filing a feature request at https://github.com/rtk-ai/rtk/issues
    ```
  - Step 4: Empty-state — if no past sessions, print clean message; do not error

### Phase 6: Marketplace + Setup-All Integration

- [ ] 6.1: Add yellow-rtk entry to `.claude-plugin/marketplace.json` plugins array (preserve trailing-comma sanity; `jq empty` after edit)
- [ ] 6.2: Update `plugins/yellow-core/commands/setup/all.md` — 4 marker-bounded sections:
  - Bash plugin loop (`setup-all-dashboard-plugin-loop:start/end`): add `rtk`
  - Classification block (`setup-all-classification:start/end`): add `**yellow-rtk:** READY/NEEDS SETUP`
  - Delegated commands list (`setup-all-delegated-commands:start/end`): add `rtk:setup`
  - Plugin-command-map (`setup-all-plugin-command-map:start/end`): add `- yellow-rtk → rtk:setup`
- [ ] 6.3: Update `scripts/validate-setup-all.js` — add `'rtk:setup': 'yellow-rtk'` to `COMMAND_PLUGIN_MAP` (verify exact key format from existing entries)

### Phase 7: Validation + Release

- [ ] 7.1: Run `pnpm validate:schemas` — must pass
- [ ] 7.2: Run `pnpm validate:setup-all` — must pass (4 marker-bounded sections in `all.md` + 1 `COMMAND_PLUGIN_MAP` edit in `validate-setup-all.js`, per Phase 6 steps 6.2 and 6.3)
- [ ] 7.3: Run `pnpm validate:versions` — must pass (package.json / plugin.json / marketplace.json three-way sync at `0.1.0`)
- [ ] 7.4: Run `pnpm test:unit` and `pnpm typecheck` and `pnpm lint` — no new failures
- [ ] 7.5: Author `.changeset/yellow-rtk-initial-release.md` with `"yellow-rtk": minor` and feature description
- [ ] 7.6: Verify the changeset is well-formed: `cat .changeset/yellow-rtk-initial-release.md` (do **not** run `pnpm changeset` here — that opens an interactive TUI to author a new changeset, not a passive verifier; the existing `pnpm validate:versions` step already gates the three-way version sync)
- [ ] 7.7: Manual smoke test on a machine with RTK installed: run `/rtk:setup`, `/rtk:gain`, `/rtk:discover`; verify SessionStart hook completes within 3s and outputs `{"continue": true}`
- [ ] 7.8: Manual install test on a clean Claude Code instance: `/plugin marketplace add` and verify yellow-rtk appears (per project memory: local CI ≠ remote validation)

## Technical Specifications

### Files to Create

```text
plugins/yellow-rtk/
├── .claude-plugin/
│   └── plugin.json                  # manifest (hooks, userConfig, no MCP)
├── CHANGELOG.md                     # starts at [0.1.0]
├── CLAUDE.md                        # plugin conventions, RTK rules
├── README.md                        # user-facing docs
├── commands/
│   └── rtk/
│       ├── setup.md                 # /rtk:setup
│       ├── gain.md                  # /rtk:gain
│       └── discover.md              # /rtk:discover
├── hooks/
│   └── scripts/
│       └── session-start.sh         # binary + version probe (hooks live in plugin.json — no hooks.json file)
└── package.json                     # version 0.1.0, private
.changeset/
└── yellow-rtk-initial-release.md    # changeset
```

### Files to Modify

- `.claude-plugin/marketplace.json` — append yellow-rtk entry
- `plugins/yellow-core/commands/setup/all.md` — 4 marker-bounded edits
- `scripts/validate-setup-all.js` — add `COMMAND_PLUGIN_MAP` entry

### plugin.json Sketch

```json
{
  "name": "yellow-rtk",
  "version": "0.1.0",
  "description": "Token-efficient Claude Code sessions via RTK command-output compression",
  "author": { "name": "KingInYellows", "url": "https://github.com/KingInYellows" },
  "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-rtk",
  "repository": "https://github.com/KingInYellows/yellow-plugins",
  "license": "MIT",
  "keywords": ["token-compression", "context-management", "rtk", "performance"],
  "userConfig": {
    "rtk_binary_path": {
      "type": "string",
      "title": "RTK binary path",
      "description": "Path to the rtk binary. Leave empty to use rtk from PATH.",
      "required": false
    }
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

<!-- deepen-plan: codebase -->
> **Codebase — `userConfig.rtk_binary_path` typing:** Zero in-repo plugins use `type: "file"` for userConfig. The local schema (`schemas/plugin.schema.json`) permits it via the `type` enum, but Claude Code's **remote** validator support is empirically untested.
>
> **`pattern` field is NOT an option.** Per `MEMORY.md` (revert dated 2026-05-08): `userConfig.pattern` was added in PR #409, then **REVERTED** because the Claude Code remote validator emits `Unrecognized key: "pattern"` on install. The official manifest schema permits only `{type, title, description, sensitive, required, default, multiple, min, max}`. Any local validator support for `pattern` (e.g., `validate-plugin.js` RULE 10 if still present on this branch) is stale and will be removed.
>
> **v0.1.0 ships `type: "string"` with NO `pattern` field.** Validation lives at runtime: `/rtk:setup` and the SessionStart hook check `[ -f "$path" ] && [ -x "$path" ]` (resolving symlinks via `realpath`) before invoking the binary. Revisit `type: "file"` only after the remote validator behavior is empirically confirmed against another plugin.
<!-- /deepen-plan -->

### Marketplace Entry

```json
{
  "name": "yellow-rtk",
  "description": "Token-efficient Claude Code sessions via RTK command-output compression",
  "version": "0.1.0",
  "author": { "name": "KingInYellows" },
  "source": "./plugins/yellow-rtk",
  "category": "development"
}
```

### Dependencies

External (user installs):
- `rtk` binary >= 0.38.0 (Homebrew: `brew install rtk` / cargo: `cargo install rtk`)
- `jq` (already required by other plugins in the marketplace)
- `bash` 4.0+. **macOS caveat:** macOS ships with bash 3.2 by default (last GPLv2 version). Either (a) `brew install bash` and document this as a prereq alongside `brew install rtk`, or (b) audit `session-start.sh` and `version_gte()` to use only POSIX sh features and switch the shebang to `/bin/sh`. Decide during Phase 2 implementation; the README must be explicit about which path was taken.

Repo-internal (no new deps): standard `pnpm` workspace install covers all schema validation.

## Testing Strategy

### Unit Test Approach

This plugin is primarily shell scripts and markdown commands; existing yellow-plugins repo does not have a bats test framework wired for new plugins by default. Skip bats unit tests for v0.1.0 — match yellow-ruvector's approach. If bats tests prove necessary later, follow `plugins/yellow-ruvector/tests/` shape.

### Integration Test Scenarios (manual smoke)

1. Fresh machine, RTK not installed: `/rtk:setup` → AskUserQuestion offers install → user accepts → Homebrew install runs → setup proceeds. Verify hook entry in `~/.claude/settings.json`.
2. Fresh machine, RTK installed but no setup run: SessionStart hook fires → emits warning systemMessage about missing PreToolUse entry → session continues normally.
3. Setup run twice: `/rtk:setup` → `/rtk:setup` again. Verify no duplicate hook entries in `settings.json`.
4. Telemetry choice: `/rtk:setup` → choose Disabled. Verify `env.RTK_TELEMETRY = "0"` in hook entry. Re-run setup → choose Enabled. Verify env block updated.
5. RTK version below minimum: install RTK at 0.30.0 → SessionStart probe warns. `/rtk:setup` offers upgrade.
6. Empty-state `/rtk:gain`: fresh RTK with no recorded sessions → command prints clean "no data yet" message, no error.
7. Empty-state `/rtk:discover`: fresh install → command exits cleanly.
8. Concurrent `/rtk:setup` from two sessions: only one wins; the other detects the existing entry and skips. (Manual race test; not strictly required.)

### Manual Testing Checklist

- [ ] `pnpm validate:schemas` passes
- [ ] `pnpm validate:setup-all` passes
- [ ] `pnpm validate:versions` passes
- [ ] `pnpm typecheck && pnpm lint && pnpm test:unit` pass
- [ ] `/rtk:setup` end-to-end on RTK >= 0.38.0
- [ ] `/rtk:gain` runs without error (empty or populated)
- [ ] `/rtk:discover` output is fenced before summarization
- [ ] SessionStart hook completes within 3s on WSL2 (the target dev environment)
- [ ] Plugin installs on a clean Claude Code instance via `/plugin marketplace add`

## Acceptance Criteria

1. **Plugin validates locally:** `pnpm validate:schemas`, `pnpm validate:setup-all`, `pnpm validate:versions` all pass
2. **Plugin installs remotely:** Manual test on a clean Claude Code install accepts the manifest (validates against remote schema; not just local CI)
3. **`/rtk:setup` is idempotent:** Running it twice produces a single `settings.json` hook entry; second run detects existing config and reports state without duplication
4. **`/rtk:setup` writes telemetry choice atomically:** Uses `tmp + mv` write pattern; `jq` parse failure on settings.json fails closed (does not silently continue)
5. **`/rtk:gain` handles empty state:** Fresh RTK with zero sessions returns a clean message, not an error
6. **`/rtk:discover` fences output:** All `rtk discover` stdout is wrapped in `--- begin/end ---` reference-only fences before any summarization
7. **SessionStart hook is non-blocking:** Always outputs `{"continue": true}` on every code path (including jq missing, rtk missing, version too old, settings.json malformed)
8. **No `set -e` in any hook script;** `set -uo pipefail` is the standard
9. **No CRLF in any `.sh` file** committed (post-Write `sed -i 's/\r$//'` is mandatory on WSL2)
10. **Documentation surfaces the orphan-on-uninstall caveat:** README and CLAUDE.md both note that uninstalling yellow-rtk does NOT remove the RTK PreToolUse hook from `settings.json`; manual cleanup steps are provided

## Edge Cases & Error Handling

| Edge case | Handling |
|---|---|
| RTK binary not on PATH | `/rtk:setup`: AskUserQuestion offers install. SessionStart hook: warn-only via `systemMessage`. |
| Multiple RTK binaries on PATH (Homebrew + cargo) | Resolve via `command -v rtk` (first wins). Document in README that `rtk_binary_path` userConfig overrides this. |
| RTK version below 0.38.0 | `/rtk:setup`: AskUserQuestion offers upgrade. SessionStart: warn-only. |
| `rtk init --hook-only` idempotency (resolved) | RTK is fully idempotent (`hook_already_present()` guard at `src/hooks/init.rs:727`). Step 3 of `/rtk:setup` is a sanity-check warning only — no automatic dedupe write needed under normal operation. The warning fires only if the user manually edited `settings.json` to create duplicate entries. |
| `~/.claude/settings.json` does not exist | Create empty `{"hooks": {}}` skeleton before `rtk init` runs (or rely on `rtk init` to create it; verify during implementation). |
| `~/.claude/settings.json` is malformed JSON | jq parse error → fail-closed, abort `/rtk:setup` with clear error message; do NOT overwrite. |
| Concurrent `/rtk:setup` from two sessions (resolved: not shipping flock) | `rename(2)` is atomic (readers see old or new, never partial); the real risk is read-modify-write TOCTOU. RTK's own `hook_already_present()` second-write guard catches this when the second reader runs after the first writer's rename. For a single-invocation user-initiated setup, `flock` is overkill — documented as defensive option but **not shipped in v0.1.0**. |

<!-- deepen-plan: external -->
> **Research — missing settings.json:** RTK itself handles this by creating `serde_json::json!({})` ([`src/hooks/init.rs:717-727`](https://github.com/rtk-ai/rtk/blob/master/src/hooks/init.rs)) — a fresh empty object, no error. The plugin's RTK_TELEMETRY injection step should mirror: `[ -f ~/.claude/settings.json ] || echo '{}' > ~/.claude/settings.json` before mutation.
> **Research — malformed JSON:** RTK propagates the parse error to the user (`with_context(|| "Failed to parse {} as JSON")`) — never auto-repairs. Plugin pattern: `jq empty ~/.claude/settings.json 2>/dev/null` preflight; on failure, print explicit error and exit 1. **Do NOT** auto-backup-and-recreate (that would silently lose user state — diverges from RTK's behavior).
> **Research — concurrent writes:** `rename(2)` is atomic on POSIX (readers see old or new, never partial). Real risk is read-modify-write TOCTOU: two concurrent reads return same content, two writes produce duplicate. RTK's `hook_already_present()` second-write guard catches this only if 2nd reader runs AFTER 1st writer's rename. For the plugin's single-invocation user-initiated setup, `flock` is overkill; document as defensive option but don't ship it in v0.1.0.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research — settings.json permissions:** `mv` (rename) does NOT preserve permissions. The `mktemp`-created temp file is typically `0600`; `~/.claude/settings.json` may be `0644`. Add `chmod --reference=settings.json "$tmp"` (Linux) or `chmod $(stat -f '%Mp%Lp' settings.json) "$tmp"` (macOS) before `mv`. RTK's own implementation does NOT preserve permissions either — capture the original mode immediately before mutating, since post-`rtk init` the file may already be 0600.
<!-- /deepen-plan -->
| User uninstalls yellow-rtk without manual settings.json cleanup | RTK hook persists in `settings.json` and continues to fire. Document in README with the explicit jq removal command (see Migration & Rollback). Optional: future `/rtk:teardown` if user demand justifies. |
| RTK upgrades and changes hook format | SessionStart probe checks version >= 0.38.0; if breaking change ships in a future version that's still >= 0.38.0, version-only check is insufficient. Out of scope for v0.1.0; revisit in version-bump changeset. |
| Non-Homebrew platform (Linux, Windows) | `/rtk:setup` install branch detects `uname`; offers `cargo install rtk` on Linux, direct download on Windows. |
| WSL2 cold-start exceeds 3s SessionStart timeout | Note this as a known risk in CLAUDE.md; if hit in practice, raise hook timeout to 5s. |
| `rtk_binary_path` userConfig points to non-executable | Validate `[ -x "$path" ]` in `/rtk:setup` and SessionStart probe; fall back to PATH lookup with warning. |
| `rtk_binary_path` is a symlink | Resolve via `realpath` and check the target is executable; warn if symlink points outside expected install locations. |

## Performance Considerations

- **SessionStart hook budget:** 3s timeout (matches yellow-ci convention). Operations: `command -v jq`, `command -v rtk`, `rtk --version` (single Rust binary cold-start), one `jq` read of settings.json. Each ~10–100ms. Aggregate well below 3s on warm filesystem; WSL2 cold-start could approach 1s on first session of a boot cycle. Note in CLAUDE.md.
- **`/rtk:setup` runtime:** Bounded by `rtk init` runtime (~2s on Rust binary) + jq writes (sub-second). Acceptable.
- **`/rtk:gain` runtime:** Bounded by `rtk gain` SQLite query (sub-second on small DBs); cap output at 40 lines to budget LLM context.
- **No hot-path overhead:** RTK's PreToolUse hook is owned by RTK, not yellow-rtk. yellow-rtk adds zero per-command overhead.

## Security Considerations

- **Telemetry is opt-out by default.** `RTK_TELEMETRY=0` is written into the hook entry's `env` block on Step 5 of `/rtk:setup`. User must explicitly choose "Enable telemetry" via AskUserQuestion to opt in.
- **Atomic settings.json write.** Use `jq '...' ~/.claude/settings.json > ~/.claude/settings.json.tmp.$$ && mv ~/.claude/settings.json.tmp.$$ ~/.claude/settings.json`. Temp file uses PID suffix to avoid collisions. **Permissions are NOT preserved by `mv` / `rename(2)`** — the destination inherits the temp file's `umask`-based mode (typically 0600 from `mktemp`). Apply `chmod --reference=settings.json "$tmp"` (Linux) or `chmod $(stat -f '%Mp%Lp' settings.json) "$tmp"` (macOS) **before** the `mv`. Capture the original mode immediately before any mutation, since RTK's own `rtk init` may have already set the file to 0600.
- **jq parse failure is fail-closed.** Per project memory: `EXIT_CODE="${exit_code:-0}"` defaults to success on parse error; this plugin uses `${exit_code:-1}` (fail-closed) and aborts with explicit error message rather than silently continuing.
- **No string interpolation into jq.** All settings.json values that depend on user input or env state pass through `jq --arg` (e.g., the telemetry choice).
- **userConfig path validation.** `rtk_binary_path` is a `type: "string"` userConfig (no `pattern` — see Technical Specifications callout for the remote-validator rationale). The `/rtk:setup` and SessionStart hook validate `[ -f "$path" ] && [ -x "$path" ]` before invoking it; symlinks resolved via `realpath`.
- **No shell injection in version parsing.** `rtk --version | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1` is safe; no eval, no command substitution into strings.
- **Heredoc delimiter style.** If any free-text user input is collected (none in v0.1.0), use `<<'__EOF_<CONTEXT>__'` style (per project memory on heredoc delimiter collision).
- **RTK output is treated as untrusted.** `/rtk:discover` wraps stdout in fences (`--- begin/end (reference only) ---`) before summarization, per security-fencing skill.

## Migration & Rollback

- **No migration concerns** — this is a brand-new plugin at v0.1.0; no users to migrate.
- **Rollback procedure:**
  1. Revert the merge commit (single `feat(yellow-rtk): initial release`)
  2. Users who installed yellow-rtk can `/plugin marketplace remove yellow-rtk` — but this leaves the RTK PreToolUse hook in their `settings.json`.
  3. **Manual hook removal (the README MUST surface this exact command):**
     ```bash
     jq 'del(.hooks.PreToolUse[]?.hooks[]? | select(.command == "rtk hook claude"))' \
        ~/.claude/settings.json > ~/.claude/settings.json.tmp.$$ \
        && mv ~/.claude/settings.json.tmp.$$ ~/.claude/settings.json
     ```
     (Apply `chmod --reference=settings.json "$tmp"` before `mv` per the Security Considerations.)
  4. Alternative: `rtk init --uninstall` (RTK ships its own clean-removal command that performs the same surgery atomically).
- **No breaking changes** — additive plugin only.

## References

### Source documents
- [Brainstorm: Sigmap Integration Shapes](../docs/brainstorms/2026-05-08-sigmap-integration-shapes-brainstorm.md) — Approach D section is the design source
- [Research: RTK vs sigmap comparison](../docs/research/rtk-vs-sigmap-context-management-comparison.md) — why RTK was chosen
- [Research: sigmap evaluation](../docs/research/sigmap-evaluation-for-yellow-plugins.md) — Phase 2 gating context

### Precedent plugins (templates)
- `plugins/yellow-ci/.claude-plugin/plugin.json` — SessionStart-only manifest shape
- `plugins/yellow-ci/hooks/scripts/session-start.sh` — `json_exit()` pattern with systemMessage variant
- `plugins/yellow-semgrep/commands/semgrep/setup.md` — gold-standard external CLI setup command
- `plugins/yellow-codex/commands/codex/setup.md` — minimal binary-probe + version_gte template
- `plugins/yellow-composio/.claude-plugin/plugin.json` — userConfig with `type: "string"`, `title`, `required: false` (closest match to `rtk_binary_path`'s shape; sensitive=false, no pattern)
- `plugins/yellow-morph/.claude-plugin/plugin.json:19-27` — secondary userConfig precedent (note: yellow-morph uses `sensitive: true`, which yellow-rtk does NOT)

### Validators
- `scripts/validate-versions.js` — three-way version sync enforcement
- `scripts/validate-setup-all.js` — `COMMAND_PLUGIN_MAP` (line ~20-39)
- `schemas/plugin.schema.json` — `userConfigEntry` definition (type enum, pattern field)

### Project memory (load-bearing rules)
- `set -e` must NOT be used in hooks that output JSON
- `json_exit()` helper pattern for centralized hook exits
- `SessionStart` hooks must output `{"continue": true}` on all error paths
- `userConfig` requires `type` and `title` fields (remote validator strict)
- All `.sh` files need CRLF stripping after Write tool on WSL2
- Local CI ≠ remote validation; manual install test is mandatory before release
- Functions don't survive between Bash tool calls — re-define helpers in each block
- Heredoc delimiter must be `<<'__EOF_<CONTEXT>__'` style for free-text user input
- AskUserQuestion's only free-text button is "Other"

### External
- [RTK upstream README](https://github.com/rtk-ai/rtk/blob/master/README.md)
- [RTK Claude Code hook docs](https://github.com/rtk-ai/rtk/blob/master/hooks/claude/README.md)
- [Homebrew formula](https://github.com/rtk-ai/rtk#install) (`brew install rtk`)

<!-- deepen-plan: external -->
> **Research — added by deepen-plan (RTK source, authoritative for v0.1.0 implementation):**
> - [`src/hooks/init.rs`](https://github.com/rtk-ai/rtk/blob/master/src/hooks/init.rs) — `hook_already_present()` idempotency guard (line 727), `patch_settings_json_command()`, `atomic_write()`, `uninstall()` fn, malformed-JSON propagation behavior
> - [`src/main.rs`](https://github.com/rtk-ai/rtk/blob/master/src/main.rs) — full flag catalog for `--version`, `--hook-only`, `--uninstall`, `Gain` subcommand
> - [`src/analytics/gain.rs`](https://github.com/rtk-ai/rtk/blob/master/src/analytics/gain.rs) — empty-state output (line 78), project-scope resolution
> - [`src/hooks/constants.rs`](https://github.com/rtk-ai/rtk/blob/master/src/hooks/constants.rs) — `CLAUDE_HOOK_COMMAND = "rtk hook claude"`
> - [`hooks/claude/rtk-rewrite.sh`](https://github.com/rtk-ai/rtk/blob/master/hooks/claude/rtk-rewrite.sh) — confirms version output format `rtk X.Y.Z`
> - [`Formula/rtk.rb`](https://github.com/rtk-ai/rtk/blob/master/Formula/rtk.rb) — Homebrew test asserts `rtk #{version}` output
> - [`docs/guide/analytics/gain.md`](https://github.com/rtk-ai/rtk/blob/master/docs/guide/analytics/gain.md) — flag reference, JSON/CSV schema examples
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase — added by deepen-plan (in-repo precedents):**
> - `plugins/yellow-core/commands/statusline/setup.md:446-481` — only existing precedent for atomic settings.json mutation (Python-based, `.tmp` + validate-via-re-read + `os.replace`). yellow-rtk's nested-key surgery extends this pattern.
> - `plugins/yellow-composio/.claude-plugin/plugin.json` — `type: "string"` precedent (note: any `pattern` field on this entry is being removed in the same review window — the remote validator rejects `userConfig.pattern`).
> - `schemas/plugin.schema.json` — `type` enum includes `"file"` (local-schema valid); empirically untested against Claude Code's remote validator.
> - `scripts/validate-plugin.js:940-950` — local validator's type-allowlist check; rejects unknown `type` values at line 948 with `must be one of: string, number, boolean, directory, file`. `'file'` is **accepted by membership** in `VALID_USER_CONFIG_TYPES`, not by an explicit accept-branch. Any `PATTERN_VALID_TYPES`-related code is stale and being removed alongside the userConfig.pattern revert.
<!-- /deepen-plan -->

## Open Questions (resolve during implementation)

Closed before implementation (rationale recorded for traceability):

- ~~**`rtk gain` time-window flag.**~~ Resolved: no `--since/--last/--days` exists; use `-d/-w/-m/-a/-g`. See Phase 4 annotation.
- ~~**`rtk init --hook-only` idempotency.**~~ Resolved: fully idempotent (`hook_already_present()` guard at `src/hooks/init.rs:727`). Step 3 is a sanity-check warning only.
- ~~**RTK version flag.**~~ Resolved: `--version` only (`-V` not registered). Output: `rtk X.Y.Z`. See Phase 2 annotation.
- ~~**`/rtk:teardown` command.**~~ Resolved: **not built in v0.1.0**. The brainstorm and Key Design Decisions both close on "no teardown." Manual cleanup is documented in the Migration & Rollback section with the exact jq command, plus a pointer to RTK's own `rtk init --uninstall`. Revisit only if user demand emerges.
- ~~**`type: "file"` vs `type: "string"` for `rtk_binary_path`.**~~ Resolved: ship `type: "string"` with **no `pattern` field** — runtime validation only. Rationale: `userConfig.pattern` was reverted 2026-05-08 (remote validator rejects it); `type: "file"` is empirically untested against the remote validator. Revisit `type: "file"` only after another plugin lands it successfully.
- ~~**`hooks/hooks.json` reference file.**~~ Resolved: **not authored**. Reference-only files create timeout-drift risk against `plugin.json` for zero functional gain. Hooks live only in `plugin.json`. See Phase 2.

Remaining open (resolve during implementation):

1. **Initial version pin: `0.1.0` vs another value.** Repo convention for new plugins: confirm by checking the most recently added plugin's first-tag version.
2. **Malformed-settings.json policy:** mirror RTK's fail-closed propagation, or follow yellow-core/statusline's `.corrupt.backup` rescue pattern? Recommend RTK alignment (fail-closed, no auto-repair) since the plugin operates against RTK's mental model — confirm before Phase 3 cuts.
