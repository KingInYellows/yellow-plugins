# Feature: Ruvector Reliability Fix (Belt and Suspenders)

## Problem Statement

The error "Knowledge Compounding -- Skipped -- ruvector recall not available"
appears across all workflows (brainstorm, plan, work, compound, review). Three
independent failure modes cause this:

1. **npx latency (1,869ms)** exceeds hook timeout budgets (1s for most hooks),
   making 3 of 5 hooks always skip and a 4th marginal
2. **MCP cold start (300-1500ms)** causes first tool calls to fail silently
3. **No retry logic** means a single MCP failure skips memory operations entirely

Without the global binary, memory injection (recall) and learning capture
(remember) have been effectively non-functional across the plugin ecosystem.

<!-- deepen-plan: external -->
> **Research:** The MCP specification defines a structured initialization
> handshake (initialize → InitializeResult → initialized → tool calls) but does
> NOT mandate timing constraints for initialization responses. There is no
> built-in health check or warmup mechanism in the protocol itself — timeout
> handling is left to the client. The community pattern of "call a cheap tool
> first" is the emerging de facto best practice for absorbing cold start.
> See: https://modelcontextprotocol.io/docs/learn/architecture
<!-- /deepen-plan -->

## Current State

- `ruvector` is not installed globally; all calls go through `npx` (1,869ms overhead)
- `install.sh` verifies with `npx ruvector --version` (false positive for global binary)
- `setup.md` treats missing global binary as a warning, not a failure
- `mcp-integration-patterns` SKILL.md has no warmup or retry logic
- All 6 consuming workflow commands inline the recall/remember patterns (no `<skill>` tag mechanism)
- `hooks_capabilities` is not used anywhere in the codebase

<!-- deepen-plan: codebase -->
> **Codebase:** All plan claims about current state confirmed accurate.
> `install.sh` line 121 uses `npx ruvector --version`; `setup.md` lines 99-101
> and 127-129 produce warning text only; SKILL.md Patterns 1 and 2 both skip
> immediately on MCP error with no retry. `hooks_capabilities` returns zero
> matches across the entire codebase outside plan/brainstorm docs.
<!-- /deepen-plan -->

## Proposed Solution

Three-layer fix per the brainstorm's Approach B:

1. **Layer 1 (Setup):** Make `install.sh` and `setup.md` ensure the global
   binary is installed and in PATH, treating failure as a hard stop
2. **Layer 2 (Warmup):** Add `hooks_capabilities` warmup call to absorb MCP
   cold start before real recall/remember calls
3. **Layer 3 (Retry):** Add retry-once with 500ms pause on MCP execution errors

