# EveryInc Merge Plan — Completeness Audit

**Date:** 2026-04-28
**Session type:** Third brainstorm; audit-only. Locks from sessions 1 and 2 are not re-litigated.
**Source documents audited:**
- `plans/everyinc-merge.md` (1670 lines — the plan being audited)
- `RESEARCH/every-plugin-research.md` (upstream snapshot)
- `RESEARCH/MERGE_PLAN.md` (original merge analysis)
- `docs/brainstorms/2026-04-28-everyinc-merge-brainstorm.md` (locked — merge sequencing)
- `docs/brainstorms/2026-04-28-everyinc-capability-gap-brainstorm.md` (locked — capability gaps)
**Status:** Gaps identified; decisions locked; ready for `/workflows:plan` to integrate additions.

---

## What We Found

Three genuine gaps were identified. None are manufactured. The plan is otherwise
structurally complete — the wave sequencing is correct, the OOS decisions hold,
and the 19 deepen-plan annotations are accurate. The gaps below would cause silent
failures or incomplete coverage during implementation.

### GAP-1: `learnings-researcher` tools list will fail silently at runtime (W2.1)

**Severity: High. Causes silent runtime failure, not an authoring error caught by validation.**

W2.1 specifies `tools: [Read, Grep, Glob]` for `learnings-researcher`. The
deepen-plan annotation on W2.1 (and the Performance Considerations section)
correctly recommends that the agent call ruvector's `hooks_recall` as the
primary retrieval path, falling back to glob+rank only when ruvector is
unavailable.

Calling a deferred MCP tool requires `ToolSearch` in the agent's `tools:` list.
Per the documented anti-pattern in CLAUDE.md project memory: "Every command
using deferred MCP tools must include `ToolSearch` in allowed-tools." Without
`ToolSearch`, the MCP discovery step silently fails, the agent falls through to
glob-only, and there is no warning or error — the reviewer output degrades
quietly, which is the worst kind of failure for an always-run pre-pass.

**What the fix requires:**
- W2.1 tools list must read `[Read, Grep, Glob, ToolSearch]` (adding `ToolSearch`
  for ruvector MCP discovery).
- W2.1 agent body must include: (a) a `ToolSearch` probe for
  `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` at the top of the agent,
  (b) a branch: if found, call `hooks_recall` over a `docs/solutions/` namespace;
  if not found, fall through to glob+rank. This is the standard graceful-degradation
  pattern used in `review-pr.md` Steps 3b/3c.
