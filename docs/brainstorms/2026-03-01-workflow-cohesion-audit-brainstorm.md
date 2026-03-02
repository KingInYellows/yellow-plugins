# Workflow Cohesion Audit: Layered Architecture Vision

**Date:** 2026-03-01
**Topic:** Cohesive workflows, proper agents, valid hooks, Graphite throughout
**Approach:** Layered Architecture Standard

---

## What We're Building

A cohesive architectural standard for the yellow-plugins monorepo that ensures
all 11 plugins share consistent conventions, connect through a well-defined
workflow spine, and maintain clear autonomy within their domains. The standard
covers four dimensions:

1. **End-to-end workflow cohesion** -- the brainstorm-to-merge pipeline has clean
   handoffs with no gaps or duplications
2. **Agent role clarity** -- every agent has a distinct, non-overlapping role
3. **Hook validity** -- hooks are structurally correct, have appropriate coverage,
   and do not conflict across plugins
4. **Graphite consistency** -- write operations use Graphite; `gh` reads are
   acceptable

---

## Why This Approach

The monorepo currently has 11 plugins, ~60 commands, ~40 agents, 4 plugins with
hooks, and 22 skills. The plugins evolved independently, and while each is
internally well-designed, cross-plugin integration has inconsistencies: duplicate
agent roles between yellow-core and yellow-review, hook permission issues in
yellow-ruvector, three plugins with no Graphite awareness, and workflow overlaps
between `workflows:review` (yellow-core) and `review:pr` (yellow-review).

Rather than fixing individual symptoms, a layered architecture standard provides
a durable reference that guides both remediation of current gaps and development
of future plugins.

---

## Architecture: Three Layers

### Layer 1: Shared Conventions (mandatory for all plugins)

These conventions apply to every plugin in the monorepo, regardless of domain.

#### 1a. Graphite Integration Standard

**Target state:**
- All git write operations (branch creation, commits, pushes, PR creation) MUST
  use Graphite (`gt create`, `gt commit create`, `gt modify`, `gt submit`)
- `gh` is acceptable for read operations (`gh pr view`, `gh pr list`,
  `gh api repos/.../comments`, `gh repo view`)
- `git` read operations (`git diff`, `git status`, `git log`, `git branch
  --show-current`) are always acceptable
- Every plugin's CLAUDE.md must include a Graphite convention statement
- The gt-workflow `check-git-push.sh` PreToolUse hook enforces `git push`
  blocking repo-wide when gt-workflow is installed

**Current gaps:**
| Plugin | CLAUDE.md Graphite mention | Commands use gt | Hook protection |
|--------|---------------------------|-----------------|-----------------|
| yellow-core | Yes | Yes (workflows:work) | Via gt-workflow |
| gt-workflow | Yes | Yes (all commands) | Own hook |
| yellow-ci | Yes | No (read-only, acceptable) | Via gt-workflow |
| yellow-review | Yes | Yes (review:pr, review:resolve) | Via gt-workflow |
| yellow-linear | Yes | Yes (linear:sync, linear-pr-linker) | Via gt-workflow |
| yellow-debt | Yes (CLAUDE.md) | Yes (debt:fix) | Via gt-workflow |
| yellow-devin | Yes | No (delegates to Devin, acceptable) | Via gt-workflow |
| yellow-ruvector | Yes | No (read/write memory, acceptable) | Via gt-workflow |
| **yellow-chatprd** | **No** | **N/A (MCP-only, no git ops)** | **None needed** |
| **yellow-browser-test** | **No** | **N/A (browser testing, no git ops)** | **None needed** |
| **yellow-research** | **No** | **N/A (research, no git ops)** | **None needed** |

**Assessment:** The three plugins without Graphite mentions (yellow-chatprd,
yellow-browser-test, yellow-research) do not perform git write operations, so
the absence is acceptable. However, for completeness and discoverability, each
should include a brief CLAUDE.md note stating they are read-only/non-git plugins.
No code changes needed -- only documentation alignment.

#### 1b. Conventional Commits

**Target state:** All commits follow `type(scope): description` format. The
gt-workflow `check-commit-message.sh` PostToolUse hook warns (does not block) on
non-conventional messages. This is already implemented and working.

