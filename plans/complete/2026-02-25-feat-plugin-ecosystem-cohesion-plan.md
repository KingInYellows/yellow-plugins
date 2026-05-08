# Feature: Plugin Ecosystem Cohesion & Structural Fixes

## Enhancement Summary

**Deepened on:** 2026-02-25
**Sections enhanced:** 8 PRs across 4 phases
**Research agents used:** 15 (hook-development, agent-development, command-development,
bash-defensive-patterns, debt-conventions, create-agent-skills, architecture-strategist,
security-sentinel, spec-flow-analyzer, performance-oracle, best-practices-researcher ×2,
plus 4 learnings-based agents)

### Key Improvements

1. **CRITICAL SECURITY (PR 5):** PostToolUse hooks receive `.tool_input.command` not `.command`
   (which is PreToolUse schema). Plan used wrong JSON path. Also, JSON output via `printf`
   allows injection from commit messages — must use `jq -n --arg`.
2. **FUNDAMENTAL ARCHITECTURE (PR 6):** Triage loop written as bash but uses `AskUserQuestion`
   (an LLM tool, not a shell function). Must be prose instructions to Claude. Counting variables
   as bash vars don't persist across Bash tool calls (each is a separate subprocess).
3. **SRP VIOLATION (PR 3):** ruvector `hooks_remember` inside knowledge-compounder creates
   yellow-core→yellow-ruvector coupling. Move ruvector integration to yellow-ruvector's CLAUDE.md.
4. **WRONG DIRECTORY (PR 4):** Plan says check `.debt/` but todo files are in `todos/debt/`.
   `.debt/` is only scanner output.
5. **DUAL FILE BUG (PR 1):** Timeout bug exists in BOTH `plugin.json` AND `hooks/hooks.json`.
6. **BROKEN HANDOFFS (PRs 7-8):** `workflows:work` requires explicit file path; `research:deep →
   brainstorm` has no mechanism; `chatprd:setup` missing from Product→Code chain.

### New Considerations Discovered

- `exit 1` in Bash does NOT stop the LLM — add explicit prose after every error path
- Injection fencing requires 4-component sandwich (advisory + begin + content + end + re-anchor)
- M3 cancel paths must have explicit handlers — LLM invents behavior for undefined branches
- Post-Write existence checks required after every critical file creation
- `grep -oP` not portable — use `grep -oE` for POSIX compatibility
- Commands that delegate entirely to agents need only `[Bash, Task]` in allowed-tools
- `ToolSearch` is mandatory in allowed-tools for any agent using deferred MCP tools

---

## Problem Statement

The yellow-plugins ecosystem (11 plugins, 56 commands, 43 agents) has grown organically across
60+ PRs. Individual plugins are solid, but cross-plugin seams have friction: a 50-minute timeout
bug, ghost agent references, duplicate learning codepaths, incomplete command implementations, and
no user-facing workflow documentation. This plan fixes the structural issues and produces workflow
guides.

## Current State

- **Correctness bugs**: yellow-ci SessionStart timeout is 3000 (seconds, not ms) = 50 minutes
- **Ghost agents**: `pattern-recognition-specialist` and `agent-native-reviewer` referenced in
  yellow-review but have no `.md` files anywhere
- **Duplicate learning**: `learning-compounder` (yellow-review) and `/workflows:compound`
  (yellow-core) both write to `docs/solutions/` and MEMORY.md
- **Incomplete implementations**: `/debt:triage` has placeholder printf instead of AskUserQuestion;
  counting variables never incremented; defer path has no schema support
- **Hook gaps**: Only 3/11 plugins have hooks; no debt awareness or commit validation
- **No workflow documentation**: Users discover command chains by trial and error

## Proposed Solution

9 PRs in dependency order, grouped into 4 phases:

- **Phase 1**: One-line correctness fixes (D1, D6, D8)
- **Phase 2**: Agent architecture (D2 + D4 combined — consolidation + compound agent extraction)
- **Phase 3**: Hook additions + command completion (D5, D7)
- **Phase 4**: Documentation (D10)

## Implementation Plan

### Phase 1: Quick Correctness Fixes

**PR 1: Fix yellow-ci timeout + SessionStart ordering docs + browser-test branch handler**

These are independent one-liner changes that can ship together.

- [ ] **1.1** Edit `plugins/yellow-ci/.claude-plugin/plugin.json` line 22:
  change `"timeout": 3000` to `"timeout": 3`
- [ ] **1.2** Also fix `plugins/yellow-ci/hooks/hooks.json` — same `"timeout": 3000` → `3`
- [ ] **1.3** Add independence comment to `plugins/yellow-ci/hooks/scripts/session-start.sh` header:
  `# NOTE: SessionStart hooks run in parallel across plugins. This hook must be independent.`
- [ ] **1.4** Add same comment to `plugins/yellow-ruvector/hooks/scripts/session-start.sh` header
- [ ] **1.5** Edit `plugins/yellow-browser-test/agents/testing/test-reporter.md` Step 4:
  add explicit handler for "Let me review the report first" option — output the report file path
  and instruct: "When user is ready, re-run with the findings to create issues"
