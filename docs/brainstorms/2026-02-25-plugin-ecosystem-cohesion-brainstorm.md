# Plugin Ecosystem Cohesion & Structural Fixes

**Date:** 2026-02-25
**Status:** Draft
**Scope:** All 11 plugins (56 commands, 43 agents, 6 hooks, 8 MCP servers)

## What We're Building

A cohesion pass across the entire yellow-plugins ecosystem that:

1. **Fixes correctness bugs** (P1) — timeout units, agent naming, dead references
2. **Resolves cross-plugin friction** (P2) — learning overlap, hook gaps, incomplete implementations
3. **Adds polish** (P3) — workflow documentation, Notification hooks, M3 safety gates
4. **Produces workflow guides** — `docs/guides/common-workflows.md` and `docs/guides/advanced-workflows.md`

## Why This Approach

The plugin ecosystem has grown organically across 60+ PRs. Individual plugins are solid, but the
seams between them have friction: duplicated codepaths, undefined ordering, missing safety gates,
and no user-facing guide to the natural command chains. Fixing structural issues first ensures the
workflow guides document a clean system rather than papering over problems.

## Key Decisions

### D1: Timeout units — standardize to seconds

**Decision:** All hook timeouts use seconds (the Claude Code native unit).

**Action:** Change yellow-ci's `"timeout": 3000` to `"timeout": 3`. This is currently a
50-minute timeout instead of the intended 3 seconds.

**Files affected:**
- `plugins/yellow-ci/.claude-plugin/plugin.json` (line ~22)

### D2: Cross-plugin agent naming — consolidate into yellow-core

**Decision:** Copy the 3-4 review agents that yellow-review currently references via
`compound-engineering:review:*` into yellow-core, then update yellow-review's subagent_type
references to point at yellow-core's copies.

**Rationale:** yellow-core already has `security-sentinel`, `performance-oracle`,
`architecture-strategist`. The compound-engineering references are an external dependency not in
this repo — if it's not installed, those agents silently don't fire.

**Optimization opportunity:** While consolidating, optimize the agents for our specific workflows:
Graphite-aware review patterns, plugin authoring conventions from CLAUDE.md/MEMORY.md, conventional
commit awareness.

**Files affected:**
- `plugins/yellow-core/agents/` — verify existing agents cover all needed specialties
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — update subagent_type references
- `plugins/yellow-review/commands/review-pr.md` — update agent spawning
- `plugins/yellow-review/commands/review-all.md` — update agent spawning

**Agents to verify exist in yellow-core (or create):**
- `security-sentinel` — already exists
- `architecture-strategist` — already exists
- `performance-oracle` — already exists
- `pattern-recognition-specialist` — check if exists or merge into another
- `agent-native-reviewer` — check if exists or drop (may not apply to our plugins)

### D3: Devin API duplication — keep separate intentionally

**Decision:** Keep `/linear:delegate` (yellow-linear) and `/devin:delegate` (yellow-devin) as
independent codepaths.

**Rationale:** `/linear:delegate` is a contextual bridge — it enriches the Devin task with Linear
issue context (description, comments, acceptance criteria, linked PRs). It's not just "call the
Devin API" — it's "delegate this Linear issue to an AI agent." The command should also eventually
support delegating to other agents beyond Devin. The duplication is acceptable because:
- Different input contexts (Linear issue vs. freeform task)
- Different enrichment logic
- Different follow-up actions (Linear status update vs. session management)

**No action needed** — document the intentional separation in the workflow guides.

### D4: Learning compounding — merge into one codepath

**Decision:** Remove `learning-compounder` from yellow-review. Have `/review:all` call
`/workflows:compound` at the end instead.

**Rationale:** Both write to `docs/solutions/` and MEMORY.md. `/workflows:compound` is more
sophisticated (5 subagents, routing logic, dedup checking). Having two writers creates duplicate
entries and unclear ownership.

**Files affected:**
- `plugins/yellow-review/agents/learning-compounder.md` — remove or deprecate
- `plugins/yellow-review/commands/review-all.md` — replace `learning-compounder` spawn with
  `/workflows:compound` delegation
- `plugins/yellow-review/.claude-plugin/plugin.json` — remove agent registration

### D5: Hook philosophy — proactive where cheap

**Decision:** Add lightweight hooks to plugins where they provide clear value without cluttering
context or adding latency. Target: under 2 seconds, minimal context injection.

**New hooks to add:**

| Plugin | Hook | Purpose | Budget |
|---|---|---|---|
| yellow-debt | SessionStart | Check `.debt/` for high-severity pending findings, inject reminder | 2s |
| gt-workflow | PostToolUse(Bash) | Validate conventional commit format after `gt modify`/`gt commit` | 50ms |
| yellow-linear | SessionStart | Check branch name for Linear issue ID, inject issue context | 1s |

**Hooks NOT to add (considered and rejected):**
- yellow-core SessionStart (project context) — too generic, would fire on every session
- yellow-review PostToolUse (learning loop trigger) — `/workflows:compound` is explicit enough
- yellow-ci PostToolUse(Bash) secret redaction — the redact.sh lib is available for agents, a hook
  would slow every Bash call and false-positive on normal output

### D6: SessionStart hook ordering

**Decision:** Document that ordering is undefined, but design hooks to be independent. Each
SessionStart hook should produce a self-contained systemMessage that doesn't depend on other
hooks' output.