**Current gap:** None. The hook is well-designed (warn-only, safe parsing, no
injection surface). No changes needed.

#### 1c. Agent Contract Standard

**Target state:** Every agent in the monorepo follows these conventions:
- YAML frontmatter with `name`, `description`, `model`, `allowed-tools`
- `description` must include "Use when..." clause for discoverability
- Body includes `<examples>` section with at least one example
- Security rules section with content fencing when processing untrusted input
- Output format section defining the agent's response structure
- No two agents across the entire monorepo have substantially overlapping scope

**Current gap:** See "Agent Role Clarity" section below for specific overlaps.

#### 1d. Hook Contract Standard

**Target state:** Every hook script follows these conventions:
- Scripts must be executable (`chmod +x`)
- Scripts must output valid JSON (`{"continue": true}`) on all code paths
- PreToolUse hooks exit 0 (allow) or 2 (block with stderr message)
- PostToolUse hooks always exit 0 with `{"continue": true}`
- SessionStart hooks inject system context, never block
- Scripts must handle missing dependencies gracefully (warn, not crash)
- Timeout values in plugin.json must be realistic for the operation
- `hooks.json` files in hooks/ directories are reference-only (authoritative
  config is in `.claude-plugin/plugin.json`)

**Current gap:** See "Hook Validity" section below.

---

### Layer 2: Workflow Spine (the canonical pipeline)

The workflow spine is the primary development pipeline that connects ideation to
merged code. All plugins that participate in the development lifecycle should
integrate with this spine at well-defined entry/exit points.

#### The Canonical Pipeline

```
[Ideation]          [Planning]          [Implementation]       [Quality]           [Delivery]

/workflows:brainstorm  /workflows:plan  /workflows:work     /review:pr           /smart-submit
     |                      |                |              /review:resolve        or gt submit
     |                      |                |              /review:all               |
     v                      v                v                   |                    v
docs/brainstorms/      plans/*.md       gt create +          gt modify +          gt submit
                                        gt commit create     gt submit            PR merged
```

#### Spine Entry Points (where plugins connect)

| Spine Phase | Plugin | Entry Point | Integration |
|-------------|--------|-------------|-------------|
| Ideation | yellow-core | `/workflows:brainstorm` | Produces `docs/brainstorms/*.md` |
| Ideation | yellow-chatprd | `/chatprd:create` | Could feed into brainstorm (not connected) |
| Ideation | yellow-linear | `/linear:triage` | Could feed issues into plan (loosely connected) |
| Planning | yellow-core | `/workflows:plan` | Reads brainstorms, produces `plans/*.md` |
| Planning | gt-workflow | `/gt-stack-plan` | Plans stacked PRs (parallel path, not connected to plan) |
| Implementation | yellow-core | `/workflows:work` | Reads plans, creates branches via `gt create` |
| Implementation | yellow-linear | `/linear:delegate` | Delegates to Devin (alternative impl path) |
| Quality | yellow-review | `/review:pr`, `/review:all` | Multi-agent review with auto-fix |
| Quality | yellow-core | `/workflows:review` | Multi-agent review (overlaps with yellow-review) |
| Quality | gt-workflow | `/smart-submit` | Audit + commit + submit |
| Delivery | gt-workflow | `/smart-submit`, `/gt-sync` | Graphite submit and sync |
| Learning | yellow-core | `/workflows:compound` | Captures solutions from recent fixes |
| Learning | yellow-review | (automatic) | `review:pr` auto-compounds P1/P2 findings |

#### Workflow Handoff Gaps

**Gap W1: Brainstorm -> Plan handoff is implicit, not linked.**
`/workflows:brainstorm` produces a file in `docs/brainstorms/` and suggests
running `/workflows:plan`. But `/workflows:plan` only checks for brainstorm docs
via `find docs/brainstorms/ -type f` -- it does not receive a specific file path.
If multiple brainstorm docs exist, the plan command may pick up the wrong one.

**Recommendation:** `/workflows:brainstorm` should output the exact file path and
suggest `/workflows:plan docs/brainstorms/<date>-<slug>-brainstorm.md` with the
resolved path pre-filled.

