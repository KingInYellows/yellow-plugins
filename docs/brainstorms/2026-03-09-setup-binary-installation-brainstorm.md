# Setup Binary Installation

**Date:** 2026-03-09
**Status:** Brainstorm complete — ready for planning
**Scope:** `yellow-semgrep`, `yellow-research`, `setup:all`

## What We're Building

The plugin setup workflow (`semgrep:setup`, `research:setup`, `setup:all`) currently
detects missing binaries (`semgrep` CLI and `ast-grep`) but never installs them.
Users hit a dead end: the dashboard reports "NOT FOUND" and the setup commands
either error out or print warnings, but the user must figure out the install
command on their own and re-run setup.

We are adding auto-install-with-confirmation to the setup flow. When a required
binary is missing, the setup command offers to install it, runs the install on
approval, verifies success, and continues. This closes the gap between "binary
not found" and "plugin ready."

### Binaries to install

| Binary     | Plugin           | Role                                    | Install method                                              |
|------------|------------------|-----------------------------------------|-------------------------------------------------------------|
| `semgrep`  | yellow-semgrep   | Hard prerequisite for all scan commands | `pipx install semgrep` (preferred), `pip install semgrep` (fallback) |
| `ast-grep` | yellow-research  | One of 6 MCP sources (graceful degrade) | `npm install -g @ast-grep/cli` (npm always available in Claude Code) |

## Why This Approach

**Approach chosen: Plugin-Scoped Install Scripts (ruvector pattern)**

This follows the exact pattern already established by `yellow-ruvector`, which has
a `scripts/install.sh` that its setup command delegates to. The pattern is
proven, the convention exists, and no new architecture is needed.

Three alternative approaches were considered:

- **Centralized dependency manager** (single shared script for all plugins) --
  rejected because it breaks plugin-scoped ownership and over-engineers a
  two-binary problem.
- **Inline in setup command markdown only** (no scripts) -- rejected because
  install logic would not be independently testable or callable, and it diverges
  from the ruvector precedent.
- **Hybrid of all three** -- the chosen approach IS a layered hybrid: scripts
  (engine) + individual setup commands (per-plugin entry point) + setup:all
  (orchestrator). Each layer delegates downward. Idempotency at the script level
  makes the chain safe regardless of entry point.

## Key Decisions

### 1. Auto-install with confirmation

Setup commands detect missing binaries and offer to install them via
`AskUserQuestion`. The user must explicitly approve before any install runs.
No silent installation.

### 2. Preferred install methods

**semgrep CLI:**
1. Check if `semgrep` already installed -- done
2. Check if `pipx` available -- `pipx install semgrep` (officially recommended by Semgrep, isolated venv)
3. Check if `pip3`/`pip` available -- `python3 -m pip install semgrep` (fallback)
4. Neither available -- print manual instructions, warn, continue

**ast-grep:**
1. Check if `ast-grep` already installed -- done
2. Run `npm install -g @ast-grep/cli` (npm is always available in Claude Code environments)

### 3. Layered architecture

```
setup:all (orchestrator)
  |
  +-- pre-setup phase: runs install scripts for PARTIAL/NEEDS SETUP plugins
  |
  +-- delegates to individual setup commands (existing Step 4 flow)
        |
        +-- semgrep:setup calls install-semgrep.sh (new Step 0)
        +-- research:setup calls install-ast-grep.sh (new Step 0)
              |
              +-- scripts are idempotent (check command -v first)
```

**New files:**
- `plugins/yellow-semgrep/scripts/install-semgrep.sh`
- `plugins/yellow-research/scripts/install-ast-grep.sh`

**Modified files:**
- `plugins/yellow-semgrep/commands/semgrep/setup.md` -- add Step 0 calling install script
- `plugins/yellow-research/commands/research/setup.md` -- add Step 0 calling install script
- `plugins/yellow-core/commands/setup/all.md` -- add pre-setup install phase

### 4. Confirm one at a time

Each binary gets its own confirmation prompt, whether invoked from an individual
setup command or from `setup:all`. This keeps the UX consistent across all entry
points. No batching.

### 5. Verify, warn, and continue

After running an install command, the script verifies with `command -v` and
`<binary> --version`. If install fails:
- Print a warning with the failed command and manual install instructions
- Continue the rest of the setup flow
- Never block on install failure (uniform policy for both semgrep and ast-grep)

This matches how `research:setup` already treats missing ast-grep (non-fatal
warning) and extends that policy to semgrep as well.

### 6. Script behavior contract

Each install script must:
- Be idempotent (exit 0 immediately if binary already present)
- Accept a `--yes` or `INSTALL_CONFIRMED=1` flag/env var so the calling command
  can pass through user confirmation (scripts are bash, not command markdown, so
  they cannot call `AskUserQuestion` directly)
- Print clear status messages: what it is installing, which method, success/failure
- Exit 0 on success or if binary was already present
- Exit 0 with a warning on install failure (never exit non-zero -- the calling
  setup command handles the "warn and continue" policy)
- Run `<binary> --version` on success for verification output

## Open Questions

- **pipx availability:** Should we also offer to install `pipx` itself if neither
  `pipx` nor `pip` are found? This adds another layer of dependency installation.
  Leaning toward no (YAGNI -- print instructions for installing pipx and stop).

- **npm global prefix permissions:** `npm install -g` can fail on some systems
  due to permissions (especially without nvm). Should the script detect this and
  suggest `npx` as an alternative, or attempt `sudo npm install -g`? Leaning
  toward never using sudo -- warn and print instructions if permissions fail.

- **setup:all pre-setup phase placement:** The new install phase in `setup:all`
  should run after dashboard classification (Step 2) but before delegated setups
  (Step 4). Should it be a new Step 3.5, or should Step 3 (the interactive
  decision prompt) incorporate install offers into the "Run all N setups" flow?
  Needs design during planning.

- **ruvector install script alignment:** The existing `ruvector` install script
  uses its own conventions. Should the new scripts follow ruvector's exact
  patterns (argument handling, output format), or establish an updated convention
  that ruvector could later adopt? Low priority -- can be reconciled later.
