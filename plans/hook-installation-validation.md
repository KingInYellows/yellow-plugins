# Feature: Ensure Plugin Hooks Install and Work Correctly

Status: implemented in-repo. Phases 1-3 and automated validation are complete;
the remaining follow-up is manual `/ruvector:setup` verification.

## Problem Statement

Plugins in yellow-plugins declare hooks in `plugin.json`, and Claude Code reads
them at runtime. This plan addressed the missing validation and feedback around
hook behavior that previously caused confusion:

1. **ruvector setup previously used** `npx ruvector hooks verify`, which checks
   `.claude/settings.json` — the wrong place — and reported false negatives
2. **CI previously lacked validation** that hook scripts referenced in
   `plugin.json` exist, are readable, and stay aligned with `hooks.json`
3. **hooks.json drift previously existed** between `plugin.json` and
   `plugins/yellow-ruvector/hooks/hooks.json`
4. **Runtime dependency checks needed clarification** because 1-second hooks
   degrade without a global `ruvector` binary in `PATH`

<!-- deepen-plan: external -->
> **Research:** Claude Code v2.1+ auto-discovers `hooks/hooks.json` at the
> standard path by convention. The `hooks` field in `plugin.json` as a **string
> path** (e.g., `"hooks": "./hooks/hooks.json"`) causes a **duplicate hooks
> error**. However, inline hook objects in plugin.json (as used in this repo) are
> the primary mechanism. Known bugs: GitHub issues #16288 and #18547 report
> hooks.json not being loaded in some environments (Linux/WSL2, VS Code
> extension). The inline plugin.json approach used here is the most reliable.
> See: https://github.com/anthropics/claude-code/issues/16288
<!-- /deepen-plan -->

### Plugins with hooks (4 of 13)

| Plugin | Hooks | Setup command |
|---|---|---|
| gt-workflow | PreToolUse, PostToolUse | None |
| yellow-ci | SessionStart | `/ci:setup` |
| yellow-debt | SessionStart | None |
| yellow-ruvector | PreToolUse, UserPromptSubmit, SessionStart, PostToolUse, Stop | `/ruvector:setup` |

## Implemented Solution

Three complementary fixes, ordered by impact:

1. **Add hook validation to `validate-plugin.js`** (CI-time) — catch broken
   references before they ship
2. **Sync hooks.json files** (one-time fix) — eliminate current drift
3. **Fix setup commands** — give accurate hook status feedback and ensure
   runtime dependencies are met

<!-- deepen-plan: external -->
> **Research:** The validator should also check for the anti-pattern of declaring
> `"hooks": "./hooks/hooks.json"` as a string in plugin.json — this causes a
> duplicate hooks error in Claude Code v2.1+. The inline object format is
> correct. Additionally, hook event names should be validated against the 14
> known events: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest,
> UserPromptSubmit, Notification, Stop, SubagentStart, SubagentStop,
> SessionStart, SessionEnd, TeammateIdle, TaskCompleted, PreCompact.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: CI Hook Validation in validate-plugin.js

- [x] 1.1: Add hook validation rules to `scripts/validate-plugin.js`

  New checks to add after the existing RULE 5 (keywords):

  ```
  RULE 6: Hook script existence
  - Validate hook event names against the 14 known Claude Code events
  - For each hook entry in manifest.hooks, extract the script path
  - Parse ${CLAUDE_PLUGIN_ROOT} as relative to plugin dir
  - Verify the script file exists on disk
  - Verify the script is executable (mode & 0o111)
  - ERROR if script missing, WARNING if not executable

  RULE 7: hooks.json sync (if hooks.json exists)
  - Load hooks/hooks.json (skip if absent — it's optional)
  - Compare hook event names: plugin.json vs hooks.json
  - Compare matchers for each shared event
  - WARNING on any mismatch (plugin.json is authoritative in this repo;
    hooks.json is kept as a synced reference file)

  RULE 8: Hook script basics
  - Check each script starts with #!/bin/bash
  - For PreToolUse, PostToolUse, and Stop hooks, check for decision output
    (`{"continue": true}`, `{"decision": ...}`, or exit 0/2 protocol)
  - WARNING if script uses set -e (known anti-pattern for hooks)
  ```

  Files modified:
  - `scripts/validate-plugin.js` — rules 6-8 added

