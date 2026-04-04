# Feature: AST-Grep Integration Across Yellow-Plugins Ecosystem

> **Status: Implemented (archived)** — Historical record of delivered work. Unchecked items below were deprioritized or absorbed into other work.

## Problem Statement

AST-Grep installation fails on most developer machines because the ast-grep MCP
server requires Python >= 3.13, but most systems run 3.10-3.12. The `uvx`
command doesn't auto-download Python 3.13 because the `--python` flag isn't
specified in the MCP server config. Additionally, only yellow-research agents
use AST-Grep tools — review and debt agents that would benefit from structural
code search are limited to regex-based Grep.

## Current State

- **Install script** (`plugins/yellow-research/scripts/install-ast-grep.sh`)
  installs the CLI binary via npm but does NOT install `uv` or manage Python.
- **plugin.json** ast-grep MCP config uses `uvx --from git+...` without
  `--python 3.13`, so `requires-python >= 3.13` in pyproject.toml causes a
  resolution failure rather than auto-downloading Python 3.13.
- **research:setup** Step 1 explicitly checks `python3 >= 3.13` as a system
  prerequisite — this is the visible gate that blocks users.
- **setup:all** requires `python313_check == ok` for ast-grep to count as a
  bundled source. Also only checks for `ast-grep` binary (not `sg`).
- **4 agents** that would benefit from AST search have no access to ast-grep
  tools: silent-failure-hunter, type-design-analyzer, duplication-scanner,
  complexity-scanner.

## Proposed Solution

Two PRs, setup-first:

**PR 1:** Fix the installation pipeline so `uv` manages Python 3.13
transparently. Remove the system Python 3.13 requirement. Add a full MCP smoke
test to validate the entire chain works.

**PR 2:** Add ast-grep MCP tools to 4 high-value agents with ToolSearch-based
graceful degradation and per-agent prompt guidance for when to use AST search
vs. Grep.

## Implementation Plan

### Phase 1: Setup Pipeline Fixes (PR 1)

- [ ] **1.1: Add `--python 3.13` to plugin.json MCP config**

  File: `plugins/yellow-research/.claude-plugin/plugin.json` (lines 59-66)

  Change the ast-grep MCP server args from:
  ```json
  "args": [
    "--from",
    "git+https://github.com/ast-grep/ast-grep-mcp@674272f...",
    "ast-grep-server"
  ]
  ```
  To:
  ```json
  "args": [
    "--python",
    "3.13",
    "--from",
    "git+https://github.com/ast-grep/ast-grep-mcp@674272f...",
    "ast-grep-server"
  ]
  ```

  This is the core fix. `uvx --python 3.13` auto-downloads Python 3.13 into
  `~/.local/share/uv/python/` without touching the system Python. The
  `--python` flag must come before `--from`.

  **Critical gotcha from research:** `requires-python` in the upstream
  pyproject.toml does NOT trigger auto-download — only the explicit `--python`
  flag does. This is confirmed by uv GitHub issues #8206, #10916, #8051.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed at `plugins/yellow-research/.claude-plugin/plugin.json`
> lines 59-66. Current args are `["--from", "git+https://...@674272f...",
> "ast-grep-server"]` — no `--python` flag. The MCP server entry point is
> `ast-grep-server` (not `ast-grep-mcp`). The pinned commit is `674272f1adb56fd1fe48a546952c7ffbe72c09e6`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** uv docs confirm `--python` and `--from` can be combined in a
> single `uvx` invocation. Each flag and value must be separate array elements
> (`"--python", "3.13"`, not `"--python 3.13"`). On macOS, if multiple Python
> 3.13 installs exist (Homebrew + uv-managed), use `--python cpython-3.13` to
> disambiguate. No platform-specific blockers found for Linux, macOS, or WSL2.
> See: https://docs.astral.sh/uv/guides/tools/
<!-- /deepen-plan -->