- [ ] **1.6** Remove `changelog` key from any plugin.json that has it (remote validator rejects it
  — see `docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md`)
- [ ] **1.7** Run `pnpm validate:schemas` to verify no schema regressions

**Files:**
- `plugins/yellow-ci/.claude-plugin/plugin.json`
- `plugins/yellow-ci/hooks/hooks.json`
- `plugins/yellow-ci/hooks/scripts/session-start.sh`
- `plugins/yellow-ruvector/hooks/scripts/session-start.sh`
- `plugins/yellow-browser-test/agents/testing/test-reporter.md`

### Research Insights (PR 1)

**Hook Development Skill Findings:**
- SessionStart hooks run in parallel across plugins — "ordering" is a misnomer. Use
  "independence comment" instead, since there is no ordering to document
- `hooks.json` and `plugin.json` can diverge — always update both when changing hook config
- Hook timeout unit is seconds (not milliseconds). 3000 seconds = 50 minutes is the actual bug

**CI Schema Drift Learnings:**
- Two-validator problem: local CI schema and Claude Code remote validator can diverge. After
  fixing plugin.json, immediately verify with `pnpm validate:schemas` AND test a fresh install
- `changelog` key is NOT recognized by remote validator — remove it from all plugin.json files

**Edge Cases:**
- If `hooks.json` exists but `plugin.json` doesn't define hooks inline, behavior is undefined.
  Ensure both files are consistent or remove `hooks.json` if plugin.json has inline hooks

---

### Phase 2: Agent Architecture

**PR 2: Create pattern-recognition-specialist + consolidate agent references**

Create the missing agent, drop `agent-native-reviewer`, and update all
`compound-engineering:review:*` references to use yellow-core agents.

- [ ] **2.1** Verify yellow-core's `plugin.json` `name` field value before writing `subagent_type`
  references — the Task tool format is `<plugin-name>:<subdir>:<agent-name>` where plugin-name
  comes from `plugin.json` `name:` field