<!-- deepen-plan: external -->
> **Research:** For SKILL.md retry instructions, research shows the highest
> agent compliance when you: (1) name specific failure types that trigger retry
> (timeout, connection refused — not just "if it fails"), (2) specify exact
> attempt count ("retry exactly once"), (3) use concrete time values ("wait 500
> milliseconds"), (4) list what NOT to retry (validation errors, parameter
> errors), and (5) explicitly forbid fallbacks ("Do NOT attempt alternative
> approaches"). Consider a reusable "MCP Tool Reliability" prose block at the
> top of each command file. Note: agents cannot literally sleep 500ms — the
> delay is approximate via tool call sequencing.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Setup Fix (Layer 1)

- [ ] 1.1: Update `plugins/yellow-ruvector/scripts/install.sh`
  - After `npm install -g ruvector --ignore-scripts`, verify with `command -v ruvector` (not `npx`)
  - On permission failure, retry with `--prefix ~/.local`
  - If `~/.local/bin` not in PATH, add to shell profile (`~/.bashrc`, `~/.zshrc`)
  - Export PATH immediately so subsequent commands in same session work
  - Final verification: `command -v ruvector` must succeed or script exits 1
  - Replace line 121 `npx ruvector --version` verification with `ruvector --version`

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed install.sh lines 102-114 already try `--prefix ~/.local`
> on permission failure and warn about PATH, but do NOT modify the shell profile
> or export PATH. The script warns: `"Installed to ~/.local — ensure ~/.local/bin
> is in your PATH"` and `"Add to your shell profile: export PATH=\"$HOME/.local/bin:$PATH\""`.
> The fix should use `npm bin -g` to detect the actual install directory rather
> than assuming `~/.local/bin`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Use `npm bin -g` (canonical npm command) to detect where global
> binaries are installed. For PATH fixing, the recommended pattern is hybrid:
> modify rc file for persistence AND `export PATH` for the current session.
> Detect shell via `$ZSH_VERSION` / `$BASH_VERSION` and write to the appropriate
> rc file (`~/.zshrc`, `~/.bashrc`, `~/.profile`). Check `grep -q` before
> appending to avoid duplicates.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** IMPORTANT — `install.sh` runs in a subshell via
> `bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"` from setup.md. Any `export PATH`
> in install.sh will NOT propagate to the parent session. The install script
> must either: (a) print the export command for the user to run, or (b) write
> to the rc file so the next session picks it up, or (c) setup.md should
> `source` the script instead of `bash`-ing it. Option (b) is the most reliable.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** nvm and fnm detected. Global npm binaries are per-Node-version
> with these managers. If `$NVM_DIR` or `$FNM_USING_NODE` is set, warn users
> that global installs are version-specific. The fnm multishell path
> (`/run/user/*/fnm_multishells/*/bin`) may not persist across shell restarts.
> For CLI tools needed everywhere, prefer a dedicated install prefix pinned to
> one Node version.
<!-- /deepen-plan -->

- [ ] 1.2: Update `plugins/yellow-ruvector/commands/ruvector/setup.md`
  - Step 3 verification: treat missing global binary as a **failure**, not a warning
  - Add smoke test: `timeout 1 ruvector hooks recall --top-k 1 "setup-test"` must complete within 1s
  - Report table should show "Global binary" as REQUIRED
  - If binary not found after install step, show remediation instructions and stop

<!-- deepen-plan: codebase -->
> **Codebase:** Setup convention across the monorepo is "collect-all-then-stop":
> yellow-ci, yellow-morph, and yellow-devin all collect ALL missing prerequisites
> and report together before stopping. yellow-ruvector is the outlier — it warns
> but continues. The fix should follow the established collect-then-stop pattern.
<!-- /deepen-plan -->

### Phase 2: Integration Pattern Hardening (Layers 2 & 3)

- [ ] 2.1: Update `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md` Pattern 1 (Recall-Before-Act)
  - Add warmup step between ToolSearch and real call:
    ```
    2. Call ToolSearch("hooks_recall"). If not found: skip.
    3. NEW: Warmup -- call hooks_capabilities(). If error: note warning, skip.
    4. Call hooks_recall(query, top_k=5)
    5. If MCP execution error (timeout, connection refused, service unavailable):
       wait 500 milliseconds, retry exactly once. If retry fails: skip.
       Do NOT retry on validation errors or parameter errors.
    ```
  - Document rationale: warmup absorbs 300-1500ms MCP cold start

- [ ] 2.2: Update SKILL.md Pattern 2 (Tiered-Remember-After-Act)
  - Add retry-once with 500ms pause to `hooks_remember` execution:
    ```
    If hooks_remember errors with timeout or connection error:
    wait 500 milliseconds, retry exactly once. If retry fails: skip silently.
    Do NOT retry on validation errors.
    ```
  - Add retry-once to dedup check `hooks_recall` call as well
  - Note: warmup is NOT needed for Pattern 2 if Pattern 1 already ran in the same session (MCP server is warm)

<!-- deepen-plan: codebase -->
> **Codebase:** The SKILL.md header says: "When updating parameters (top_k,
> score cutoff, char limits), update this document AND all consuming commands:
> brainstorm.md, plan.md, compound.md, work.md, review-pr.md, resolve-pr.md."
> Since commands inline the patterns (no `<skill>` tag mechanism), the warmup
> and retry changes must be manually propagated to each of the consuming files.
> Consider adding a "## MCP Tool Reliability" named section to the SKILL.md
> that commands can reference, reducing copy-paste drift over time.
<!-- /deepen-plan -->

### Phase 3: Propagate to Consuming Commands (Layer 4)

All 7 commands inline the recall/remember patterns. Each needs:
(a) `hooks_capabilities` added to `allowed-tools`
(b) Warmup step added before first `hooks_recall` call
(c) Retry-once added to `hooks_recall` and `hooks_remember` error handling