- [ ] **1.2: Add `uv` installation to install-ast-grep.sh**

  File: `plugins/yellow-research/scripts/install-ast-grep.sh`

  Add a new section between the "already installed" check (line 51) and the
  "Dependency checks" section (line 53). Insert:

  ```bash
  # --- Ensure uv is installed (needed for ast-grep MCP server) ---
  if ! command -v uv >/dev/null 2>&1; then
    printf '[yellow-research] uv not found — installing (needed for ast-grep MCP server)...\n'
    if curl -LsSf https://astral.sh/uv/install.sh | sh 2>&1; then
      # Source uv into current session
      export PATH="${HOME}/.local/bin:${PATH}"
      if command -v uv >/dev/null 2>&1; then
        success "uv installed: $(uv --version 2>/dev/null)"
      else
        warning "uv installed but not in PATH. Add ~/.local/bin to PATH."
      fi
    else
      warning "uv installation failed. ast-grep MCP server will not work without uv."
      warning "Install manually: curl -LsSf https://astral.sh/uv/install.sh | sh"
    fi
  else
    printf '[yellow-research] uv: ok (%s)\n' "$(uv --version 2>/dev/null)"
  fi
  ```

  Also add `curl` to the dependency check (uv installer requires it):
  ```bash
  if ! command -v curl >/dev/null 2>&1; then
    warning "curl not found. Cannot auto-install uv."
  fi
  ```

  Optionally pre-warm Python 3.13 after uv install to front-load the download:
  ```bash
  if command -v uv >/dev/null 2>&1; then
    printf '[yellow-research] Pre-warming Python 3.13 for ast-grep MCP...\n'
    uv python install 3.13 2>&1 || warning "Python 3.13 pre-warm failed (uvx will retry on first use)"
  fi
  ```