- [ ] **2.2** Create `plugins/yellow-core/agents/review/pattern-recognition-specialist.md`
  - Color: yellow, Model: inherit
  - Focus: code duplication, near-duplicates, anti-pattern detection, naming convention violations
  - Optimize for plugin authoring context (CLAUDE.md patterns, conventional commits, hook patterns)
  - Include in `allowed-tools`: Grep, Glob, Read, Bash (NO Write — this is read-only analysis)
  - Include CRITICAL SECURITY RULES block (per PR #56 pattern across yellow-review agents)
  - Hardcode MEMORY.md anti-pattern table inline (don't reference external files)
  - Target ~180 lines (under 200-line quality threshold)
- [ ] **2.3** Update `plugins/yellow-review/skills/pr-review-workflow/SKILL.md`:
  - Lines 198-202: change `compound-engineering:review:<name>` to `yellow-core:review:<name>`
    (which maps to agent `name:` field — verify the exact Task subagent_type format)
  - Lines 79-85: remove `agent-native-reviewer` selection rule
  - Verify all remaining agent names match yellow-core's `name:` frontmatter values
- [ ] **2.4** Update `plugins/yellow-review/commands/review/review-pr.md`:
  - Line 76 area: update cross-plugin agent Task spawning to use yellow-core names
  - Remove `agent-native-reviewer` from the agent selection list
- [ ] **2.5** Update `plugins/yellow-review/CLAUDE.md` cross-plugin agent section:
  - Change "available via Compound Engineering plugin" to "available via yellow-core plugin"
  - Document: "yellow-review requires yellow-core for full review coverage. Without it,
    cross-plugin agents (security-sentinel, architecture-strategist, performance-oracle,
    pattern-recognition-specialist) silently degrade."
- [ ] **2.6** Run cascade grep before executing: `rg 'compound-engineering:review' plugins/` to
  find ALL references, not just the ones listed above
- [ ] **2.7** Run `pnpm validate:schemas` + verify agent auto-discovery

**Files:**
- `plugins/yellow-core/agents/review/pattern-recognition-specialist.md` (new)
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md`
- `plugins/yellow-review/commands/review/review-pr.md`
- `plugins/yellow-review/CLAUDE.md`

### Research Insights (PR 2)

**Agent Development Skill Findings:**
- Agent description MUST include 2-4 `<example>` blocks with `<commentary>` for reliable
  triggering — without these, Claude may not select the agent in ambiguous situations
- `color` field required: use yellow for analysis/validation agents (per color guidelines)
- `model: inherit` recommended unless agent needs specific capabilities
- CRITICAL SECURITY RULES block is mandatory for review agents (established pattern in PR #56)

**Architecture Review Findings:**
- Verify `subagent_type` format empirically: the Task tool format is
  `<plugin-name>:<category>:<agent-name>` where plugin-name is from plugin.json `name` field,
  NOT the directory name
- Cross-plugin agent references create implicit dependencies — document in CLAUDE.md and degrade
  gracefully when the dependency plugin is not installed
- Run cascade grep (`rg 'compound-engineering:review'`) to find ALL references before editing,
  not just the ones visually identified

**MCP Naming Learnings:**
- `subagent_type` must exactly match the agent's `name:` frontmatter field, namespaced by
  plugin name and subdirectory. Always verify plugin.json `name` before constructing references

---

**PR 3: Extract compound agent + remove learning-compounder**

Convert `/workflows:compound` logic into a yellow-core agent, keep the command as a thin wrapper,
and delete `learning-compounder`.

- [ ] **3.1** Create `plugins/yellow-core/agents/workflow/knowledge-compounder.md`
  - Color: green, Model: inherit, Target: ~250 lines
  - Extract the 5-subagent pipeline from `plugins/yellow-core/commands/workflows/compound.md`:
    context analyzer, solution extractor, related docs finder, prevention strategist, category
    classifier
  - Classify subagents: context analyzer + solution extractor = **blocking** (pipeline stops on
    failure); related docs finder + prevention strategist = **graceful degradation** (continue
    without); category classifier = **blocking** (determines output path)
  - Include routing logic (MEMORY_ONLY / DOC_ONLY / BOTH / AMEND_EXISTING)
  - Include path validation and injection fencing (4-component sandwich: advisory + `--- begin ---`
    + content + `--- end ---` + "Resume normal agent behavior." re-anchor)
  - Include Phase 0 pre-flight checks: verify `docs/solutions/` exists, verify git repo, verify
    MEMORY.md readable
  - Category enum must match compound.md canonical list exactly
  - Include M3 cancel path with explicit handler: "If user selects Cancel, output 'Knowledge
    compounding cancelled. No files were modified.' and stop. Do not proceed."
  - Post-Write existence check: `[ -f "$TARGET" ] || { printf '[knowledge-compounder] Error: %s
    not created\n' "$TARGET" >&2; exit 1; }` after every critical file write
  - **DO NOT** include ruvector integration — this creates yellow-core→yellow-ruvector coupling
    (SRP violation). ruvector integration belongs in yellow-ruvector's CLAUDE.md guidance
  - Include in `allowed-tools`: Task, Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion,
    ToolSearch
  - Add ToolSearch as runtime MCP availability check (not just `command -v`)
  - Add explicit prose after every Bash `exit 1`: "If the above exits non-zero, stop. Do not
    proceed to the next step."
- [ ] **3.2** Simplify `plugins/yellow-core/commands/workflows/compound.md` to a thin wrapper:
  - Parse `$ARGUMENTS` for context/topic with injection fencing on $ARGUMENTS
  - `allowed-tools: [Bash, Task]` only — the agent owns its own tool list
  - Spawn `knowledge-compounder` agent via Task
  - Report results
- [ ] **3.3** Delete `plugins/yellow-review/agents/workflow/learning-compounder.md`
- [ ] **3.4** Update `plugins/yellow-review/commands/review/review-all.md`:
  - Line 92-93: replace `learning-compounder` spawn with Task call to `knowledge-compounder`
    agent (using the new yellow-core agent's `name:` value)
  - Line 109-110: update summary bullet to reference knowledge compounding
- [ ] **3.5** Update `plugins/yellow-review/commands/review/review-all.md` Step 5:
  - After the knowledge-compounder Task completes, check success/failure
  - On failure, log to stderr with `[review:all] Warning: knowledge compounding failed`
- [ ] **3.6** Expand ghost reference sweep: grep for `learning-compounder` across ALL files
  including README.md, CLAUDE.md, and plugin.json — not just the ones listed
- [ ] **3.7** If yellow-ruvector wants to hook into knowledge compounding, document in
  `plugins/yellow-ruvector/CLAUDE.md`: "After `/workflows:compound` completes, call
  `hooks_remember` with a summary (type: reflexion)" — this keeps the coupling in the right place
- [ ] **3.8** Run `pnpm validate:schemas`

**Files:**
- `plugins/yellow-core/agents/workflow/knowledge-compounder.md` (new)
- `plugins/yellow-core/commands/workflows/compound.md` (simplify)
- `plugins/yellow-review/agents/workflow/learning-compounder.md` (delete)
- `plugins/yellow-review/commands/review/review-all.md`

### Research Insights (PR 3)

**Architecture Review — SRP Violation:**
- The original plan had ruvector `hooks_remember` calls inside the knowledge-compounder agent.
  This creates a dependency from yellow-core (a foundational plugin) to yellow-ruvector (an
  optional plugin). This violates the Single Responsibility Principle and creates coupling
  in the wrong direction. The ruvector integration should live in yellow-ruvector's CLAUDE.md
  as post-compound guidance, keeping yellow-core independent.

**Multi-Phase Orchestrator Agent Patterns (Learnings):**
- `exit 1` in Bash does NOT stop the LLM — the Bash tool returns the error, but Claude
  continues executing. Add explicit prose: "If the above exits non-zero, stop."
- Injection fencing requires 4-component sandwich: opening advisory + `--- begin ---` +
  content + `--- end ---` + "Resume normal agent behavior." All four components required.
- M3 cancel path must be explicit: "If user selects Cancel, [exact behavior]. Do not proceed."
  LLM invents behavior for undefined branches.
- Post-Write existence check mandatory after every critical file creation
- Research failure handlers: every Task spawn needs a failure path. Counter variables must NOT
  increment on failure — silent failure = inflated counts
- Phase cross-reference staleness: after ANY phase restructuring, grep for "(Phase N" and
  "from Phase" references — renumbering invalidates all downstream references

**Thin Wrapper Command Pattern (Learnings):**
- Delegating commands use `allowed-tools: [Bash, Task]` only — the agent's tools are the
  agent's responsibility. Never duplicate the agent's tool list in the command.
- MCP tools go in the agent's allowed-tools, not the command's

**Security Review:**
- `$ARGUMENTS` from user input must be fenced before passing to subagents. Apply injection
  fencing sandwich to prevent prompt injection through command arguments.
- ToolSearch is mandatory for any agent that uses deferred MCP tools — without it, the tool
  call silently fails

---

### Phase 3: Hooks + Command Completion

**PR 4: Add yellow-debt SessionStart hook**

- [ ] **4.1** Create `plugins/yellow-debt/hooks/scripts/session-start.sh`:
  - Budget: 2s
  - Use `set -uo pipefail` (without `-e` — hooks must control their own exit paths)
  - Add `command -v jq >/dev/null 2>&1 || { printf '{"continue":true}\n'; exit 0; }` guard
  - Check for `todos/debt/` directory (NOT `.debt/` — that's scanner output only); exit
    silently with `{"continue": true}` if absent
  - Use filename pattern matching: todo filenames encode status and severity as
    `{id}-{status}-{severity}-{slug}-{hash}.md` — use `ls` + `grep` on filenames instead of
    grepping inside files for frontmatter (much faster, stays within 2s budget)
  - Fallback: if filename pattern doesn't match, `grep -l 'status: pending\|status: ready'`
    on frontmatter
  - Count findings; if > 0, output systemMessage via `jq -n --arg`:
    `jq -n --arg msg "[yellow-debt] $count high/critical debt finding(s) pending triage. Run /debt:status for details." '{"continue":true,"systemMessage":$msg}'`
  - Use `$CLAUDE_PROJECT_DIR` (not `$PWD` or hardcoded paths) for portable path construction
  - All error paths exit `{"continue": true}` silently with component-prefixed stderr logging:
    `printf '[yellow-debt] Error: %s\n' "description" >&2`
  - CRLF normalization: `sed -i 's/\r$//'` after creating the script (WSL2 Write tool issue)
- [ ] **4.2** Update `plugins/yellow-debt/.claude-plugin/plugin.json`:
  - Add `"hooks"` section with inline SessionStart definition
  - Timeout: 2 (seconds)
  - Matcher: `"*"`
- [ ] **4.3** Also create/update `plugins/yellow-debt/hooks/hooks.json` to match plugin.json
  (keep both files consistent)
- [ ] **4.4** Run `pnpm validate:schemas` (verify hooks schema accepts inline format)

**Files:**
- `plugins/yellow-debt/hooks/scripts/session-start.sh` (new)
- `plugins/yellow-debt/.claude-plugin/plugin.json`
- `plugins/yellow-debt/hooks/hooks.json` (new)

### Research Insights (PR 4)

**Bash Defensive Patterns Skill:**
- `set -uo pipefail` without `-e` for hooks — hooks must control their own exit to always
  return valid JSON. `-e` would cause uncontrolled exits without JSON output.
- Always `jq -n --arg` for JSON construction — never `printf '{"key":"%s"}'` which allows
  injection from variable content
- Use `${CLAUDE_PROJECT_DIR}` for portable paths, not `$PWD` or hardcoded paths

**Debt Conventions Skill — Wrong Directory:**
- The plan originally said check for `.debt/` directory, but `.debt/` contains only scanner
  output (`scanner-output/<category>-scanner.json`). The actual todo files with status/severity
  frontmatter live in `todos/debt/*.md`. The hook must check `todos/debt/`, not `.debt/`.

**Performance Review:**
- Filename pattern matching (`ls | grep`) is O(n) on filenames vs grepping inside each file
  O(n×m). For 200+ todo files within a 2s budget, filename matching is significantly faster.
- Todo filenames encode `{id}-{status}-{severity}-{slug}-{hash}.md` — use this for filtering
  without opening files

**CI Schema Drift Learnings:**
- `hooks.json` and `plugin.json` can have different schemas — local CI validates one way,
  remote validates another. Always keep both files consistent.
- Test with `pnpm validate:schemas` AND a fresh plugin install

**Shell Security Patterns:**
- CRLF on WSL2: Files created via Write tool get CRLF line endings. Always run
  `sed -i 's/\r$//'` after creating `.sh` files
- Never put variables in `printf` format string: `printf '%s' "$var"` not `printf "$var"`

---

**PR 5: Add gt-workflow PostToolUse commit validation hook**

- [ ] **5.1** Create `plugins/gt-workflow/hooks/check-commit-message.sh`:
  - Budget: 50ms (no network, no file I/O beyond stdin)
  - Use `set -uo pipefail` (without `-e`)
  - Read stdin JSON, extract `.tool_input.command` (**NOT `.command`** — PostToolUse schema
    nests the command under `tool_input`; `.command` is PreToolUse schema)
  - Also check `.tool_result.exit_code` — skip validation if command failed (exit code != 0)
  - Match only commands containing `gt modify` or `gt commit` (not `git commit` — that's blocked
    by the PreToolUse hook)
  - Extract first `-m` flag value only with `grep -oE` (**NOT `grep -oP`** — `-P` (PCRE) is
    not portable across all systems; `-E` (extended regex) is POSIX-compatible)
  - Check for conventional commit prefix:
    `feat:|fix:|refactor:|docs:|test:|chore:|perf:|ci:|build:|revert:`
  - If no match and message was extractable: output static warn-only systemMessage via
    `jq -n --arg` (**never `printf`-interpolate** — commit messages can contain arbitrary
    characters including quotes and backslashes that break JSON):
    `jq -n '{"continue":true,"systemMessage":"[gt-workflow] Commit message does not follow conventional commits. Consider: gt modify -c -m \"type: description\""}'`
  - If parse fails or not a commit command: `{"continue": true}` silently
  - Never exit 2 (warn only, not blocking)
  - Bound stdin to 64KB: `head -c 65536` before parsing
  - CRLF normalization after creation
- [ ] **5.2** Update `plugins/gt-workflow/.claude-plugin/plugin.json`:
  - Add `"PostToolUse"` key alongside existing `"PreToolUse"`
  - Matcher: `"Bash"`
  - Add explicit `"timeout": 1` (1 second, generous for 50ms budget)
- [ ] **5.3** Update `plugins/gt-workflow/hooks/hooks.json` to match plugin.json
  - Document hook's role in hooks.json for discoverability
- [ ] **5.4** Run `pnpm validate:schemas`

**Files:**
- `plugins/gt-workflow/hooks/check-commit-message.sh` (new)
- `plugins/gt-workflow/.claude-plugin/plugin.json`
- `plugins/gt-workflow/hooks/hooks.json`

### Research Insights (PR 5)

**CRITICAL SECURITY — Wrong JSON Path:**
- PostToolUse hooks receive event data with the structure `{"tool_input": {"command": "..."},
  "tool_result": {"exit_code": 0, ...}}`. The command is at `.tool_input.command`, NOT
  `.command` (which is the PreToolUse schema). Using `.command` silently returns null and
  the hook never matches anything.

**CRITICAL SECURITY — JSON Injection:**
- Building JSON with `printf '{"systemMessage":"%s"}' "$msg"` allows JSON injection when the
  commit message contains `"`, `\`, or other JSON-special characters. Commit messages are
  untrusted user input. Must use `jq -n --arg msg "$msg" '{"continue":true,"systemMessage":$msg}'`
  which properly escapes all special characters.

**Hook Development Skill:**
- PostToolUse hooks fire AFTER tool execution — check `tool_result.exit_code` to skip
  validation on failed commands (no point warning about commit message format if the commit
  itself failed)
- Use static warning messages where possible to avoid injection surface. The commit message
  itself should NOT be included in the systemMessage output.
- Bound stdin with `head -c 65536` to prevent memory issues from unexpectedly large tool input

**Bash Defensive Patterns:**
- `grep -oP` (Perl regex) is not available on all systems (macOS, Alpine, some minimal
  containers). Use `grep -oE` (extended regex) for POSIX portability.
- First `-m` flag extraction: extract only the first `-m` value. `gt modify -c -m "subject"
  -m "body"` uses separate `-m` flags — validate only the subject line.

---

**PR 6: Complete /debt:triage AskUserQuestion flow**

This is the most complex single PR — it fixes 3 interrelated issues.

**FUNDAMENTAL ARCHITECTURE CORRECTION:** The triage loop CANNOT be a bash script that calls
`AskUserQuestion`. `AskUserQuestion` is an LLM tool (like Read, Write, Bash) — it is not a
shell function. The triage command must be written as **prose instructions to Claude**, not
bash code. Counting variables are **LLM context state**, not shell variables (shell variables
don't persist across separate Bash tool calls — each call is a new subprocess).

- [ ] **6.1** Update `plugins/yellow-debt/lib/validate.sh` `transition_todo_state()`:
  - Add optional 3rd argument for defer reason: `transition_todo_state <path> <state> [reason]`
  - When state is `deferred` and reason is provided, append `defer_reason: <reason>` and
    `defer_until: <date>` (optional) to the todo frontmatter
  - Validate defer_reason: reject newlines, cap 200 chars, use `yq` for YAML manipulation
    (not `printf` into frontmatter — malformed YAML risk)
  - Add `--flag` missing value guard:
    `[ -z "${2:-}" ] || printf '%s' "${2:-}" | grep -q '^--'`
  - Add `command -v yq` prerequisite check
  - Maintain backward compatibility: if no reason provided, transition without adding fields
- [ ] **6.2** Update `plugins/yellow-debt/skills/debt-conventions/SKILL.md`:
  - Add `defer_reason` and `defer_until` to the todo frontmatter schema documentation
  - Document the deferred state includes these optional fields
- [ ] **6.3** Rewrite `plugins/yellow-debt/commands/debt/triage.md` as **prose instructions**:
  - Remove Write from `allowed-tools` (triage reviews, does not create files)
  - Anchor `find` to git root: `find "$(git rev-parse --show-toplevel)/todos/debt" ...`
  - **Pre-loop overview (M3 pattern):** If >20 findings, first present count + severity
    breakdown via AskUserQuestion: "Found N findings (X critical, Y high, Z medium). Proceed
    with triage?" before entering the per-finding loop
  - **Per-finding loop** (prose, not bash):
    ```
    For each finding, sorted by severity (critical first, then high, medium, low):
    1. Read the todo file
    2. Present finding summary to user via AskUserQuestion with options:
       - "Accept — mark as ready for remediation"
       - "Reject — mark as false positive (will be deleted)"
       - "Defer — postpone with reason"
       - "Stop — end triage session"
       - "Back — revisit previous finding"
    3. On Accept: run `transition_todo_state "$path" ready` via Bash. Increment accepted count.
    4. On Reject: run `transition_todo_state "$path" deleted` via Bash. Increment rejected count.
    5. On Defer: ask for reason via free text prompt (prose directive, not second
       AskUserQuestion). Then run `transition_todo_state "$path" deferred "$reason"`.
       Increment deferred count.
    6. On Stop: break out of loop, proceed to summary.
    7. On Back: re-present the previous finding.
    ```
  - **Counting:** Maintain counts as context (the LLM tracks accepted/rejected/deferred counts
    naturally in its conversation context — no shell variables needed)
  - **Final summary:** Present totals: "Triage complete: N accepted, M rejected, P deferred.
    Run /debt:fix to begin remediation of accepted findings."
- [ ] **6.4** Fix line 33 `BASH_SOURCE[0]` anti-pattern: change to
  `${CLAUDE_PLUGIN_ROOT}/lib/validate.sh` per MEMORY.md conventions
- [ ] **6.5** Run `pnpm validate:schemas`

**Files:**
- `plugins/yellow-debt/lib/validate.sh`
- `plugins/yellow-debt/skills/debt-conventions/SKILL.md`
- `plugins/yellow-debt/commands/debt/triage.md`

### Research Insights (PR 6)

**FUNDAMENTAL — Triage Loop Cannot Be Bash:**
- The original plan wrote the triage loop as a bash script with `AskUserQuestion` calls.
  `AskUserQuestion` is an LLM tool that presents options to the user — it cannot be called
  from a shell script. The command must be prose instructions that tell Claude how to iterate
  through findings, present each one, and respond to user choices.
- Counting variables as bash vars (`ACCEPTED_COUNT=$((ACCEPTED_COUNT+1))`) don't work because
  each `Bash` tool call is a separate subprocess — variables don't persist. Claude naturally
  tracks counts in its conversation context.
- The `flock`-based state transitions are still valid — Claude calls them via the Bash tool.
  But the orchestration logic (loop, decisions, counting) must be prose.

**Command Development Skill:**
- Commands are markdown files that instruct Claude — they are NOT shell scripts. Shell code
  in commands is executed via the Bash tool, but the flow control (loops, decisions, user
  interaction) is handled by Claude following the prose instructions.
- `allowed-tools` should exclude Write if the command only reads/transitions files (principle
  of least privilege)
- `$ARGUMENTS` must be validated before use in paths

**Spec Flow Analysis:**
- Missing "Stop" option: users need a way to exit triage mid-session without processing all
  findings. Added "Stop" to the options list.
- Missing "Back" option: users may want to revisit a previous decision. Added "Back" support.
- Severity sort missing: findings should be presented critical→high→medium→low so users see
  the most important items first
- Pre-loop M3 overview for large sets: when >20 findings exist, showing the count and
  breakdown first prevents surprise at the volume
- Defer reason validation: newlines in defer_reason would break YAML frontmatter. Must
  validate with `yq` (proper YAML tool) not `printf` into the frontmatter.

**Bash Defensive Patterns Skill:**
- `BASH_SOURCE[0]` is not portable in Claude Code — use `${CLAUDE_PLUGIN_ROOT}/lib/validate.sh`
- `--flag` missing value: guard with
  `[ -z "${2:-}" ] || printf '%s' "${2:-}" | grep -q '^--'` before using positional args
- `command -v yq` prerequisite as executable step, not just prose mention

---

### Phase 4: Documentation

**PR 7: Create docs/guides/common-workflows.md**

Written after all structural fixes land. Content based on the cross-plugin workflow map.

- [ ] **7.1** Create `docs/guides/` directory
- [ ] **7.2** Write `docs/guides/common-workflows.md` with these sections:
  - **Prerequisites**: Which plugins are needed. Document minimum viable install (yellow-core
    only) vs full install (all 11 plugins). List graceful degradation behavior for each missing
    plugin.
  - **New User Onboarding**: First-time setup flow — install marketplace, add plugins, verify
    hooks firing with `pnpm validate:schemas`
  - **Daily Development** (most-used chain):
    `/workflows:brainstorm` → `/workflows:plan` → `/gt-stack-plan` → `/workflows:work` →
    `/smart-submit` → `/review:pr` → `/review:resolve` → `/linear:sync`
    - Explain each step in 2-3 sentences, when to skip steps, minimum viable chain
    - Document `workflows:work` requires explicit plan file path argument:
      `/workflows:work docs/plans/YYYY-MM-DD-feat-name-plan.md`
  - **CI Response**:
    SessionStart auto-detect → `/ci:diagnose` → `/ci:report-linear` → `/linear:delegate`
  - **Code Review**:
    Single PR: `/review:pr` → `/review:resolve`
    Full stack: `/review:all stack`
    Resolve feedback: `/review:resolve`
  - **Knowledge Capture**:
    `/workflows:compound` after any significant problem/solution
    Automatic after `/review:all` via `knowledge-compounder` agent
  - **Stack Maintenance**:
    `/gt-sync` → `/gt-nav` → `/gt-amend` or `/smart-submit`
  - Each chain gets a named anchor heading for cross-linking
  - Include "No Linear" variants for users without Linear integration
- [ ] **7.3** Add cross-references from plugin READMEs where appropriate

**Files:**
- `docs/guides/common-workflows.md` (new)

### Research Insights (PR 7)

**Spec Flow Analysis — Broken Handoffs:**
- `workflows:work` requires an explicit plan file path but no upstream command documents how
  to pass it. The Daily Development chain must explicitly show:
  `→ /workflows:plan` produces `docs/plans/YYYY-MM-DD-feat-name-plan.md` →
  `→ /workflows:work docs/plans/YYYY-MM-DD-feat-name-plan.md`
- `research:deep` produces a file at `docs/research/<slug>.md` but there's no defined handoff
  to `workflows:brainstorm`. Document: "After deep research, start brainstorm referencing the
  research file"

**Missing Flows Identified:**
- No "New User Onboarding" flow — users don't know where to start. Add a first-time setup
  section.
- No "No Linear" variant — users without Linear need alternative paths. Document which steps
  to skip and what alternatives exist.
- No partial-install degradation documentation — what happens when only 3 of 11 plugins are
  installed? Document minimum viable sets.

---

**PR 8: Create docs/guides/advanced-workflows.md**

- [ ] **8.1** Write `docs/guides/advanced-workflows.md` with these sections:
  - **Product → Code Pipeline**:
    `/chatprd:setup` → `/chatprd:create` → `/chatprd:link-linear` → `/linear:delegate` →
    `/devin:status`
    - Include `/chatprd:setup` as the first step (missing from original plan — required for
      ChatPRD OAuth configuration)
    - Document credential requirements per step (ChatPRD OAuth, Linear OAuth, Devin API key)
    - Document graceful degradation when a credential is missing mid-chain
    - Document session ID bridging: `/linear:delegate` returns a Devin session URL;
      `/devin:status` needs the session ID extracted from that URL
  - **Technical Debt Lifecycle**:
    `/debt:audit` → `/debt:triage` → `/debt:fix` → `/debt:sync` → `/linear:delegate`
    - Note: `/debt:triage` → `/debt:fix` is one-at-a-time (triage selects one finding, fix
      remediates it). For batch processing, run triage first to mark multiple findings as
      "ready", then run fix on each.
  - **Research → Implementation**:
    `/research:deep` → (reference output file) → `/workflows:brainstorm` → `/workflows:plan`
    → `/workflows:work docs/plans/...`
    `/research:code` → inline answer (no file output)
  - **Cross-Plugin Orchestration**:
    How to combine 3+ plugins in one flow, with concrete examples
  - **Hook Customization**:
    How to add project-specific hooks, what events are available
    Document which plugins have hooks and what they do
    Reference the warn-only vs blocking pattern from gt-workflow
  - **Devin Delegation Patterns**:
    `/linear:delegate` (enriched with issue context) vs `/devin:delegate` (freeform task)
    When to use which, the intentional separation rationale

**Files:**
- `docs/guides/advanced-workflows.md` (new)

### Research Insights (PR 8)

**Spec Flow Analysis — Missing Steps:**
- `/chatprd:setup` must be the first step in the Product→Code pipeline. Without it, ChatPRD
  OAuth is not configured and `/chatprd:create` fails silently.
- Session ID gap: `/linear:delegate` returns a Devin session URL, but `/devin:status` expects
  a session ID. The documentation must show how to extract the ID from the URL.
- `debt:triage → debt:fix` is one-at-a-time by design, but this isn't documented. Users
  expect batch processing. Document the pattern explicitly.

**Architecture Review:**
- Cross-plugin orchestration documentation should note which plugins are strictly required
  vs optional for each chain
- Hook customization section should reference the hook-development skill for users who want
  to create custom hooks

---

## Technical Details

### Key Files to Modify (by PR)

| PR | Files Modified | Files Created | Files Deleted |
|----|---------------|---------------|---------------|
| 1 | 5 | 0 | 0 |
| 2 | 3 | 1 | 0 |
| 3 | 2 | 1 | 1 |
| 4 | 1 | 2 | 0 |
| 5 | 2 | 1 | 0 |
| 6 | 3 | 0 | 0 |
| 7 | 0 | 1 | 0 |
| 8 | 0 | 1 | 0 |
| **Total** | **16** | **7** | **1** |

### Dependencies Between PRs

```
PR 1 (quick fixes) ─── independent, ship first
PR 2 (agent consolidation) ─── depends on PR 1 (clean base)
PR 3 (compound agent) ─── depends on PR 2 (agent names settled)
PR 4 (debt hook) ─── independent of PR 2-3
PR 5 (commit hook) ─── independent of PR 2-3
PR 6 (debt:triage) ─── independent of PR 2-3, but can stack on PR 4
PR 7 (common workflows) ─── depends on PR 2-3 (agent names finalized)
PR 8 (advanced workflows) ─── depends on PR 7 (builds on common guide)
```

**Parallelizable:** PRs 4, 5, 6 can run in parallel after PR 1. PRs 2-3 are sequential.

### Decisions Not to Implement (documented for completeness)

- **D3**: Devin API duplication kept intentionally — different contexts warrant separate codepaths
- **D9**: Notification hooks deferred — no compelling use case
- **yellow-linear SessionStart hook**: Skipped — `linear-issue-loader` agent already handles this
  on-demand, and shell hooks can't call MCP tools

## Acceptance Criteria

1. `pnpm validate:schemas` passes after every PR
2. yellow-ci SessionStart hook fires within 3 seconds (not 50 minutes)
3. yellow-review `/review:pr` spawns agents from yellow-core, not compound-engineering
4. `/review:all` uses `knowledge-compounder` agent (not learning-compounder)
5. No yellow-core→yellow-ruvector coupling (ruvector integration in ruvector's CLAUDE.md only)
6. `/debt:triage` presents Accept/Reject/Defer/Stop/Back via AskUserQuestion with working counters
7. Deferred debt todos have `defer_reason` in frontmatter (validated by yq, not printf)
8. yellow-debt SessionStart hook fires reminder for high/critical findings (checks `todos/debt/`)
9. gt-workflow PostToolUse hook warns on non-conventional commit messages using `.tool_input.command`
10. gt-workflow commit hook uses `jq -n --arg` for JSON output (no printf injection)
11. `docs/guides/common-workflows.md` documents all 5 primary workflow chains + onboarding
12. `docs/guides/advanced-workflows.md` documents all advanced patterns with prerequisites
13. All hooks use `set -uo pipefail` (without `-e`), `jq -n --arg` for JSON, component-prefixed
    error logging
14. All new `.sh` files have CRLF normalized after creation

## Edge Cases

- **ruvector not installed**: knowledge-compounder does NOT call ruvector (SRP — ruvector
  integration lives in yellow-ruvector's CLAUDE.md)
- **yellow-core not installed**: yellow-review's cross-plugin agents silently degrade (documented
  in CLAUDE.md)
- **No `todos/debt/` directory**: yellow-debt SessionStart hook exits silently (not `.debt/`)
- **gt modify with multi-line -m flags**: commit validation hook extracts first `-m` value only;
  validates subject line only; skips validation if parsing fails (never false-positive blocks)
- **Concurrent debt:triage sessions**: flock-based state transitions prevent race conditions
  (already implemented — called via Bash tool from prose-driven loop)
- **PostToolUse exit_code check**: commit hook skips validation when `tool_result.exit_code != 0`
  (no point validating a failed commit)
- **Large triage sets (>20 findings)**: M3 overview presented first with severity breakdown
  before entering per-finding loop
- **Defer reason with special characters**: validated by yq (proper YAML tool), capped at 200
  chars, newlines rejected
- **Plugin partial install**: workflow guides document minimum viable plugin sets and degradation
  behavior for each missing plugin

## References

- Brainstorm: `docs/brainstorms/2026-02-25-plugin-ecosystem-cohesion-brainstorm.md`
- Hook timeout docs: Claude Code hooks use seconds, not milliseconds
- MEMORY.md: Shell script security patterns, command authoring anti-patterns
- `docs/solutions/code-quality/brainstorm-orchestrator-agent-authoring-patterns.md`
- `docs/solutions/integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md`
- `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`
- `docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md`
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
- `docs/solutions/code-quality/parallel-todo-resolution-file-based-grouping.md`
- `docs/solutions/integration-issues/ruvector-mcp-tool-parameter-schema-mismatch.md`