**Gap W2: Plan -> Work handoff lacks branch naming linkage.**
`/workflows:plan` produces `plans/<name>.md` and suggests `/workflows:work
plans/<name>.md`. The work command creates a branch via `gt create
feature-name-from-plan` but does not derive the branch name from the plan file's
title or any structured field. This means the branch name is improvised rather
than deterministic.

**Recommendation:** Plans should include a `branch-name:` field in a structured
header that `/workflows:work` reads for `gt create`.

**Gap W3: `workflows:review` (yellow-core) overlaps with `review:pr` (yellow-review).**
Both commands perform multi-agent code review. `workflows:review` uses 7 agents
from yellow-core. `review:pr` uses adaptive agent selection from yellow-review
plus cross-plugin agents from yellow-core. They share security-sentinel,
performance-oracle, architecture-strategist, and code-simplicity-reviewer but
invoke them differently.

**Recommendation:** Retire `workflows:review` and canonicalize `review:pr` as the
single review entry point. `workflows:review` should become a thin redirect to
`review:pr`. The yellow-review plugin already has richer functionality (adaptive
selection, auto-fix, comment resolution, knowledge compounding).

**Gap W4: `/gt-stack-plan` is disconnected from `/workflows:plan`.**
Both plan implementation work, but `gt-stack-plan` focuses on stacked PR
decomposition while `workflows:plan` focuses on feature specification. They are
complementary but not connected -- a natural flow would be
brainstorm -> plan -> stack-plan -> work.

**Recommendation:** `/workflows:plan` should offer `/gt-stack-plan` as a next
step for complex features. `gt-stack-plan` should accept a plan file path as
input to derive its stack from.

**Gap W5: `/smart-submit` and `/workflows:work` Phase 4 are parallel submit paths.**
`workflows:work` Phase 4 ("Ship It") runs `gt stack submit` directly.
`/smart-submit` runs a 3-agent audit before committing and submitting. These are
not connected -- a user finishing `/workflows:work` Phase 3 should be offered
`/smart-submit` as the final step rather than a raw `gt stack submit`.

**Recommendation:** `/workflows:work` Phase 4 should delegate to `/smart-submit`
for the audit-commit-submit cycle, or at minimum offer it as the recommended
path.

---

### Layer 3: Plugin Autonomy Zones

Each plugin owns its domain and has full authority over its commands, agents,
skills, and hooks within that domain. The architecture standard does not
prescribe internal plugin structure beyond the shared conventions in Layer 1.

#### Plugin Domain Map

| Plugin | Domain | Git Writes? | Hooks? | Cross-Plugin Dependencies |
|--------|--------|-------------|--------|---------------------------|
| yellow-core | Workflow orchestration, review agents, research agents | Yes | No | None (foundational) |
| gt-workflow | Graphite operations, smart commit/submit | Yes | Yes (2) | None (foundational) |
| yellow-review | PR review, comment resolution | Yes | No | yellow-core agents (cross-plugin Task) |
| yellow-linear | Linear PM, issue sync, delegation | Yes | No | yellow-devin (for delegation) |
| yellow-ci | CI diagnosis, runner management | No | Yes (1) | None |
| yellow-debt | Tech debt audit, remediation | Yes | Yes (1) | yellow-core agents (via Task) |
| yellow-devin | Devin AI delegation | No | No | None |
| yellow-research | External research APIs | No | No | None |
| yellow-chatprd | ChatPRD document management | No | No | None |
| yellow-browser-test | Browser-based testing | No | No | None |
| yellow-ruvector | Vector memory, semantic search | No | Yes (4) | None |

#### Cross-Plugin Agent Sharing

yellow-review explicitly invokes agents from yellow-core via Task tool:
- `security-sentinel` (yellow-core) -- used by review:pr, smart-submit
- `architecture-strategist` (yellow-core) -- used by review:pr
- `performance-oracle` (yellow-core) -- used by review:pr
- `pattern-recognition-specialist` (yellow-core) -- used by review:pr
- `code-simplicity-reviewer` (yellow-core) -- used by review:pr

This cross-plugin sharing is acceptable and intentional. yellow-core provides
foundational agents; yellow-review orchestrates them alongside its own.

---

## Key Decisions

### D1: Agent Role Clarity -- Overlaps Identified

The following agent pairs have substantially overlapping scope:

**Overlap 1: code-simplicity-reviewer (yellow-core) vs. code-simplifier (yellow-review)**