<!-- deepen-plan: codebase -->
> **Codebase:** The existing install script (`install-ast-grep.sh`) follows a
> well-established pattern: `set -Eeuo pipefail`, color helpers, cleanup trap,
> detect/install/verify flow. The uv installation section should follow the same
> conventions. The script already checks for `curl` implicitly via npm, but an
> explicit curl check should be added since the uv installer requires it.
> Note: the script currently has NO uv or Python handling at all (lines 1-166).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** First `uvx --python 3.13` invocation is slow (~30-50MB Python
> download + git clone + package build). The `uv python install 3.13` pre-warm
> step front-loads just the Python download. For users behind corporate proxies
> (common in WSL2 setups, uv issue #12149), the pre-warm step isolates the
> Python download from the MCP server startup, making failures easier to
> diagnose. Consider detecting `python-downloads = "manual"` in uv config
> before attempting pre-warm — the exact error is: "A managed Python download
> is available for >=3.13, but Python downloads are set to 'manual'". Detection
> script: check `UV_PYTHON_DOWNLOADS` env var, then `uv.toml`, then
> `~/.config/uv/uv.toml` for `python-downloads = "manual"`.
<!-- /deepen-plan -->

- [ ] **1.3: Remove Python 3.13 system check from research:setup**

  File: `plugins/yellow-research/commands/research/setup.md`

  **Step 1 (lines 91-97):** Replace the python3 >= 3.13 check with a note that
  uv manages Python transparently:
  ```bash
  # Remove these lines:
  # if ! command -v python3 ...
  #   printf 'python3:   NOT FOUND (needs >=3.13 for ast-grep MCP)\n'
  # elif python3 -c "..." ...
  #   printf 'python3:   ok (>=3.13)\n'
  # else
  #   printf 'python3:   %s (NEEDS >=3.13 for ast-grep MCP)\n' ...
  # fi

  # Replace with:
  if command -v uv >/dev/null 2>&1; then
    printf 'uv:        ok (%s) — manages Python 3.13 for ast-grep MCP\n' "$(uv --version 2>/dev/null)"
  else
    printf 'uv:        NOT FOUND (needed for ast-grep MCP — install: curl -LsSf https://astral.sh/uv/install.sh | sh)\n'
  fi
  ```

  **Step 3.5 ast-grep health check (lines 311-322):** This already runs a real
  `find_code` call. Ensure the success message explicitly says "full chain
  validated" so users know the MCP -> Python -> ast-grep pipeline works. If the
  test fails, show the specific error (Python version, binary missing, etc.)
  rather than a generic FAIL.

<!-- deepen-plan: codebase -->
> **Codebase:** Step 3.5 (lines 311-322) already does a ToolSearch for
> `ast-grep__find_code` followed by a real `find_code` call with `pattern:
> "function $NAME() {}"`, `lang: "javascript"`. The existing note says the MCP
> server starts even without the binary (lazy check). Key point: with
> `--python 3.13` in plugin.json, the MCP server will now auto-download Python
> 3.13 on first startup, so the smoke test may be slow on first run. Consider
> adding a timeout note in the success/fail messaging.
<!-- /deepen-plan -->

  **Step 5 (lines 418-431):** Update the ast-grep prerequisites block to remove
  Python 3.13 as a system requirement. Change to:
  ```text
  To enable ast-grep MCP (AST structural code search):

    ast-grep:  npm install -g @ast-grep/cli  (or: brew, cargo, pip)
    uv:        curl -LsSf https://astral.sh/uv/install.sh | sh

  uv manages Python 3.13 automatically — no system Python upgrade needed.
  ```

- [ ] **1.4: Update setup:all dashboard and classification**

  File: `plugins/yellow-core/commands/setup/all.md`

  **Line 48:** Fix binary check to also detect `sg`:
  ```bash
  { command -v sg >/dev/null 2>&1 || command -v ast-grep >/dev/null 2>&1; } && printf 'ast-grep:           OK\n' || printf 'ast-grep:           NOT FOUND\n'
  ```

  **Lines 237-238:** Update ast-grep classification to remove
  `python313_check` requirement. Change from:
  ```text
  ast-grep counts only when ToolSearch match present AND ast-grep OK AND uv OK AND python313_check is ok
  ```
  To:
  ```text
  ast-grep counts only when ToolSearch match present AND ast-grep OK AND uv OK
  ```

  The `python313_check` lines (58-60, 63-64) can remain for other uses but
  should no longer gate ast-grep readiness. Note: `python37_check` is still
  used by yellow-core's statusline.

<!-- deepen-plan: codebase -->
> **Codebase:** Also fix line 48 inconsistency — `setup:all` checks only
> `command -v ast-grep` but the npm package provides both `sg` and `ast-grep`
> binaries. The install script (lines 40-51) and research:setup (lines 35-39)
> both check for both names. The classification logic at lines 229-243 uses
> the dashboard output, so the binary check fix cascades to classification
> automatically.
<!-- /deepen-plan -->

- [ ] **1.5: Update yellow-research CLAUDE.md**

  File: `plugins/yellow-research/CLAUDE.md`

  Update the Prerequisites section to replace:
  ```text
  - Python >= 3.13 — hard requirement from ast-grep-mcp's pyproject.toml
  ```
  With:
  ```text
  - `uv` manages Python 3.13 automatically via `uvx --python 3.13` — no system
    Python upgrade needed. Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  ```

  Update the ast-grep MCP description:
  ```text
  ### ast-grep — No API key (requires `ast-grep` binary and `uv`)
  ```

- [ ] **1.6: Validate and test**

  Run `pnpm validate:schemas` to verify plugin.json changes.
  Manually test: unset Python 3.13 from system, run `/research:setup`, confirm
  ast-grep MCP smoke test passes via uv-managed Python.

### Phase 2: Selective Agent Expansion (PR 2)

- [ ] **2.1: Add ast-grep tools to silent-failure-hunter**

  File: `plugins/yellow-review/agents/review/silent-failure-hunter.md`

  Add to `tools:` list (after existing tools):
  ```yaml
  tools:
    - Read
    - Grep
    - Glob
    - Bash
    - ToolSearch
    - mcp__plugin_yellow-research_ast-grep__find_code
    - mcp__plugin_yellow-research_ast-grep__find_code_by_rule
  ```

  Add prompt guidance after the existing detection heuristics section:
  ```markdown
  ## AST-Grep Integration (Optional)

  When available, use ast-grep for more precise detection of structural patterns.
  Check availability with ToolSearch for `ast-grep__find_code` before use. If
  unavailable, use Grep (current behavior).

  **Use ast-grep for:**
  - Empty catch/except blocks (structural match, not regex approximation)
  - Try-catch that catches but doesn't rethrow or log
  - Functions with multiple return paths where some silently return null/undefined
  - Error callbacks that ignore the error parameter

  **Use Grep for:**
  - String patterns like `// TODO`, `console.log`, `pass` comments
  - Simple text matching for error message strings
  - Comment-based suppression markers
  ```

<!-- deepen-plan: external -->
> **Research:** Concrete ast-grep YAML rules for the silent-failure-hunter's
> primary use case (empty catch blocks in JS/TS):
>
> **Pattern-based (simplest):** `catch ($ERR) {}` — matches literally empty
> bodies but not blocks with only comments.
>
> **AST kind-based (recommended):**
> ```yaml
> rule:
>   kind: catch_clause
>   has:
>     field: body
>     kind: statement_block
>     not:
>       has:
>         stopBy: end
>         any:
>           - kind: expression_statement
>           - kind: return_statement
>           - kind: throw_statement
> ```
> Key syntax: `has` with `field: body` constrains to the catch body; `stopBy:
> end` is critical (without it, ast-grep only checks immediate children).
> `$$$` matches zero or more arguments. Consider including these example rules
> in the agent guidance for reference.
> See: https://ast-grep.github.io/guide/rule-config.html
<!-- /deepen-plan -->

- [ ] **2.2: Add ast-grep tools to type-design-analyzer**

  File: `plugins/yellow-review/agents/review/type-design-analyzer.md`

  Add to `tools:` list:
  ```yaml
  tools:
    - Read
    - Grep
    - Glob
    - Bash
    - ToolSearch
    - mcp__plugin_yellow-research_ast-grep__find_code
    - mcp__plugin_yellow-research_ast-grep__find_code_by_rule
  ```

  Add prompt guidance:
  ```markdown
  ## AST-Grep Integration (Optional)

  When available, use ast-grep for precise type pattern matching. Check
  availability with ToolSearch for `ast-grep__find_code` before use. If
  unavailable, use Grep.

  **Use ast-grep for:**
  - Interface/type alias definitions with specific shapes
  - Generic type constraints and conditional types
  - Class fields with specific access modifiers
  - Function signatures with particular parameter/return type patterns

  **Use Grep for:**
  - Type name references in imports or comments
  - Simple `extends`/`implements` keyword searches
  - Documentation and JSDoc type annotations
  ```

- [ ] **2.3: Add ast-grep tools to duplication-scanner**

  File: `plugins/yellow-debt/agents/scanners/duplication-scanner.md`

  Add to `tools:` list:
  ```yaml
  tools:
    - Read
    - Grep
    - Glob
    - Bash
    - Write
    - ToolSearch
    - mcp__plugin_yellow-research_ast-grep__find_code
    - mcp__plugin_yellow-research_ast-grep__find_code_by_rule
    - mcp__plugin_yellow-research_ast-grep__dump_syntax_tree
  ```

  Note: duplication-scanner also gets `dump_syntax_tree` for structural
  comparison of near-duplicate code blocks (Type-3 clones).

<!-- deepen-plan: external -->
> **Research:** ast-grep is NOT a general clone detection tool — it has no
> built-in "find all similar pairs" mode. The practical strategy: define a
> library of common structural patterns (e.g., fetch-then-parse,
> try-catch-log, map-filter-reduce chains) using `$$$` wildcards for
> flexibility, then find all matches per pattern and flag groups with >1 match.
> Use `dump_syntax_tree` to compare AST structure of suspected near-duplicates.
> For true Type-3 clone detection at scale, ast-grep is supplementary — the
> agent should continue using line-based heuristics as primary detection and
> AST as confirmation. Metavariable re-use (`$A == $A`) catches exact
> repetition patterns. See: https://ast-grep.github.io/advanced/faq.html
<!-- /deepen-plan -->

  Add prompt guidance:
  ```markdown
  ## AST-Grep Integration (Optional)

  When available, use ast-grep for structural clone detection. Check availability
  with ToolSearch for `ast-grep__find_code` before use. If unavailable, use Grep.

  **Use ast-grep for:**
  - Finding structurally similar code blocks (Type-3 clones) with different
    variable names but identical AST shape
  - Detecting repeated patterns like identical error handling blocks, similar
    validation sequences, or copy-pasted function bodies
  - Use `dump_syntax_tree` to compare AST structure of suspected duplicates

  **Use Grep for:**
  - Finding identical text strings (Type-1 clones)
  - Searching for specific function/class names across files
  - Simple line-count based size comparisons
  ```

- [ ] **2.4: Add ast-grep tools to complexity-scanner**

  File: `plugins/yellow-debt/agents/scanners/complexity-scanner.md`

  Add to `tools:` list:
  ```yaml
  tools:
    - Read
    - Grep
    - Glob
    - Bash
    - Write
    - ToolSearch
    - mcp__plugin_yellow-research_ast-grep__find_code
    - mcp__plugin_yellow-research_ast-grep__find_code_by_rule
  ```

  Add prompt guidance:
  ```markdown
  ## AST-Grep Integration (Optional)

  When available, use ast-grep for more accurate complexity detection. Check
  availability with ToolSearch for `ast-grep__find_code` before use. If
  unavailable, use Grep.

  **Use ast-grep for:**
  - Counting nesting depth via AST structure (more accurate than indentation)
  - Finding deeply nested control flow (if/for/while/switch chains)
  - Detecting god functions by parameter count and return path analysis
  - Matching specific complex patterns like nested ternaries or chained optionals

  **Use Grep for:**
  - Line counting for function length heuristics
  - Finding `TODO`/`FIXME` markers in complex code
  - Simple keyword frequency (number of `if`/`else`/`switch` keywords)
  ```

- [ ] **2.5: Validate agent frontmatter**

  Run `node scripts/validate-agent-authoring.js` to verify all modified agents
  have valid frontmatter.

### Phase 3: Quality

- [ ] **3.1: Run validation suite**

  ```bash
  pnpm validate:schemas
  node scripts/validate-agent-authoring.js
  ```

- [ ] **3.2: Create changesets**

  PR 1 touches yellow-research (minor — setup pipeline improvement) and
  yellow-core (patch — fix sg binary check in dashboard).

  PR 2 touches yellow-review (minor — agents gain ast-grep tools) and
  yellow-debt (minor — agents gain ast-grep tools).

## Technical Details

### Files to Modify (PR 1)

| File | Change |
|------|--------|
| `plugins/yellow-research/.claude-plugin/plugin.json` | Add `--python`, `3.13` to ast-grep args |
| `plugins/yellow-research/scripts/install-ast-grep.sh` | Add uv install + Python 3.13 pre-warm |
| `plugins/yellow-research/commands/research/setup.md` | Remove Python 3.13 system check, update smoke test messaging, update Step 5 |
| `plugins/yellow-research/CLAUDE.md` | Update Prerequisites section |
| `plugins/yellow-core/commands/setup/all.md` | Fix sg/ast-grep check, remove python313_check from ast-grep gate |

### Files to Modify (PR 2)

| File | Change |
|------|--------|
| `plugins/yellow-review/agents/review/silent-failure-hunter.md` | Add ToolSearch + 2 ast-grep tools + guidance |
| `plugins/yellow-review/agents/review/type-design-analyzer.md` | Add ToolSearch + 2 ast-grep tools + guidance |
| `plugins/yellow-debt/agents/scanners/duplication-scanner.md` | Add ToolSearch + 3 ast-grep tools + guidance |
| `plugins/yellow-debt/agents/scanners/complexity-scanner.md` | Add ToolSearch + 2 ast-grep tools + guidance |

### No New Files

All changes are modifications to existing files.

## Acceptance Criteria

**PR 1:**
1. `uvx --python 3.13 --from git+...@674272f ast-grep-server` starts
   successfully on a machine with only Python 3.10-3.12
2. `/research:setup` no longer shows "NEEDS >=3.13" for Python
3. `/research:setup` installs `uv` if missing (with user confirmation)
4. `/research:setup` Step 3.5 smoke test validates the full MCP chain
5. `/setup:all` counts ast-grep as available without `python313_check`
6. `/setup:all` detects both `sg` and `ast-grep` binaries
7. `pnpm validate:schemas` passes

**PR 2:**
1. All 4 agents list ast-grep tools in `tools:` frontmatter
2. All 4 agents include ToolSearch in `tools:` for runtime availability check
3. Each agent has tailored AST vs. Grep routing guidance
4. Agents fall back to Grep when ast-grep tools are unavailable
5. `node scripts/validate-agent-authoring.js` passes

## Edge Cases

- **`python-downloads = "manual"` in uv config:** If a user has disabled auto
  Python downloads, `uvx --python 3.13` will fail. The smoke test catches this.
  Setup should suggest `uv python install 3.13` as a manual step.

<!-- deepen-plan: external -->
> **Research:** The exact error message when `python-downloads = "manual"` is
> set: "A managed Python download is available for >=3.13, <3.14, but Python
> downloads are set to 'manual', use `uv python install >=3.13, <3.14` to
> install the required version". Known bug (uv issue #17051): the suggested
> command is not properly quoted for shell parsing. Detection: check
> `UV_PYTHON_DOWNLOADS` env var (highest precedence), then `uv.toml`, then
> `pyproject.toml [tool.uv]`, then `~/.config/uv/uv.toml`. Override option:
> `UV_PYTHON_DOWNLOADS=automatic` for just the setup invocation.
> See: https://docs.astral.sh/uv/concepts/python-versions/
<!-- /deepen-plan -->
- **First invocation slow:** First `uvx --python 3.13` downloads Python 3.13
  (~30-50MB) + clones git repo + builds package. The pre-warm step in the
  install script mitigates this.
- **`sg` vs `ast-grep` binary name:** The npm package provides both. All checks
  must test for both names.
- **MCP server starts without binary:** The ast-grep MCP server starts
  successfully even without the `ast-grep` CLI binary (lazy check). ToolSearch
  will find the tools, but they'll fail on invocation. The smoke test catches
  this.

## References

- Brainstorm: `docs/brainstorms/2026-03-16-ast-grep-integration-across-the-yellow-p-brainstorm.md`
- Current install script: `plugins/yellow-research/scripts/install-ast-grep.sh`
- Current plugin.json: `plugins/yellow-research/.claude-plugin/plugin.json`
- Current setup command: `plugins/yellow-research/commands/research/setup.md`
- Code-researcher (ast-grep usage pattern): `plugins/yellow-research/agents/research/code-researcher.md`
- uv Python management docs: https://docs.astral.sh/uv/guides/install-python/
- uv GitHub issue #8206: `uvx` doesn't read `.python-version` from git source
- uv GitHub issue #10916: `requires-python` causes resolution failure, not auto-download
- uv GitHub issue #17051: `python-downloads = "manual"` error message and quoting bug
- ast-grep Rule Essentials: https://ast-grep.github.io/guide/rule-config.html
- ast-grep Rule Cheat Sheet: https://ast-grep.github.io/cheatsheet/rule.html
- ast-grep TypeScript Catalog: https://ast-grep.github.io/catalog/typescript/
- uv Storage Reference: https://docs.astral.sh/uv/reference/storage/

<!-- deepen-plan: external -->
> **Research:** Additional platform notes: (1) Only `https:`, `ssh:`, and
> `file:` git URL schemes are supported in uv >= 0.7.x — `git://` was removed.
> Not an issue for the `git+https://` URL used here. (2) If the target repo
> uses git-lfs, `--lfs` flag may be needed. (3) Python build-standalone
> distributions are frozen per uv release — updating uv may change which
> 3.13.x patch gets downloaded (generally fine). (4) The `ast-grep-mcp` package
> at commit `674272f` should be periodically checked for newer versions that may
> lower the Python requirement or add features.
<!-- /deepen-plan -->