- The W2.1 acceptance criterion in the plan ("return literal `NO_PRIOR_LEARNINGS`
  token on empty") is still correct — it covers both paths.

**Integration note for `/workflows:plan`:** The `review:pr` W2.4 `allowed-tools:`
audit line already lists ruvector tools as required. The `learnings-researcher`
agent is dispatched via Task from `review:pr`, so the orchestrator's
`allowed-tools` being correct is not a substitute — the agent's own `tools:` must
include `ToolSearch` for the agent to perform MCP discovery inside its own
execution context.

---

### GAP-2: `test-coverage-analyst` is DRIFTED but not repaired in W1.3

**Severity: Medium. Wave 1 exits with one DRIFTED agent unaddressed.**

The original merge research (`RESEARCH/MERGE_PLAN.md`) marks `test-coverage-analyst`
as **DRIFTED** against upstream `ce-testing-reviewer` ("Yours splits full-suite
(yellow-core) vs PR-scoped (yellow-review); upstream has just ce-testing-reviewer").
The plan's W1.2 correctly strips Bash from `test-coverage-analyst` (it appears in
the Wave 1 Bash-strip list). However, W1.3 repairs only these six drifted agents:
`best-practices-researcher`, `repo-research-analyst`, `git-history-analyzer`,
`spec-flow-analyzer`, `performance-oracle`, `security-sentinel`.

`test-coverage-analyst` exits Wave 1 with Bash removed but still behind upstream
parity on frontmatter and body structure. It is then dispatched in the Wave 2
pipeline (W2.4 dispatch table references `test-coverage-analyst`) without having
been brought to parity.

**What the fix requires:**
- Add `test-coverage-analyst` to the W1.3 repair list with a sub-task: read
  upstream `ce-testing-reviewer` snapshot from Phase 0; bring frontmatter
  (`description`, `model: inherit`, read-only tools) and body structure (confidence
  calibration output format) to parity. The split architecture (full-suite in
  yellow-core, PR-scoped `pr-test-analyzer` in yellow-review) is intentional and
  documented in the merge research as UNIQUE yellow-plugins value — preserve the
  split; bring each agent's individual body to upstream parity.
- `pr-test-analyzer` (in yellow-review) should receive the same parity check even
  though it has no direct upstream equivalent — its output schema should match the
  Wave 2 structured format (severity/category/file/line/finding/fix/confidence)
  after W1.3.

**Integration note for `/workflows:plan`:** The `refactor/repair-drifted-agents`
PR (#3 in the stack decomposition) currently scopes 6 agents. Adding
`test-coverage-analyst` (+ `pr-test-analyzer` parity check) expands its scope
slightly but does not change its wave assignment. The PR's changeset bump
(`minor` yellow-core) is unaffected — `test-coverage-analyst` already lives
in yellow-core.

---

### GAP-3: `ce-api-contract-reviewer` had no disposition; confirmed real gap

**Severity: Medium. Confirmed addition; decision made in Q&A above.**

The upstream `ce-api-contract-reviewer` (listed as MISSING in `RESEARCH/MERGE_PLAN.md`)
appeared in neither locked brainstorm and was not in the plan's Out of Scope list.
The merge research's skip rationale covered the Rails-shaped data-migration cluster
(`ce-data-integrity-guardian`, `ce-data-migrations-reviewer`,
`ce-deployment-verification-agent`, `ce-schema-drift-detector`) under "adopt only
if you work on apps with similar production-DB risk." `ce-api-contract-reviewer`
is listed separately in the upstream catalog and is language-agnostic — it detects
breaking API contract changes, not Rails migration safety.

**Decision (locked in this session):** Adopt as `plugin-contract-reviewer`, renamed
for accuracy. Yellow-plugins audits plugin manifests, agent/command/skill
frontmatter, and MCP tool name surfaces — not REST APIs.

**Specification:**

- **File:** `plugins/yellow-review/agents/review/plugin-contract-reviewer.md`
- **Plugin:** yellow-review (absorb-into-existing per Q2 lock; single reviewer
  agent fits cleanly alongside the Wave 2 personas)
- **Wave:** Wave 3, new PR #18, parallel branch off the Wave 2 keystone (#6)
- **tools:** `[Read, Grep, Glob]` (read-only, Wave 1 rule applies)
- **Changeset:** yellow-review `minor` (additive)

**Audit surface (yellow-plugins-specific adaptation of the upstream prompt):**
The agent audits PRs for breaking changes to any of:
- `subagent_type: "plugin:agent-name"` references — renames break external
  installs that the in-repo validator cannot catch
- Command namespace renames (`/plugin:foo`) — user muscle memory and CLAUDE.md
  cross-references break silently
- Skill name renames invoked via the `Skill` tool
- MCP tool name changes (`mcp__plugin_X_Y__Z`) — silently break dependent
  commands' `allowed-tools` lists (documented anti-pattern in CLAUDE.md)
- Plugin manifest field changes (`plugin.json` `name`, `version`, `hooks` shape)
- Hook contract changes (event type, matcher pattern) that alter PostToolUse/
  SessionStart behavior

**Auto-invocation condition in W2.4 dispatch table:** Trigger when diff touches
any of: `plugins/*/plugin.json`, `plugins/*/agents/**/*.md`,
`plugins/*/commands/**/*.md`, `plugins/*/skills/**/SKILL.md`,
`plugins/*/hooks/**`. Same auto-detection pattern as the W3.5 agent-native
reviewers. No invocation on non-plugin PRs.

**Phase 0:** Read upstream `ce-api-contract-reviewer` snapshot from locked SHA
before authoring; adapt the prompt from REST-API focus to plugin-contract focus.
The structural pattern (confidence calibration, compact return schema) is
identical to the Wave 2 persona reviewers.

**Why this matters beyond "nice to have":** The plan already contains two
examples of breaking-API-shape changes caught only by careful manual planning:
W2.5 (`code-reviewer` → `project-compliance-reviewer` rename, which required
a deprecation stub) and W3.13b (yellow-debt scanner schema v1.0 → v2.0 with
field renames requiring a dual-read transition). A `plugin-contract-reviewer`
would flag both of these automatically during the review of their respective
PRs, removing the manual discipline requirement for future breaking changes.

---

## Recommended Additions

### Addition 1: Fix `learnings-researcher` tools list (W2.1)

**Sequencing:** Fold into W2.1 before the keystone PR (#6) is authored. This is
not a new PR — it is a correction to the existing W2.1 task specification.

**Concrete plan edit:** In W2.1, replace:
> Frontmatter: `name: learnings-researcher`, ... `tools: [Read, Grep, Glob]`.

With:
> Frontmatter: `name: learnings-researcher`, ... `tools: [Read, Grep, Glob, ToolSearch]`.
> Add ToolSearch for deferred ruvector MCP discovery; see body spec below.

And add a sub-task:
> Body must include a ToolSearch probe for `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`
> at the start of retrieval. If found: call `hooks_recall` with `query` = PR diff
> summary + `top_k` = 5 over the `docs/solutions/` namespace. If not found: fall
> through to glob+rank over `docs/solutions/**/*.md`. Standard graceful-degradation
> pattern (matches review-pr.md Steps 3b/3c). Both paths must honor the
> `NO_PRIOR_LEARNINGS` empty-result contract.

### Addition 2: Add `test-coverage-analyst` to W1.3 repair list

**Sequencing:** Fold into W1.3. This expands the `refactor/repair-drifted-agents`
PR (#3) scope slightly but does not change its wave or changeset type.

**Concrete plan edit:** In W1.3, add after the `spec-flow-analyzer` sub-task:
> `plugins/yellow-core/agents/review/test-coverage-analyst.md` — frontmatter
> parity with upstream `ce-testing-reviewer` (model: inherit, read-only tools
> already handled by W1.2). Body: bring confidence-calibration output format to
> parity; preserve the full-suite vs PR-scoped split as yellow-plugins unique value.
> Read upstream `ce-testing-reviewer` snapshot from Phase 0.
>
> `plugins/yellow-review/agents/review/pr-test-analyzer.md` — output schema check:
> confirm finding format matches the Wave 2 structured schema (severity/category/
> file/line/finding/fix/confidence) so it integrates cleanly with W2.4 aggregation.
> No body rewrite required; schema alignment only.

### Addition 3: New Wave 3 PR #18 — `plugin-contract-reviewer`

**Sequencing:** Wave 3, new parallel branch off keystone (#6). Does not depend
on any other Wave 3 PR. Can be developed simultaneously with PRs #7–#17.

**Stack decomposition entry:**

```
### 18. feat/plugin-contract-reviewer
- **Type:** feat
- **Description:** plugin-contract-reviewer — detects breaking API contract
  changes to plugin manifests, agent/command/skill names, MCP tool names,
  subagent_type references, and hook contracts
- **Scope:** NEW plugins/yellow-review/agents/review/plugin-contract-reviewer.md
- **Tasks:** W3.15 (new task block)
- **Depends on:** #6
- **Notes:** Renamed from ce-api-contract-reviewer. Auto-invokes when diff
  touches plugins/*/plugin.json, plugins/*/agents/**, plugins/*/commands/**,
  plugins/*/skills/**/SKILL.md, plugins/*/hooks/**. Same dispatch pattern as
  W3.5 agent-native reviewers. yellow-review minor bump (additive).
```

**New task block for the plan body:**

```
- [ ] **W3.15 — plugin-contract-reviewer (ce-api-contract-reviewer adaptation).**
  (`minor` yellow-review)
  - [ ] Create plugins/yellow-review/agents/review/plugin-contract-reviewer.md.
  - [ ] Frontmatter: name: plugin-contract-reviewer; single-line description with
    "Use when..." trigger; tools: [Read, Grep, Glob] (read-only — Wave 1 rule applies).
  - [ ] Body: adapt ce-api-contract-reviewer prompt from REST-API focus to plugin
    contract focus. Audit surface: subagent_type renames, command namespace renames,
    skill name renames, MCP tool name changes (mcp__plugin_X_Y__Z), plugin.json
    manifest field changes, hook contract changes.
  - [ ] Confidence calibration: security-tier threshold (≥0.8) applies — a missed
    breaking change has high blast radius for external installs. Findings below 0.8
    are reported as suggestions, not P1.
  - [ ] Wire into review:pr W2.4 dispatch table: auto-invoke when diff touches
    plugins/*/plugin.json, plugins/*/agents/**.md, plugins/*/commands/**.md,
    plugins/*/skills/**/SKILL.md, plugins/*/hooks/**. No invocation on non-plugin PRs.
  - [ ] Read upstream ce-api-contract-reviewer snapshot from Phase 0 before authoring.
  - [ ] Fencing: agent receives plugin file content (potentially user-editable).
    Same fencing requirements as W3.5 agent-native reviewers.
  - [ ] Done: a synthetic PR renaming an agent file triggers the reviewer and
    surfaces at least one P1 finding (subagent_type reference not updated).
```

**W3.9 changeset update:** yellow-review already gets a `minor` bump in W3.9
for the resolve-pr improvements and agent-native reviewers (W3.3, W3.5). The
`plugin-contract-reviewer` is additive to that same bump. No changeset type
change required; add it to the W3.9 yellow-review entry rationale.

---

## Confirmed Complete

The following items were audited and verified as correctly addressed. Listed to
document what was checked, not to re-litigate decisions.

**OOS decisions that hold on re-audit:**
- `ce-schema-drift-detector` — correctly grouped with the Rails data-migration
  cluster (skipped). Schema.rb is Rails-specific; yellow-plugins has no schema.rb.
- `ce-api-contract-reviewer` — was NOT grouped with the Rails cluster; now
  correctly addressed as GAP-3 above.
- `ce-data-integrity-guardian`, `ce-data-migrations-reviewer`,
  `ce-deployment-verification-agent` — correctly skipped; Rails-migration-shaped.
- `ce-testing-reviewer` parity — the test-coverage-analyst drift was identified
  in the research and IS addressed by this audit (GAP-2); the OOS boundary for
  the CE agent itself (not adopted as a replacement, only as a parity reference)
  is correct.
- `ce-web-researcher`, `ce-framework-docs-researcher` — correctly skipped; covered
  by yellow-research plugin with better MCP backends.
- `ce-issue-intelligence-analyst` — correctly skipped (OOS); solo project,
  low signal-to-noise.
- Skill-injection hook — correctly excluded; only meaningful in CE's skills-first
  architecture, which yellow-plugins does not adopt (Q1 lock).

**Wave structure integrity:**
- Wave 1 → Wave 2 dependency ordering is correct. W2.0a (knowledge-compounder
  schema) landing before W2.1 (learnings-researcher authoring) is correct and
  matches the OQ-A resolution.
- The 11 parallel Wave 3 branches off keystone PR #6 are genuinely independent
  of each other. Addition 3 (PR #18) is a 12th parallel branch with the same
  topology — no additional serialization required.
- review-all (W2.6) inline-update is correctly co-located in the keystone PR (#6)
  to avoid the silent-bypass problem. The deepen-plan annotation's "this block
  must mirror review:pr.md Steps 3a-6" comment requirement is present and correct.

**Confidence rubric integration:**
- W2.3 (read rubric from upstream before authoring) correctly gates W2.4 (write
  the orchestrator). Phase 0 snapshot fetch is the prerequisite. This sequencing
  is correct.
- The deepen-plan external annotation on W2.4 provides cross-reference benchmarks
  (Premasundera 0.7, Rasheed 0.75, Diffray category-specific). These are for
  validation, not specification — using CE's actual rubric numbers from the Phase
  0 snapshot is the correct primary source. No gap here.

**ruvector availability assumptions:**
- The plan correctly treats ruvector as optional/graceful-degradation throughout
  (W2.1 pre-pass, W3.10 compound-lifecycle overlap detection, W3.11 ideation
  RAG pass). The only gap is the tools-list fix in GAP-1 above.
- OQ-B (yellow-devin session-list API surface) is correctly deferred to W3.12
  implementation with a ToolSearch fallback path specified. No gap.

**plugin-dev creation decision:**
- W3.5 leaves plugin-dev creation as "if not present, or adopt under yellow-core
  if plugin-dev creation is out of scope." This ambiguity is intentional — it is
  a decision for `/workflows:plan` to resolve at implementation time, not a gap.
  The plan's fallback (yellow-core) is a valid landing zone. No gap.

**Cross-plugin assumptions:**
- yellow-devin MCP surface (OQ-B): deferred correctly; graceful-degradation
  specified.
- yellow-codex session paths (`~/.codex/sessions/`): correctly derived from
  `plugins/yellow-codex/commands/codex/status.md` Step 3 in the W3.12 task body.
  No gap — the plan does not rely on an undocumented assumption.
- ruvector `hooks_recall` schema (`query` + `top_k`; returns `score` not
  `similarity`; no `namespace` param): the plan's W2.1 and W3.10 references to
  ruvector use the correct field names per CLAUDE.md memory. No gap.

**Stack decomposition completeness:**
- 6 backbone PRs (#1–#6) + 11 parallel Wave 3 PRs (#7–#17) + 1 addition (#18
  from this audit) = 18 total PRs. Backbone dependency chain is linear and
  correct. All Wave 3 PRs depend only on #6 (the keystone). No circular
  dependencies.
- W3.9 (Wave 3 changesets) is the only task without its own PR entry in the
  stack decomposition — it is folded into the last Wave 3 PR per convention.
  This is correct; changeset creation is part of each PR's pre-PR checklist.

---

## Open Questions for `/workflows:plan`

**OQ-AUDIT-1: `learnings-researcher` ruvector ToolSearch — tools list update scope**

The GAP-1 fix adds `ToolSearch` to `learnings-researcher`'s `tools:` list. This
means the agent can perform MCP discovery but also expands its declared tool
surface. The read-only-reviewer validation rule (W1.5) checks for `Bash` only.
`ToolSearch` is not a write tool and should not trigger the rule. Confirm that
W1.5's rule does not inadvertently flag `ToolSearch` in reviewer-path agents.
(Note: `learnings-researcher` lives in `agents/research/`, not `agents/review/`,
so the rule as written — "path matches `agents/review/*.md`" — does NOT apply.
But verify this when implementing W1.5 to ensure the path check is tight enough.)

**OQ-AUDIT-2: `plugin-contract-reviewer` confidence tier**

The W3.15 spec above assigns security-tier threshold (≥0.8) to this reviewer
because missed breaking changes have high external blast radius. The plan's
confidence rubric (from W2.3) defines category-specific thresholds
(security/performance ≥0.8, correctness ≥0.7, style ≥0.6). Determine at W2.3
read time whether there is an "api-contract" or "breaking-change" category in
CE's rubric that maps cleanly, or whether the security-tier threshold is the
right approximation. Document the decision in the W2.3 deliverable
(`RESEARCH/upstream-snapshots/<sha>/confidence-rubric.md`).

**OQ-AUDIT-3: `test-coverage-analyst` parity scope boundary**

The GAP-2 fix says "bring body to parity" for test-coverage-analyst. At Phase 0
read time, if the upstream `ce-testing-reviewer` body has diverged substantially
from the current yellow-plugins body (not just frontmatter but whole methodology),
decide: (a) full body rewrite to upstream parity, accepting possible loss of any
yellow-plugins-specific adaptations; or (b) frontmatter + output-schema-only
update, preserving the body. The split architecture (full-suite vs PR-scoped) is
locked as yellow-plugins unique value — that is not in scope for reversal.
Document the decision in the W1.3 wave log.

---

## Out of Scope (confirmed unchanged from prior sessions)

The following remain explicitly excluded. The `plugin-contract-reviewer` addition
does not expand any of these decisions.

- ce-demo-reel, ce-release-notes, ce-report-bug, ce-update (OS-1, OS-2, OS-4)
- ce-slack-research + ce-slack-researcher
- ce-proof, ce-gemini-imagegen
- ce-frontend-design, Figma/design agents
- ce-data-integrity-guardian, ce-data-migrations-reviewer, ce-data-migration-expert,
  ce-deployment-verification-agent, ce-schema-drift-detector (Rails-shaped)
- CE stack-specific persona reviewers (DHH/Rails, Kieran/Rails, Swift/iOS, Ankane/Ruby)
- Skill-injection hook (skills-first architecture only)
- ce-issue-intelligence-analyst
- ce-web-researcher, ce-framework-docs-researcher (covered by yellow-research MCPs)
- yellow-composio implementation (W3.8 research-report only per OS-3)
- POST-1 (stacked-PR seeds) and POST-2 (lfg analog) remain post-merge
