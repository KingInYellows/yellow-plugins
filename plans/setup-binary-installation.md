# Feature: Setup Binary Auto-Installation

## Problem Statement

The plugin setup workflow (`semgrep:setup`, `research:setup`, `setup:all`)
detects missing binaries (`semgrep` CLI and `ast-grep`) but never installs them.
Users hit a dead end: the dashboard reports "NOT FOUND" and setup either errors
out or prints warnings, with no install path. This adds auto-install with
confirmation to close the gap.

## Current State

- **semgrep:setup** Step 1 runs `command -v semgrep` and `exit 1` if missing
- **research:setup** Step 1 runs `command -v ast-grep` and prints "NOT FOUND"
  but continues (non-fatal)
- **setup:all** detects both binaries in Step 1 dashboard, classifies plugins in
  Step 2, then delegates to individual setup commands in Step 4
- **ruvector:setup** is the only plugin with auto-install — delegates to
  `scripts/install.sh` (lives at plugin root `scripts/`, NOT `hooks/scripts/`)
- Neither yellow-semgrep nor yellow-research have a `scripts/` directory

<!-- deepen-plan: codebase -->
> **Codebase:** `yellow-browser-test` provides a second precedent:
> `plugins/yellow-browser-test/scripts/install-agent-browser.sh` also lives at
> `scripts/`, called via `bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-agent-browser.sh"`
> in `browser-test:setup` (line 38). Two independent examples confirm the
> `scripts/install-*.sh` convention.
<!-- /deepen-plan -->

## Proposed Solution

Follow the ruvector pattern: each plugin gets a standalone install script at
`plugins/<name>/scripts/install-<binary>.sh`. Individual setup commands call the
script as a new early step. No changes to `setup:all` — it gets installs for
free through delegation to the individual setup commands.

<!-- deepen-plan: codebase -->
> **Codebase:** `CLAUDE_PLUGIN_ROOT` env var is standard across all plugins —
> used in hooks.json, commands, and agents. The validator at
> `scripts/validate-plugin.js:30` explicitly resolves `${CLAUDE_PLUGIN_ROOT}` to
> the plugin directory. Both `semgrep:setup` and `research:setup` already have
> `AskUserQuestion` in their `allowed-tools` frontmatter, so no frontmatter
> changes are needed for the new confirmation prompts.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Note that the confirmation prompt is a **new pattern** — neither
> `ruvector:setup` (Step 2a) nor `browser-test:setup` (line 38) ask before
> running their install scripts. Both call `bash "${CLAUDE_PLUGIN_ROOT}/scripts/..."`
> directly. Consider whether to retrofit confirmation into those two for
> consistency, or accept the divergence.
<!-- /deepen-plan -->

## Key Design Decisions (from brainstorm + spec-flow analysis)

### Resolved from brainstorm

1. **Auto-install with confirmation** via AskUserQuestion
2. **Install methods:** `pipx install semgrep` (fallback `pip`), `npm install -g @ast-grep/cli`
3. **Confirm one at a time** per binary
4. **Verify, warn, and continue** on failure (never block setup)
5. **Layered architecture:** scripts + setup commands + setup:all

<!-- deepen-plan: external -->
> **Research:** PEP 668 enforcement confirms `pipx` as the right primary choice.
> `pip install` is blocked on Debian 12+, Ubuntu 23.04+, Arch Linux, Fedora, and
> Homebrew on macOS with `externally-managed-environment` error. The only pip
> escape hatch (`--break-system-packages`) is dangerous and should never be used
> in automated scripts. `pipx` avoids PEP 668 entirely by managing its own
> isolated venvs. Sources: PEP 668, Semgrep docs on externally-managed-environment.
<!-- /deepen-plan -->

### Resolved from spec-flow analysis

6. **Script path:** `scripts/install-<binary>.sh` (NOT `hooks/scripts/`) —
   matches ruvector convention; `hooks/scripts/` is for Claude Code hook scripts
7. **Exit behavior:** Follow ruvector pattern (`set -Eeuo pipefail`, exit
   non-zero on failure). The calling setup command handles graceful
   continuation. The brainstorm's "exit 0 always" contract is revised.
