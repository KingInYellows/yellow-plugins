---
title: "Setup command binary auto-install pattern"
date: 2026-03-09
category: workflow
tags:
  - setup
  - install-scripts
  - plugin-conventions
  - pipx
  - nvm
components:
  - plugins/yellow-semgrep/scripts/install-semgrep.sh
  - plugins/yellow-research/scripts/install-ast-grep.sh
  - plugins/yellow-semgrep/commands/semgrep/setup.md
  - plugins/yellow-research/commands/research/setup.md
  - plugins/yellow-semgrep/CLAUDE.md
  - plugins/yellow-research/CLAUDE.md
---

# Setup command binary auto-install pattern

## Problem

Plugin setup commands (`/semgrep:setup`, `/research:setup`) assumed their
required CLI binaries (`semgrep`, `ast-grep`) were already installed on the
host. When a binary was missing, the setup command reported it absent but
offered no way to install it, leaving the user stuck with no clear next step.

**Symptoms:**

- Setup command prints "semgrep not found" or "ast-grep not found" and
  continues with degraded functionality
- User must manually research and install the binary before re-running setup
- No install script convention existed across the plugin ecosystem

## Root Cause

The setup commands had no "Step 0" binary prerequisite check with an
auto-install offer. The existing `ruvector` and `browser-test` plugins had
install scripts (`plugins/<name>/scripts/install.sh`), but `yellow-semgrep`
and `yellow-research` did not follow the pattern.

## Fix

### 1. Install script convention

Created install scripts at the established path:

```text
plugins/<name>/scripts/install-<binary>.sh
```

Each script follows a standard structure:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Color helpers
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
error()   { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; }
warning() { printf "${YELLOW}[WARN]${NC} %s\n" "$1" >&2; }
success() { printf "${GREEN}[OK]${NC} %s\n" "$1"; }

# Cleanup trap
cleanup() { ... }
trap cleanup EXIT

# Flow: detect -> install -> verify
```

### 2. Python binary install (semgrep)

`plugins/yellow-semgrep/scripts/install-semgrep.sh` (132 lines):

- **pipx-first strategy** to avoid PEP 668 "externally-managed-environment"
  errors on modern Linux (Debian 12+, Ubuntu 23.04+)
- Falls back to `pip install --user` only when pipx is unavailable
- Uses `$pip_cmd` variable consistently (review fix: was computed but not
  used in the original implementation)
- Captures pipx output into a variable for error reporting parity with pip

### 3. Node binary install (ast-grep)

`plugins/yellow-research/scripts/install-ast-grep.sh` (135 lines):

- Installs via `npm install -g` (standard path)
- **NVM-aware fallback**: when NVM is detected, skips the `--prefix ~/.local`
  fallback because NVM manages its own prefix and mixing causes confusion
- Cleanup trap uses `--prefix ~/.local` only when `install_path=local`

### 4. Setup command Step 0

Both setup commands gained a new "Step 0" before existing steps:

1. Check if binary exists via `command -v <binary>`
2. If missing, use `AskUserQuestion` to confirm installation
3. If confirmed, run the install script via `Bash`
4. Verify binary is now available

**Key design decision:** Confirmation is handled at the command layer
(AskUserQuestion), so install scripts are non-interactive. No `--yes` flag
needed.

### 5. Soft vs hard prerequisite pattern

- **Soft prerequisite** (binary missing): warn + continue with degraded
  functionality (scan features limited but setup can still configure other
  aspects)
- **Hard prerequisite** (curl/jq missing in install script): `exit 1`
  immediately

## Files Changed

| File | Change |
| --- | --- |
| `plugins/yellow-semgrep/scripts/install-semgrep.sh` | NEW |
| `plugins/yellow-research/scripts/install-ast-grep.sh` | NEW |
| `plugins/yellow-semgrep/commands/semgrep/setup.md` | Added Step 0 |
| `plugins/yellow-research/commands/research/setup.md` | Added Step 0 |
| `plugins/yellow-semgrep/CLAUDE.md` | Noted auto-install |
| `plugins/yellow-research/CLAUDE.md` | Noted auto-install |

## Review Fixes Applied

These issues were caught during code review and fixed before merge:

1. **Dead code removal** -- Both scripts had `AUTO_YES`/`--yes` flag parsing
   that was never used (confirmation handled at command layer). Removed.
2. **Variable consistency** -- `$pip_cmd` was computed to select the correct
   pip invocation but `python3 -m pip` was hardcoded downstream. Fixed to
   use `$pip_cmd` throughout.
3. **Error reporting parity** -- pipx path did not capture output for error
   messages while pip path did. Added output capture for pipx.
4. **Cleanup trap correctness** -- ast-grep cleanup trap did not use
   `--prefix ~/.local` when `install_path=local`. Fixed.

## Prevention

- [ ] Every new setup command that depends on an external binary must include
  a Step 0 binary check with auto-install offer
- [ ] Install scripts go in `plugins/<name>/scripts/install-<binary>.sh`
  (not `hooks/scripts/`)
- [ ] Use `set -Eeuo pipefail` with color helpers and cleanup trap
- [ ] Python binaries: pipx-first, pip fallback (PEP 668 awareness)
- [ ] Node binaries: check for NVM before using `--prefix ~/.local`
- [ ] Confirmation at command layer (AskUserQuestion), scripts non-interactive
- [ ] Distinguish soft prerequisites (warn + continue) from hard prerequisites
  (exit 1)
- [ ] Ensure variables computed for tool selection are actually used downstream
  (common review finding)

## Related Documentation

- PR #152 (`feat/setup-binary-auto-install`)
- `plugins/yellow-ruvector/scripts/install.sh` -- original install script pattern
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` -- prerequisite enforcement with `command -v`
- `docs/solutions/integration-issues/semgrep-mcp-appsec-plugin-architecture.md` -- yellow-semgrep plugin architecture