<!-- deepen-plan: codebase -->
> **Codebase:** This validator work has already been implemented.
> `scripts/validate-plugin.js` now includes rules 6-8 for hook validation,
> resolves `${CLAUDE_PLUGIN_ROOT}` within hook commands, and checks hook script
> basics in addition to the original manifest rules. `schemas/plugin.schema.json`
> still treats `hooks` as a string-or-object field without inner validation, so
> the validator remains the main hook-specific guardrail.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Two different path conventions exist across plugins:
> - gt-workflow: `hooks/<script>.sh` (scripts directly in hooks/)
> - yellow-ci, yellow-debt, yellow-ruvector: `hooks/scripts/<script>.sh`
>
> All hooks use the exact format: `bash ${CLAUDE_PLUGIN_ROOT}/hooks/...`. No
> variations (no `sh`, no `./`, no absolute paths). RULE 6 must handle both
> path conventions.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** For executable permission checks in Node.js, use:
> `(fs.statSync(path).mode & 0o111) !== 0` — checking any-user execute bit.
> This is the correct CI approach since runners may execute as a different user.
> For file existence, `fs.existsSync()` is standard (the async `fs.exists()`
> is deprecated). For hook event name validation, check against the 14 known
> events listed in the Proposed Solution annotation above.
<!-- /deepen-plan -->

### Phase 2: Sync hooks.json Files (One-Time)

- [x] 2.1: Update `plugins/yellow-ruvector/hooks/hooks.json`
  - Added the missing `PreToolUse` entry
  - Updated the `PostToolUse` matcher to `Edit|Write|MultiEdit|Bash`
  - Kept the `_comment` field

- [x] 2.2: Verify gt-workflow, yellow-ci, yellow-debt hooks.json are in sync
  (confirmed with current manifests and validator output)

<!-- deepen-plan: codebase -->
> **Codebase:** Current state after implementation:
>
> **gt-workflow:** IN SYNC — both files declare PreToolUse→Bash→check-git-push.sh
> and PostToolUse→Bash→check-commit-message.sh with timeout 1.
>
> **yellow-ci:** IN SYNC — both declare SessionStart→*→scripts/session-start.sh
> with timeout 3.
>
> **yellow-debt:** IN SYNC — both declare SessionStart→*→scripts/session-start.sh
> with timeout 3.
>
> **yellow-ruvector:** IN SYNC — both files now declare the same 5 events
> (PreToolUse, UserPromptSubmit, SessionStart, PostToolUse, Stop), and the
> `PostToolUse` matcher includes `MultiEdit`.
>
> All 9 hook scripts across all 4 plugins exist and are executable (-rwxr-xr-x).
<!-- /deepen-plan -->

### Phase 3: Fix ruvector Setup Command

- [x] 3.1: Update `plugins/yellow-ruvector/commands/ruvector/setup.md`

  Implemented changes:
  - Removed reliance on `npx ruvector hooks verify` for hook status because it
    checks the wrong place
  - Replaced it with direct hook script checks under `${CLAUDE_PLUGIN_ROOT}`
  - Added a global `ruvector` binary check and fail-fast guidance when missing:
    ```
    FAILED: ruvector NOT in PATH.
    Global binary is REQUIRED — hooks with 1s budgets will not function without it.
    ```
  - Updated the summary table to reflect plugin.json-backed hooks and binary status:
    ```
    | Hooks (5)          | Active via plugin.json |
    | Global binary      | REQUIRED: In PATH / FAILED: Not found |
    ```

- [x] 3.2: Update the Step 3 verify section to use plugin.json-aware checks
  instead of `npx ruvector hooks verify`

<!-- deepen-plan: codebase -->
> **Codebase:** **PATH CORRECTION:** The plan originally referenced
> `plugins/yellow-ruvector/commands/setup/SKILL.md` — this does not exist.
> The correct path is `plugins/yellow-ruvector/commands/ruvector/setup.md`.
> Command directory structure uses namespace pattern:
> `commands/<plugin-short-name>/<command>.md`, not `commands/<command>/SKILL.md`.
>
> The current Step 3 in setup.md now runs `npx ruvector doctor`, checks the
> installed hook scripts directly, verifies that the global `ruvector` binary is
> present, and includes a smoke test for the 1-second hook budget. This is a
> SKILL markdown file (instructional text for Claude), not executable code.
> Phase 4.2 still refers to running `/ruvector:setup` interactively.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Hook degradation details — two of five hooks are effectively
> no-ops without a global `ruvector` binary:
>
> - `pre-tool-use.sh:32-37` — exits immediately if no global binary (comment:
>   "npx fallback ~2700ms exceeds 1s timeout")
> - `user-prompt-submit.sh:45-52` — has npx fallback but with 0.9s internal
>   timeout that gets killed (npx needs ~2700ms)
> - `session-start.sh` (3s budget) and `stop.sh` (10s budget) — both have
>   enough timeout for npx fallback
> - `post-tool-use.sh` (1s budget) — uses `npx --no ruvector` which may
>   intermittently succeed
<!-- /deepen-plan -->