8. **setup:all does NOT need its own install phase** — it delegates to
   individual setup commands which handle their own installs. Adding a separate
   install phase would cause double-prompting.
9. **User decline flow:** Show manual install instructions, then continue to
   subsequent setup steps. Modify `semgrep:setup` Step 1 to warn instead of
   `exit 1` when semgrep is missing after the install step runs.
10. **Confirmation prompt:** Simple "Yes/No" with auto-selected install method.
    No method choice UI — the fallback chain runs automatically.
11. **No pipx self-install** — if neither pipx nor pip is found, print
    instructions (YAGNI)
12. **No version floor checks in v1** — install if missing, don't check versions
13. **Venv detection for pip fallback** — detect `$VIRTUAL_ENV` and warn

<!-- deepen-plan: codebase -->
> **Codebase:** Use `set -Eeuo pipefail` (with `-E`), not `set -euo pipefail`.
> The ruvector install script uses `-Eeuo` (line 2) while browser-test's install
> script uses `-euo` (no `-E`). The `-E` flag causes ERR traps to be inherited
> by shell functions, which makes the `trap cleanup EXIT` work correctly inside
> functions. Prefer the ruvector variant for robustness.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Install Scripts

- [ ] **1.1:** Create `plugins/yellow-semgrep/scripts/install-semgrep.sh`

  Follow ruvector `install.sh` conventions:
  - `set -Eeuo pipefail`
  - Color helpers (`RED`, `GREEN`, `YELLOW`, `NC`), `error()`, `warning()`,
    `success()` functions
  - `trap cleanup EXIT` for partial install warnings
  - Accept `--yes` flag to skip confirmation (for future automation)

  Logic:
  ```
  1. command -v semgrep → already installed, print version, exit 0
  2. Check pipx: command -v pipx
     → found: run `pipx install semgrep`
     → not found: print "pipx not found — falling back to pip"
  3. Check pip: command -v pip3 || command -v pip
     → found: detect $VIRTUAL_ENV, warn if active
     → run `python3 -m pip install semgrep`
     → not found: error with manual install instructions
  4. Verify: command -v semgrep && semgrep --version
     → success: print version
     → failure: error with cleanup instructions
  ```

<!-- deepen-plan: external -->
> **Research:** Venv detection refinement — only warn about `$VIRTUAL_ENV` for
> the **pip fallback**, not for pipx. `pipx` manages its own isolated venvs and
> installs binaries to `~/.local/bin` regardless of any active user venv. An
> active venv does not interfere with `pipx`. However, `pip` inside an active
> venv installs only into that venv, not globally — when the venv deactivates,
> `semgrep` disappears from PATH. Detection: `[ -n "$VIRTUAL_ENV" ]` is the
> canonical bash check (set by the standard venv activation script).
<!-- /deepen-plan -->

  Manual instructions fallback text:
  ```
  Install semgrep manually using one of:
    pipx install semgrep          (recommended — install pipx first: brew install pipx)
    pip install semgrep           (requires Python 3.9+)
    brew install semgrep          (macOS only)
  Then re-run /semgrep:setup
  ```

- [ ] **1.2:** Create `plugins/yellow-research/scripts/install-ast-grep.sh`

  Same conventions as 1.1. Simpler logic since npm is always available:

  ```
  1. command -v ast-grep → already installed, print version, exit 0
  2. Run npm install -g @ast-grep/cli
     → permission error: try --prefix ~/.local (ruvector pattern)
     → detect shell rc file, print PATH update instructions
  3. Verify: command -v ast-grep && ast-grep --version
     → success: print version
     → failure: error with cleanup/manual instructions
  ```