**Action:** Verify yellow-ci and yellow-ruvector SessionStart hooks are truly independent (they
appear to be). Add a comment in each hook script noting that execution order with other plugins'
SessionStart hooks is not guaranteed.

### D7: `/debt:triage` completion

**Decision:** Replace placeholder comments with real AskUserQuestion flow.

**Files affected:**
- `plugins/yellow-debt/commands/debt-triage.md` — implement the interactive Accept/Reject/Defer
  loop with proper AskUserQuestion calls, flock-based state transitions, and batch mode support

### D8: yellow-browser-test M3 gate

**Decision:** Add AskUserQuestion confirmation before `test-reporter` creates GitHub issues.

**Files affected:**
- `plugins/yellow-browser-test/agents/test-reporter.md` — add M3 confirmation step showing
  issue count and titles before creation

### D9: Notification hooks

**Decision:** Defer. No compelling use case identified that isn't already served by systemMessage
injection via SessionStart. Notification hooks are a Claude Code feature looking for a problem in
our ecosystem.

### D10: Workflow documentation

**Decision:** Create `docs/guides/` with two files after structural fixes land.

**Structure:**

`docs/guides/common-workflows.md`:
- **Daily development**: brainstorm → plan → work → submit → review → sync
- **CI response**: diagnose → report → delegate
- **Code review**: review single PR / review stack / resolve comments
- **Knowledge capture**: compound learnings from any workflow

`docs/guides/advanced-workflows.md`:
- **Product → Code pipeline**: ChatPRD → Linear → Devin → review
- **Technical debt lifecycle**: audit → triage → fix → sync to Linear → delegate
- **Stack management**: plan stack → navigate → amend → sync → restack
- **Research → Implementation**: deep research → brainstorm → plan → work
- **Cross-plugin orchestration**: combining 3+ plugins in one flow
- **Hook customization**: adding project-specific hooks

## Open Questions

### Q1: Should yellow-linear SessionStart hook auto-load issue context?

Adding a SessionStart hook that detects `ENG-123` in the branch name and loads the Linear issue
context would save users from running `/linear:sync` manually. But it adds ~1s latency to every
session start and requires the Linear MCP server to be authenticated. If auth fails, it must
degrade silently.

**Leaning:** Yes, but with aggressive caching (5-minute TTL) and silent degradation.

### Q2: How many external agent specialties does yellow-core need?

The compound-engineering plugin has agents we don't currently have in yellow-core:
- `pattern-recognition-specialist` — duplication and anti-pattern detection
- `agent-native-reviewer` — verifies agent/UI parity

Do we need these, or are they covered by our existing agents (code-simplicity-reviewer,
polyglot-reviewer)?

**Leaning:** `pattern-recognition-specialist` overlaps with `code-simplicity-reviewer` and
`architecture-strategist`. `agent-native-reviewer` is specific to projects building agent
interfaces — skip unless we need it for plugin authoring validation.

### Q3: Should `/review:all` call `/workflows:compound` directly or use Task?

If `/review:all` delegates to `/workflows:compound` via the Task tool, it gets the full
5-subagent pipeline. But the command would need `Task` in its allowed-tools and the compound
command would need to accept input from an agent context (not just user invocation).

**Leaning:** Use Task tool delegation. The compound command already works as a general-purpose
knowledge capture pipeline.

### Q4: Conventional commit validation hook — how strict?

The proposed PostToolUse(Bash) hook on gt-workflow would check commit messages after `gt modify`
or `gt commit`. Options:
- **Warn only** — systemMessage saying "commit message doesn't follow conventional commits"
- **Block** — exit code 2 to prevent the commit (like the git-push hook)

**Leaning:** Warn only. Blocking would be annoying during rapid iteration. The smart-submit
command already enforces conventional commits in its generated messages.

## Implementation Order

Suggested sequencing (each item is a potential PR):

1. **P1 fix: yellow-ci timeout** — one-line change, immediate correctness fix
2. **P1 fix: agent consolidation into yellow-core** — audit existing agents, update references
3. **P2 fix: remove learning-compounder, wire /review:all → /workflows:compound**
4. **P2 fix: complete /debt:triage AskUserQuestion flow**
5. **P2 fix: add SessionStart hooks (yellow-debt, yellow-linear)**
6. **P2 fix: add PostToolUse hook for conventional commits (gt-workflow)**
7. **P3 fix: add M3 gate to yellow-browser-test test-reporter**
8. **P3 docs: create docs/guides/common-workflows.md**
9. **P3 docs: create docs/guides/advanced-workflows.md**

Items 1-3 can potentially be stacked. Items 4-7 are independent. Items 8-9 should come last.

## Cross-Plugin Workflow Map

For reference, here are the natural workflow chains identified during research:

```
DAILY DEVELOPMENT
  /workflows:brainstorm → /workflows:plan → /gt-stack-plan → /workflows:work → /smart-submit
                                                                              → /review:pr
                                                                              → /review:resolve
                                                                              → /linear:sync

CI RESPONSE
  [SessionStart auto-detect] → /ci:diagnose → /ci:report-linear → /linear:delegate

TECHNICAL DEBT
  /debt:audit → /debt:triage → /debt:fix → /debt:sync → /linear:delegate

PRODUCT → CODE
  /chatprd:create → /chatprd:link-linear → /linear:delegate → /devin:status

RESEARCH → KNOWLEDGE
  /research:deep → /workflows:compound
  /research:code → (inline answer, no file)

STACK MAINTENANCE
  /gt-sync → /gt-nav → /gt-amend or /smart-submit
```
