# Feature: `setup:all` — Unified Plugin Setup Orchestrator

## Problem Statement

When a user freshly installs all yellow-plugins, they must run 9 separate setup
commands across 8 plugins to configure everything. There is no single entry point
to validate the entire ecosystem's prerequisites, environment variables, and
configuration files.

## Current State

Each plugin has its own `/X:setup` command (see brainstorm doc for full
inventory). These commands work independently and handle their own interactive
wizards. There is no orchestrator that ties them together.

## Proposed Solution

Create a single `setup:all` command in yellow-core that:

1. Runs non-interactive checks across all plugins (dashboard phase)
2. Offers to walk through interactive setups for plugins that need attention
3. Produces a before/after final summary

**Approach:** Single orchestrator command (Approach A from brainstorm). The
orchestrator owns the dashboard checks; individual setup commands own their
wizards. Invoked via `Skill` tool.

## Implementation Plan

### Phase 1: Create the Command File

- [ ] **1.1: Create `plugins/yellow-core/commands/setup/all.md`**

  Create the command markdown file with the structure below.

  **Frontmatter:**

  ```yaml
  ---
  name: setup:all
  description: "Run setup for all installed yellow-plugins. Checks prerequisites, environment variables, and plugin status, then offers interactive setup for plugins that need it. Use after fresh install or to verify configuration."
  argument-hint: ''
  allowed-tools:
    - Bash
    - Skill
    - AskUserQuestion
    - Read
  ---
  ```

  **Body structure — 5 steps:**

  **Step 1: Dashboard Check (single Bash call)**

  A single comprehensive Bash call that checks:

  - CLI prerequisites: `node`, `npm`, `npx`, `curl`, `jq`, `rg`, `gh`, `ssh`,
    `python3`, `semgrep` — using `command -v` pattern
  - Environment variables: `MORPH_API_KEY`, `DEVIN_SERVICE_USER_TOKEN`,
    `DEVIN_ORG_ID`, `SEMGREP_APP_TOKEN`, `EXA_API_KEY`, `TAVILY_API_KEY`,
    `PERPLEXITY_API_KEY` — using `[ -n "${VAR:-}" ]` pattern
  - Config files: `.ruvector/` dir, `.claude/yellow-chatprd.local.md`,
    `.claude/yellow-ci.local.md`, `.claude/yellow-browser-test.local.md`,
    `~/.claude/yellow-statusline.py`
  - Plugin installation: check `$HOME/.claude/plugins/cache` for installed
    plugin directories

  Output format follows the dashboard mock in the brainstorm doc, with sections:
  Prerequisites, Environment Variables, Plugin Status, Summary.

  **Status classification logic per plugin:**

  | Plugin | READY when | PARTIAL when | NEEDS SETUP when |
  |--------|-----------|-------------|-----------------|
  | yellow-ruvector | `.ruvector/` exists, `node` available | — | `.ruvector/` missing |
  | yellow-morph | `rg`, `node`, `npx` available, `MORPH_API_KEY` set | — | `MORPH_API_KEY` not set or `rg` missing |
  | yellow-devin | `curl`, `jq` available, both env vars set | — | Either env var missing |
  | yellow-semgrep | `SEMGREP_APP_TOKEN` set, `semgrep` CLI available | `SEMGREP_APP_TOKEN` set but no CLI | Token not set |
  | yellow-research | All 3 API keys set | 1-2 of 3 API keys set | 0 of 3 API keys set |
  | yellow-chatprd | `.claude/yellow-chatprd.local.md` exists | — | Config file missing |
  | yellow-ci | `gh`, `jq`, `ssh` available, `gh auth status` passes | Tools available but no auth | Tools missing |
  | yellow-browser-test | `.claude/yellow-browser-test.local.md` exists | — | Config file missing |
  | yellow-core (statusline) | `~/.claude/yellow-statusline.py` exists | — | Statusline not installed |

  **Step 2: Decision tree after dashboard**

  Parse the Bash output and classify:

  - If 0 plugins need setup: "All plugins are configured. Nothing to do."
    → Use AskUserQuestion with options: "Run statusline refresh", "Done"
  - If 1+ plugins need setup or are partial: Use AskUserQuestion with options:
    - "Run all N setups now" — walk through each sequentially
    - "Pick which to run" — let user choose from checklist
    - "Skip for now" — exit with dashboard

  If user picks "Pick which to run", use AskUserQuestion with multiSelect to
  let them choose which plugins to set up.

  **Step 3: Sequential interactive setups**

  For each plugin the user chose (in fixed order), invoke via Skill tool:

  ```
  Invoke the Skill tool with skill: "<namespace>:setup".
  ```

  Fixed order (matching brainstorm):
  1. `ruvector:setup`
  2. `morph:setup`
  3. `devin:setup`
  4. `semgrep:setup`
  5. `research:setup`
  6. `chatprd:setup`
  7. `ci:setup`
  8. `browser-test:setup`
  9. `statusline:setup` (always last)

  Between each setup, show transition: "Next: yellow-chatprd (3 of 4)..."

  **Graceful degradation:** If a Skill invocation fails (skill not found, plugin
  not installed), record the failure and continue to the next plugin. Do not stop.

  **Step 4: Final summary**

  Re-run the same Bash check from Step 1. Display a before/after comparison table
  showing only plugins whose status changed, plus the overall count.

  **Step 5: Next steps**

  Use AskUserQuestion: "What would you like to do next?" with options:
  - "Re-run setup:all" — start from Step 1 again
  - "Done"

  **Error Handling table** at the bottom covering:
  - No plugins installed → "No yellow-plugins found in plugin cache."
  - Skill invocation failed → record failure, continue to next plugin
  - Bash check failed → report which checks could not run