<!-- deepen-plan: external -->
> **Research:** `@ast-grep/cli` ships **pre-built native binaries** via npm's
> `optionalDependencies` pattern — no source compilation or `node-gyp` involved.
> Each platform/arch combo is a separate npm package (e.g.,
> `@ast-grep/cli-linux-x64-gnu`, `@ast-grep/cli-darwin-arm64`). npm automatically
> installs only the matching binary. Installation is fast and has no build
> dependencies beyond Node.js itself.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** npm permission fallback refinement — detect EACCES specifically
> in stderr before retrying with `--prefix`. Also: if `$NVM_DIR` is set, NVM
> already solves the permission problem (prefix is per-node-version under
> `~/.nvm`), so the `--prefix ~/.local` fallback is unnecessary and could
> conflict. Detect NVM first and skip the prefix fallback. Pattern from ruvector
> `install.sh` lines 87-92 already detects nvm/fnm — extend that logic to
> conditionally skip the prefix fallback.
<!-- /deepen-plan -->

  Manual instructions fallback text:
  ```
  Install ast-grep manually using one of:
    npm install -g @ast-grep/cli   (Node.js)
    brew install ast-grep          (macOS/Linux)
    pip install ast-grep-cli       (Python)
    cargo install ast-grep --locked (Rust)
  Then re-run /research:setup
  ```

### Phase 2: Setup Command Integration

- [ ] **2.1:** Modify `plugins/yellow-semgrep/commands/semgrep/setup.md`

  Add a new **Step 0: Install semgrep CLI** before the existing Step 1.

  Step 0 logic (in the command markdown, not the script):
  ```
  1. Check: command -v semgrep → skip to Step 1 if present
  2. AskUserQuestion: "semgrep CLI not found. Install it now?
     (Required for /semgrep:scan and /semgrep:fix)"
     Options: "Yes, install semgrep" / "No, I'll install manually"
  3. If Yes: run bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-semgrep.sh"
  4. If No: print manual install instructions, continue to Step 1
  ```

  Also modify existing **Step 1** to warn-and-continue instead of `exit 1`
  when semgrep is missing. Change:
  ```bash
  command -v "$cmd" >/dev/null 2>&1 || { printf '...'; exit 1; }
  ```
  To: track missing commands, print warnings, continue. Only `curl` and `jq`
  remain hard prerequisites (needed for API calls). `semgrep` becomes a soft
  prerequisite (already handled by Step 0).

<!-- deepen-plan: codebase -->
> **Codebase:** The existing Step 1 loop (lines 23-29) treats `curl`, `jq`, and
> `semgrep` identically — any missing tool triggers `exit 1`. The modification
> needs to split this into two groups: hard prerequisites (`curl`, `jq`) that
> still `exit 1`, and soft prerequisites (`semgrep`) that warn and continue.
> Suggested pattern: separate the loop into two checks, or use a flag variable.
<!-- /deepen-plan -->

- [ ] **2.2:** Modify `plugins/yellow-research/commands/research/setup.md`

  Add a new **Step 0: Install ast-grep** before the existing Step 1.

  Step 0 logic:
  ```
  1. Check: command -v ast-grep → skip to Step 1 if present
  2. AskUserQuestion: "ast-grep binary not found. Install it now?
     (Enables AST-based code search in /research:code and /research:deep)"
     Options: "Yes, install ast-grep" / "No, I'll install manually"
  3. If Yes: run bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-ast-grep.sh"
  4. If No: print manual install instructions, continue to Step 1
  ```

  No changes to existing Step 1 needed — it already reports ast-grep as
  "NOT FOUND" and continues.

### Phase 3: Validation and Documentation

- [ ] **3.1:** Update `plugins/yellow-semgrep/CLAUDE.md`

  Add note under "Required CLI Tools" that `/semgrep:setup` now offers to
  install the semgrep CLI if missing.

- [ ] **3.2:** Update `plugins/yellow-research/CLAUDE.md`

  Add note under "Prerequisites" that `/research:setup` now offers to install
  `ast-grep` if missing.

- [ ] **3.3:** Run `pnpm validate:schemas` to verify no frontmatter regressions

- [ ] **3.4:** Manual test matrix

  Test each entry point with binary present and absent:

  | Scenario | Entry Point | Expected |
  |----------|-------------|----------|
  | semgrep present | `/semgrep:setup` | Step 0 skipped, setup proceeds |
  | semgrep missing, user says Yes | `/semgrep:setup` | Install runs, setup proceeds |
  | semgrep missing, user says No | `/semgrep:setup` | Manual instructions shown, setup continues with warning |
  | ast-grep present | `/research:setup` | Step 0 skipped, setup proceeds |
  | ast-grep missing, user says Yes | `/research:setup` | Install runs, setup proceeds |
  | ast-grep missing, user says No | `/research:setup` | Manual instructions shown, setup continues |
  | Both missing | `/setup:all` | Each setup prompts independently during delegation |
  | Both present | `/setup:all` | No install prompts, normal flow |