- [ ] 3.1: Update `plugins/yellow-core/commands/workflows/brainstorm.md`
  - Add `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities` to allowed-tools
  - Add warmup call after ToolSearch (before recall)
  - Change "If MCP execution error, skip to Delegate" to retry-once then skip

- [ ] 3.2: Update `plugins/yellow-core/commands/workflows/plan.md`
  - Add `hooks_capabilities` to allowed-tools
  - Add warmup call after ToolSearch
  - Change "If MCP error, skip" to retry-once then skip

- [ ] 3.3: Update `plugins/yellow-core/commands/workflows/work.md`
  - Add `hooks_capabilities` to allowed-tools
  - Add warmup before Step 2b recall call
  - Add retry-once to Step 2b recall and Phase 4 Step 7 remember
  - Add retry-once to Step 7 dedup check

- [ ] 3.4: Update `plugins/yellow-core/commands/workflows/compound.md`
  - Add `hooks_capabilities` to allowed-tools
  - Add warmup before Step 3 remember flow (since compound may not have a prior recall)
  - Add retry-once to dedup check and remember call

- [ ] 3.5: Update `plugins/yellow-review/commands/review/review-pr.md`
  - Add `hooks_capabilities` to allowed-tools
  - Add warmup before Step 3b recall call
  - Add retry-once to Step 3b recall and Step 9b remember
  - Add retry-once to Step 9b dedup check

- [ ] 3.6: Update `plugins/yellow-review/commands/review/resolve-pr.md`
  - Add `hooks_capabilities` to allowed-tools
  - Add warmup before Step 3b recall call
  - Add retry-once to Step 3b recall error handling

- [ ] 3.7: Update `plugins/yellow-review/commands/review/review-all.md`
  - Add `hooks_capabilities` to allowed-tools
  - Add warmup before inline review:pr recall flow
  - Add retry-once to recall error handling