### Phase 4: Testing

- [x] 4.1: Run `pnpm validate:schemas` to verify current rules pass for all
  plugins and confirm there is no remaining hooks.json drift

- [ ] 4.2: Manually test ruvector setup flow with the updated setup.md

## Technical Details

### Files modified

- `scripts/validate-plugin.js` — add hook validation (rules 6-8)
- `plugins/yellow-ruvector/hooks/hooks.json` — sync with plugin.json
- `plugins/yellow-ruvector/commands/ruvector/setup.md` — fix hook verification

### How Claude Code loads plugin hooks (for context)

Claude Code reads hooks directly from `.claude-plugin/plugin.json` at runtime.
It does NOT merge them into `.claude/settings.json`. The `hooks/hooks.json` file
is reference-only (documented via `_comment` field). The `$CLAUDE_PLUGIN_ROOT`
env var is set by Claude Code to the plugin's cache directory at runtime.

<!-- deepen-plan: external -->
> **Research:** Claude Code documents default hook discovery, but this repo
> standardizes on inline hooks in `.claude-plugin/plugin.json` and keeps
> `hooks/hooks.json` as a synced reference artifact only. Declaring
> `"hooks": "./hooks/hooks.json"` as a string path in plugin.json causes a
> **duplicate hooks error** in v2.1+, so the validator treats string-path hooks
> as an error path and hooks.json drift as a warning against the reference copy.
> The inline object approach used in this repo is the intended runtime source of
> truth across environments (CLI, VS Code, WSL2).
> Hook script I/O protocol: exit 0 = proceed (stdout added to context for
> SessionStart/UserPromptSubmit), exit 2 = block action (stderr as feedback).
> See: https://code.claude.com/docs/en/hooks
<!-- /deepen-plan -->

## Acceptance Criteria

1. `pnpm validate:schemas` catches missing/non-readable hook scripts
2. `pnpm validate:schemas` warns when hooks.json drifts from plugin.json
3. All hooks.json files are in sync with their plugin.json
4. `/ruvector:setup` reports accurate hook status (no false negatives)
5. `/ruvector:setup` fails clearly when the global binary is missing and hooks
   would degrade

## Edge Cases

- Plugin with hooks in plugin.json but no hooks/ directory → ERROR in validator
- Plugin with hooks.json but no hooks in plugin.json → WARNING (stale file)
- Hook script with `${CLAUDE_PLUGIN_ROOT}` prefix → validator resolves relative
  to plugin dir
- Plugin with no hooks at all → skip hook validation silently

<!-- deepen-plan: external -->
> **Research:** Additional edge case: if `plugin.json` declares `"hooks"` as a
> string path (file indirection like `"hooks": "./config/hooks.json"`), this is
> valid for non-standard paths but causes duplicate errors if it points to the
> standard `hooks/hooks.json`. The validator should ERROR on
> `"hooks": "./hooks/hooks.json"` (known anti-pattern) and WARN on any string
> value that can't be resolved.
<!-- /deepen-plan -->

## References

<!-- deepen-plan: external -->
> **Research:**
> - [Claude Code Hooks Documentation](https://code.claude.com/docs/en/hooks) — hook events, I/O protocol, JSON output
> - [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — plugin.json schema, hooks field
> - [GitHub #16288: Plugin hooks not loaded from external hooks.json](https://github.com/anthropics/claude-code/issues/16288) — known bug on Linux/WSL2
> - [GitHub #18547: Plugin hooks not firing in VS Code](https://github.com/anthropics/claude-code/issues/18547) — VS Code extension hook loading
> - [GitHub #103 (everything-claude-code): Duplicate hooks error](https://github.com/affaan-m/everything-claude-code/issues/103) — anti-pattern documentation
<!-- /deepen-plan -->