## Technical Details

### Files to Create

- `plugins/yellow-semgrep/scripts/install-semgrep.sh` — semgrep install script
- `plugins/yellow-research/scripts/install-ast-grep.sh` — ast-grep install script

### Files to Modify

- `plugins/yellow-semgrep/commands/semgrep/setup.md` — add Step 0, soften Step 1
- `plugins/yellow-research/commands/research/setup.md` — add Step 0
- `plugins/yellow-semgrep/CLAUDE.md` — document auto-install
- `plugins/yellow-research/CLAUDE.md` — document auto-install

### Files NOT Modified

- `plugins/yellow-core/commands/setup/all.md` — no changes needed; gets installs
  for free through delegation

## Edge Cases

- **Active Python venv:** pip fallback detects `$VIRTUAL_ENV` and warns that
  semgrep will only be available while venv is active
- **npm global prefix permissions:** Falls back to `--prefix ~/.local` with
  PATH update instructions (ruvector pattern)
- **nvm/fnm detected:** Print warning about per-version global binaries
  (ruvector pattern)
- **Network failure during install:** Script exits non-zero, setup command
  prints warning with manual instructions, continues
- **Concurrent sessions:** Not addressed (known limitation, same as ruvector)

<!-- deepen-plan: external -->
> **Research:** Additional edge case — **PEP 668 pip failure.** On Debian 12+,
> Ubuntu 23.04+, Arch, Fedora, and Homebrew macOS, `pip install semgrep` fails
> with `externally-managed-environment`. The script should detect this specific
> error in pip's stderr output and print a targeted message: "pip blocked by
> PEP 668. Install pipx first: `brew install pipx` or
> `python3 -m pip install --user pipx`." Never use `--break-system-packages`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Additional edge case — **NVM + prefix fallback conflict.** When
> NVM is active (`$NVM_DIR` set), npm global installs already go to the NVM
> prefix (`~/.nvm/versions/node/<ver>/bin/`), so EACCES is unlikely. If the
> script detects NVM and still hits EACCES, do not retry with `--prefix ~/.local`
> — it would install to a different location than NVM expects. Instead, warn and
> suggest the user fix NVM permissions.
<!-- /deepen-plan -->

## Acceptance Criteria

- [ ] Running `/semgrep:setup` when semgrep is missing prompts to install
- [ ] Running `/research:setup` when ast-grep is missing prompts to install
- [ ] Declining install shows manual instructions and setup continues
- [ ] Accepting install runs the correct package manager and verifies
- [ ] `/setup:all` triggers install prompts during delegated setup (no double-prompt)
- [ ] Both scripts are idempotent (no-op when binary already present)
- [ ] Failed installs warn and continue (never block the setup flow)
- [ ] `pnpm validate:schemas` passes

## References

- Brainstorm: `docs/brainstorms/2026-03-09-setup-binary-installation-brainstorm.md`
- ruvector install script (pattern): `plugins/yellow-ruvector/scripts/install.sh`
- ruvector setup command (integration pattern): `plugins/yellow-ruvector/commands/ruvector/setup.md`
- browser-test install script (second precedent): `plugins/yellow-browser-test/scripts/install-agent-browser.sh`
- semgrep setup: `plugins/yellow-semgrep/commands/semgrep/setup.md`
- research setup: `plugins/yellow-research/commands/research/setup.md`
- setup:all orchestrator: `plugins/yellow-core/commands/setup/all.md`

<!-- deepen-plan: external -->
> **Research:** External references:
> - PEP 668 specification: https://peps.python.org/pep-0668/
> - Semgrep docs on externally-managed-environment: https://semgrep.dev/docs/kb/semgrep-appsec-platform/error-externally-managed-environment
> - ast-grep quick start (install methods): https://ast-grep.github.io/guide/quick-start.html
> - npm optionalDependencies binary pattern: https://sentry.engineering/blog/publishing-binaries-on-npm
<!-- /deepen-plan -->