<!-- deepen-plan: codebase -->
> **Codebase:** MISSING FILE — `review-all.md` (at
> `plugins/yellow-review/commands/review/review-all.md`) was not in the original
> plan. It includes `hooks_recall` in allowed-tools (line 15) and runs the
> review:pr flow inline (line 77-78: "Run the full /review:pr flow inline, not
> as command invocation"). Since it re-executes review:pr logic directly rather
> than delegating via Skill, it needs its own warmup/retry instructions.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** SCOPE DECISION NEEDED — Five additional yellow-ruvector-internal
> files use hooks_recall/hooks_remember but are NOT covered by this plan:
> `commands/ruvector/search.md`, `commands/ruvector/learn.md`,
> `commands/ruvector/memory.md`, `commands/ruvector/index.md`, and
> `agents/ruvector/memory-manager.md`. These are invoked after `/ruvector:setup`
> (so global binary should be present), but still face MCP cold start.
> Recommendation: exclude from this plan since setup ensures the binary, and
> these commands are ruvector-native (users expect to run setup first). Add a
> note that a follow-up pass could harden these if cold start remains an issue.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** CONTRADICTION — The `memory-manager.md` agent at
> `plugins/yellow-ruvector/agents/ruvector/memory-manager.md` line 55 explicitly
> states "Do not retry." The plan's retry-once proposal for `hooks_remember`
> calls conflicts with this instruction. Resolution: the retry-once pattern
> in `mcp-integration-patterns` applies to workflow commands (brainstorm, plan,
> work, etc.) that call hooks_remember. The memory-manager agent's no-retry
> policy should be preserved since it has different error semantics (it surfaces
> errors to the user rather than skipping silently).
<!-- /deepen-plan -->

### Phase 4: Validation

- [ ] 4.1: Run `pnpm validate:schemas` to verify all modified plugin manifests
- [ ] 4.2: Manual smoke test: run `/ruvector:setup` and verify global binary install
- [ ] 4.3: Manual smoke test: run `/workflows:brainstorm` on a test topic and verify recall succeeds (no "Skipped" message)
- [ ] 4.4: Manual smoke test: run `/workflows:compound` and verify remember succeeds

## Technical Details

### Files to Modify

| # | File | Plugin | Change |
|---|---|---|---|
| 1 | `plugins/yellow-ruvector/scripts/install.sh` | yellow-ruvector | `command -v` verification, PATH fix, hard failure |
| 2 | `plugins/yellow-ruvector/commands/ruvector/setup.md` | yellow-ruvector | Hard failure on missing binary, smoke test |
| 3 | `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md` | yellow-core | Warmup + retry-once in Patterns 1 and 2 |
| 4 | `plugins/yellow-core/commands/workflows/brainstorm.md` | yellow-core | allowed-tools + warmup + retry |
| 5 | `plugins/yellow-core/commands/workflows/plan.md` | yellow-core | allowed-tools + warmup + retry |
| 6 | `plugins/yellow-core/commands/workflows/work.md` | yellow-core | allowed-tools + warmup + retry (recall + remember) |
| 7 | `plugins/yellow-core/commands/workflows/compound.md` | yellow-core | allowed-tools + warmup + retry |
| 8 | `plugins/yellow-review/commands/review/review-pr.md` | yellow-review | allowed-tools + warmup + retry (recall + remember) |
| 9 | `plugins/yellow-review/commands/review/resolve-pr.md` | yellow-review | allowed-tools + warmup + retry |
| 10 | `plugins/yellow-review/commands/review/review-all.md` | yellow-review | allowed-tools + warmup + retry |

### Plugins Affected

Three plugins are touched: `yellow-ruvector` (setup), `yellow-core` (patterns + 4 commands), `yellow-review` (3 commands). Each will need a changeset.

## Acceptance Criteria

- `ruvector:setup` installs the global binary and fails if it cannot
- `command -v ruvector` succeeds after setup completes
- `ruvector hooks recall --top-k 1 "test"` completes in under 1 second
- Workflows that use recall no longer show "Skipped -- ruvector recall not available"
- MCP cold start is absorbed by `hooks_capabilities` warmup before first real call
- Transient MCP failures are retried once (500ms pause) before skipping
- All existing recall/remember behavior is preserved (score filtering, truncation, XML sanitization)

## Edge Cases

- **npm permissions failure:** `install.sh` falls back to `--prefix ~/.local` and configures PATH
- **PATH not updated in current session:** Script exports PATH immediately, not just in profile
- **MCP server never starts:** Warmup call fails, retry fails, workflow skips gracefully (existing behavior)
- **ruvector already installed globally:** `install.sh` should detect and skip reinstall
- **Warmup succeeds but recall fails:** Retry-once handles this; if retry also fails, skip gracefully

<!-- deepen-plan: codebase -->
> **Codebase:** Additional edge case — `session-start.sh` already calls
> `hooks session-start` and `hooks recall` at session start (3s budget). With
> the global binary (81ms), this warms the CLI backend. However, this does NOT
> warm the MCP server — CLI and MCP are separate processes. The plan correctly
> targets MCP warmup via `hooks_capabilities` in workflow commands.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Additional edge case — nvm/fnm per-version isolation means the
> global binary installed under one Node version may disappear after `nvm use`
> or shell restart with a different default. Install scripts should detect
> `$NVM_DIR` or `$FNM_USING_NODE` and warn users. The fnm multishell path
> (`/run/user/*/fnm_multishells/*/bin`) is session-specific and won't persist.
<!-- /deepen-plan -->

## References

- Brainstorm: `docs/brainstorms/2026-03-05-ruvector-reliability-brainstorm.md`
- Integration patterns skill: `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md`
- Install script: `plugins/yellow-ruvector/scripts/install.sh`
- Setup command: `plugins/yellow-ruvector/commands/ruvector/setup.md`

<!-- deepen-plan: external -->
> **Research:** External references consulted:
> - [MCP Architecture spec](https://modelcontextprotocol.io/docs/learn/architecture) — initialization handshake, no built-in warmup
> - [npm bin docs](https://docs.npmjs.com/cli/v8/commands/npm-bin/) — canonical global binary directory detection
> - [npm folders docs](https://docs.npmjs.com/cli/v10/configuring-npm/folders/) — prefix configuration hierarchy
> - [global-directory](https://github.com/sindresorhus/global-directory) — JS API for `npm bin -g`
> - [MCP Server Performance Benchmark](https://www.tmdevlab.com/mcp-server-performance-benchmark.html) — cold start latency data across languages
> - [AI Agent retry patterns](https://fast.io/resources/ai-agent-retry-patterns/) — wording reliability for retry instructions in agent prompts
<!-- /deepen-plan -->