### Phase 2: Update Documentation

- [ ] **2.1: Update `plugins/yellow-core/CLAUDE.md`**

  Add `/setup:all` to the Commands section. Increment count from (6) to (7).

  Add after the `/statusline:setup` line:
  ```
  - `/setup:all` — run setup for all installed yellow-plugins with unified dashboard
  ```

### Phase 3: Changeset

- [ ] **3.1: Create changeset for yellow-core**

  Run `pnpm changeset` to record a `minor` bump (new command = additive change).

## Technical Details

### Files to Create

- `plugins/yellow-core/commands/setup/all.md` — The setup:all command (~200-300 lines)

### Files to Modify

- `plugins/yellow-core/CLAUDE.md` — Add command listing, increment count

### Key Design Decisions

1. **Dashboard checks are shallow** — env var presence and CLI existence only.
   No API validation, no format checks. That's each setup command's job.

2. **Skill tool for delegation** — reuses existing setup commands unchanged.
   Any improvements to individual setups automatically benefit setup:all.

3. **Fixed order hardcoded** — infrastructure first, interactive wizards after,
   statusline last. No dependency graph needed.

4. **Single Bash call for dashboard** — minimizes tool-call budget. All checks
   batched into one shell invocation with printf-delimited sections.

5. **gh auth status for CI readiness** — use `gh auth status 2>&1` to check
   GitHub CLI auth state without making API calls.

## Acceptance Criteria

1. `/setup:all` produces a dashboard showing status of all 9 plugins
2. Plugins are classified as READY / PARTIAL / NEEDS SETUP correctly
3. User can choose to run all setups, pick specific ones, or skip
4. Interactive setups are invoked via Skill in the correct order
5. Failed Skill invocations are recorded and do not stop the orchestrator
6. Final before/after summary shows what changed
7. Statusline setup always runs last
8. Command works on a fresh machine (nothing configured) and a fully-configured one

## Edge Cases

- All plugins already configured → "Nothing to do" message
- No plugins installed in cache → graceful error message
- Individual setup command fails mid-way → record failure, continue
- User cancels during interactive phase → show partial summary
- Missing CLI tools (no node, no curl) → dashboard shows them as NOT FOUND,
  relevant plugins marked NEEDS SETUP

## References

- Brainstorm: `docs/brainstorms/2026-03-04-setup-all-command-brainstorm.md`
- Existing setup commands: `plugins/*/commands/*/setup.md`
- Skill invocation pattern: `plugins/yellow-core/commands/workflows/work.md` (lines 350-436)
- Plugin detection pattern: `plugins/yellow-core/commands/statusline/setup.md` (lines 60-81)
- Dashboard check pattern: `plugins/yellow-devin/commands/devin/setup.md` (lines 23-31)