| Dimension | code-simplicity-reviewer | code-simplifier |
|-----------|-------------------------|-----------------|
| Plugin | yellow-core | yellow-review |
| Focus | YAGNI enforcement, abstraction analysis | Post-fix simplification |
| When used | Parallel review pass | Sequential pass 2 (after fixes applied) |
| Output | Report findings only | Report findings only |

**Assessment:** These have distinct roles despite similar names. The
code-simplicity-reviewer runs in parallel during initial review to find
pre-existing complexity. The code-simplifier runs sequentially after fixes are
applied to ensure fixes did not add unnecessary complexity. The role distinction
is temporal (pass 1 vs. pass 2), not topical.

**Recommendation:** Keep both. Rename `code-simplifier` to
`post-fix-simplifier` or add "pass 2" to its description to clarify the temporal
distinction. Current names create confusion.

**Overlap 2: test-coverage-analyst (yellow-core) vs. pr-test-analyzer (yellow-review)**

| Dimension | test-coverage-analyst | pr-test-analyzer |
|-----------|----------------------|------------------|
| Plugin | yellow-core | yellow-review |
| Focus | Test suite quality, coverage gaps, strategy | PR-specific test completeness |
| When used | workflows:review (broad review) | review:pr (PR-scoped review) |
| Scope | Entire test suite analysis | Only tests related to the PR diff |

**Assessment:** These overlap in concept but differ in scope. The
test-coverage-analyst examines the full test suite for strategy issues. The
pr-test-analyzer is scoped to whether the PR's changes have adequate test
coverage. In practice, both end up asking "are there enough tests?" but at
different granularities.

**Recommendation:** With `workflows:review` retired in favor of `review:pr` (see
Gap W3), the test-coverage-analyst loses its primary invocation context. Keep it
as a standalone agent for ad-hoc test suite audits, but ensure `review:pr`
exclusively uses `pr-test-analyzer` for PR-scoped analysis. Add a note to
test-coverage-analyst's description: "For full test suite audits, not PR reviews."

**Overlap 3: security-sentinel (yellow-core) vs. security-debt-scanner (yellow-debt)**

| Dimension | security-sentinel | security-debt-scanner |
|-----------|------------------|----------------------|
| Plugin | yellow-core | yellow-debt |
| Focus | Active vulnerabilities (OWASP top 10, injection, XSS) | Security debt (missing validation, deprecated crypto, hardcoded config) |
| When used | PR review, smart-submit audit | debt:audit |

**Assessment:** These are properly separated. security-sentinel hunts active
vulnerabilities in diffs. security-debt-scanner finds accumulated security debt
across the codebase. Different triggers, different scope, complementary.

**Recommendation:** No changes needed. The distinction is clear.

**Overlap 4: architecture-strategist (yellow-core) vs. architecture-scanner (yellow-debt)**

| Dimension | architecture-strategist | architecture-scanner |
|-----------|------------------------|---------------------|
| Plugin | yellow-core | yellow-debt |
| Focus | SOLID principles, coupling/cohesion in PR changes | Circular deps, god modules, boundary violations codebase-wide |
| When used | PR review | debt:audit |

**Assessment:** Properly separated by trigger context (PR review vs. full
codebase audit). Complementary, not overlapping.

**Recommendation:** No changes needed.

### D2: Hook Validity -- Findings

**Finding H1: yellow-ruvector hook scripts lack execute permissions.**

All four yellow-ruvector hook scripts (`post-tool-use.sh`, `session-start.sh`,
`stop.sh`, `user-prompt-submit.sh`) have mode `644` (not executable). The
gt-workflow and yellow-ci scripts correctly have mode `755`.

Since the plugin.json invokes them via `bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/script.sh`
(explicit `bash` interpreter), the missing execute bit does not cause a runtime
failure -- `bash` does not require `+x` to source a script. However, this
violates the hook contract standard and would break if the invocation ever
changed to direct execution.

**Recommendation:** Add `chmod +x` to all four scripts.

**Finding H2: No hook coverage gaps requiring action.**

Analysis of which hook points each plugin needs:

| Plugin | SessionStart | PreToolUse | PostToolUse | UserPromptSubmit | Stop |
|--------|-------------|------------|-------------|------------------|------|
| gt-workflow | -- | check-git-push (Bash) | check-commit-message (Bash) | -- | -- |
| yellow-ci | session-start | -- | -- | -- | -- |
| yellow-debt | session-start | -- | -- | -- | -- |
| yellow-ruvector | session-start | -- | post-tool-use (Edit/Write/Bash) | user-prompt-submit | stop |

Plugins without hooks (yellow-core, yellow-review, yellow-linear, yellow-devin,
yellow-research, yellow-chatprd, yellow-browser-test) do not need hooks because:
- They do not inject session context (no SessionStart needed)
- They do not intercept tool use (no PreToolUse/PostToolUse needed)
- They do not maintain persistent state requiring cleanup (no Stop needed)

**Recommendation:** No new hooks needed. Current coverage is appropriate.

**Finding H3: PostToolUse hook ordering between gt-workflow and yellow-ruvector.**

When both plugins are installed, Bash tool use triggers two PostToolUse hooks:
1. gt-workflow's `check-commit-message.sh` (matcher: `Bash`)
2. yellow-ruvector's `post-tool-use.sh` (matcher: `Edit|Write|Bash`)

These do not conflict because:
- gt-workflow's hook only activates on `gt modify`/`gt commit`/`gt create`
  commands (early exit otherwise)
- yellow-ruvector's hook records command outcomes to the learning store
- Both always return `{"continue": true}` (neither blocks)
- Execution order is deterministic (plugin load order) but does not matter since
  both are side-effect-only

**Recommendation:** No changes needed. Document the non-conflict guarantee in a
shared conventions doc if one is created.

**Finding H4: SessionStart hook accumulation.**

Three plugins (yellow-ci, yellow-debt, yellow-ruvector) all fire SessionStart
hooks. When all three are installed, session startup runs three scripts
sequentially. Each has a 3-second timeout, so worst case adds 9 seconds to
session start.

**Recommendation:** Monitor perceived startup latency. If it becomes an issue,
consider a shared session-start dispatcher that runs all three in parallel within
a single hook. For now, acceptable.

### D3: Graphite Integration -- Assessment

**The repo is in good shape.** Every plugin that performs git writes already uses
Graphite commands. The gt-workflow `check-git-push.sh` hook blocks raw
`git push` for any project where gt-workflow is installed. The three plugins
without Graphite mentions (yellow-chatprd, yellow-browser-test, yellow-research)
genuinely do not perform git operations.

**Minor documentation gap:** These three plugins' CLAUDE.md files should include
a brief statement like "This plugin does not perform git operations. No Graphite
integration is needed." This prevents future contributors from wondering whether
Graphite was accidentally omitted.

---

## Open Questions

**Q1: Should `workflows:review` be fully retired or kept as an alias?**
Retiring it in favor of `review:pr` is the recommendation, but it could also be
kept as a thin wrapper that calls `review:pr`. The risk of keeping both is
continued confusion about which to use. The risk of removing is breaking users
who have `workflows:review` in their muscle memory.

**Q2: Should `/workflows:work` Phase 4 hard-delegate to `/smart-submit`?**
This would make `/smart-submit` the single submit path, ensuring every commit
gets the 3-agent audit. The trade-off is added latency for the audit step. Users
who want to skip the audit can pass `--no-verify`.

**Q3: Should cross-plugin agent invocation be formalized?**
Currently, yellow-review invokes yellow-core agents via Task tool by name. This
works but is implicit -- there is no manifest declaring which agents are
"exported" for cross-plugin use. A future plugin could accidentally shadow an
agent name. Consider whether agents should declare `cross-plugin: true` in their
frontmatter.

**Q4: Is a plugin conformance checklist worth maintaining?**
The Layer 1 conventions could be expressed as a machine-checkable checklist (does
CLAUDE.md mention Graphite? are hook scripts executable? do agents have
examples?). This could be a CI lint or a `/debt:audit` scanner. Worth building
only if the repo expects to grow beyond the current 11 plugins.

**Q5: Should `/gt-stack-plan` accept a plan file as input?**
Currently it takes a feature description. If it also accepted `plans/*.md`, it
could decompose an existing plan into a stack. This connects the planning and
stack-planning phases, but the plan format would need a stable structure for
parsing.
