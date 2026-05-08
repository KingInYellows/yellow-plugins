# Feature: Close Model/Effort Tier Coverage Gaps (M-A-05)

## Problem Statement

The M-A-01 through M-A-04 stack (PRs #467, #469, #470, #471, #477) tiered 39
agents with explicit `model:` and `effort:` frontmatter and shipped the V1–V4
validator that lints them. During PR #471 review, the maintainability and
correctness reviewers surfaced three coverage gaps that fell outside the
original five-PR rollout scope:

1. **3 `yellow-core/research` agents still on `model: inherit`** —
   `best-practices-researcher`, `git-history-analyzer`, `repo-research-analyst`.
   Not covered by any prior phase; they remain in the inheritance trap the
   M-A series was designed to escape.
2. **3 `yellow-docs` analysis/generation agents still on `model: inherit`** —
   `doc-auditor` (analysis/), `diagram-architect` and `doc-generator`
   (generation/). Phases 3a/3b only addressed `yellow-docs/agents/review/`.
3. **3 `yellow-review` reviewers retain `model: opus` but lack `effort:`** —
   `adversarial-reviewer`, `agent-cli-readiness-reviewer`,
   `agent-native-reviewer`. Plan-time rationale for keeping them on opus
   ("compound multi-axis architectural judgment") is the exact use case
   `effort: high` (or `xhigh` for the adversarial case) was designed to support.

These gaps are non-blocking — the validator passes — but they leave 9 agents
silently inheriting the calling session's model or running with default effort
on bodies of work the M-A series explicitly identified as benefiting from
deeper chain-of-thought.

## Linear Issues

(none — this is an internal cleanup PR; track via this plan)

## Current State

Frontmatter snapshot as of this plan's creation:

| Plugin | Agent | Path | Current `model` | Current `effort` |
|---|---|---|---|---|
| yellow-core | best-practices-researcher | agents/research/ | `inherit` | (none) |
| yellow-core | git-history-analyzer | agents/research/ | `inherit` | (none) |
| yellow-core | repo-research-analyst | agents/research/ | `inherit` | (none) |
| yellow-docs | doc-auditor | agents/analysis/ | `inherit` | (none) |
| yellow-docs | diagram-architect | agents/generation/ | `inherit` | (none) |
| yellow-docs | doc-generator | agents/generation/ | `inherit` | (none) |
| yellow-review | adversarial-reviewer | agents/review/ | `opus` | (none) |
| yellow-review | agent-cli-readiness-reviewer | agents/review/ | `opus` | (none) |
| yellow-review | agent-native-reviewer | agents/review/ | `opus` | (none) |

V3/V4 validator implications: none of these agents are in `scanners/` or
`ci/` subdirs (V3 inapplicable), and none of their `name:` fields match the
synthesizer/orchestrator/conductor/aggregator/compounder pattern (V4
inapplicable). No allowlist updates needed.

## Proposed Solution

### Tier assignments

| Agent | Target `model` | Target `effort` | Rationale |
|---|---|---|---|
| best-practices-researcher | `sonnet` | (none) | Web/code lookup + light synthesis. Caller-supplied effort context is appropriate; pinning a default reduces flexibility. |
| git-history-analyzer | `sonnet` | (none) | Structured `git log` / `git blame` interpretation. Bounded I/O, no compound reasoning. |
| repo-research-analyst | `sonnet` | (none) | Read + grep exploration + structured synthesis. Same caller-flexibility argument. |
| doc-auditor | `sonnet` | (none) | Audit scan with structured rubric. Single-axis taxonomy work — sonnet at default effort is the established pattern (matches yellow-debt scanners' tier choice modulo `effort: low`, but this isn't a parallel-fanout role). |
| diagram-architect | `sonnet` | (none) | Diagram type selection from code analysis. Bounded decision; structured. |
| doc-generator | `sonnet` | (none) | Doc generation with explicit human review gates. The gates do the quality control; the agent itself doesn't need extended thinking. |
| adversarial-reviewer | `opus` (no change) | **`xhigh`** | "Actively constructs failure scenarios to break the implementation rather than checking against known patterns" — this is the compound novel reasoning case. `xhigh` (vs `high`) is justified because adversarial reasoning has no rubric ceiling: the model's job is to expand the failure-mode search space, and additional CoT directly broadens that search. |
| agent-cli-readiness-reviewer | `opus` (no change) | `high` | 7-principle severity-based rubric (Blocker/Friction/Optimization). Multi-axis but each principle is bounded; `high` provides extended thinking without `xhigh`'s diminishing returns. |
| agent-native-reviewer | `opus` (no change) | `high` | Parity-matrix reasoning across UI/agent/system-prompt surfaces. Structured matrix, multi-axis but bounded — `high` matches the agent-cli-readiness peer pattern. |

### `xhigh` vs `high` decision rule (for future tiers)

Use `xhigh` when:
- The agent's task has **no rubric ceiling** (open-ended adversarial work,
  novel-pattern detection)
- Additional CoT directly **expands the search space** rather than
  re-applying the same axes
- The agent is opus-tier (xhigh on sonnet/haiku is pointless — the model's
  ceiling already constrains output before effort would)

Use `high` when:
- The agent applies a **bounded structured rubric** (n principles, n axes,
  n criteria) where each axis is itself bounded
- Additional CoT mostly redoes the same axes more carefully

Reserve `max` for cases where wall-clock cost is acceptable in exchange for
the most thorough deliberation possible (none of the M-A-05 agents qualify).

<!-- deepen-plan: codebase -->
> **Codebase:** The local subagent frontmatter catalog at
> `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md:46`
> documents the `effort:` enum (`low|medium|high|xhigh|max`) but provides
> **no semantic distinction between `high`, `xhigh`, and `max`**. The plan's
> "no rubric ceiling" framing is authorial — not a confirmation of an
> existing convention. The validator (`scripts/validate-agent-authoring.js:52`)
> treats all three as equivalent for V4 satisfiability via
> `HIGH_EFFORT = new Set(['high', 'xhigh', 'max'])`. **Action:** as part of
> Phase 4.1, add this decision rule to the catalog so future tiers have a
> documented reference rather than re-deriving it. This PR is the first to
> use either `xhigh` or `max` in the repo (verified: `rg 'effort: xhigh'`
> and `rg 'effort: max'` return zero hits).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Community precedent strongly supports the plan's
> `high` vs `xhigh` split. The most detailed public spec
> ([modu-ai/moai-adk SPEC-OPUS47-COMPAT-001](https://github.com/modu-ai/moai-adk/blob/main/.moai/specs/SPEC-OPUS47-COMPAT-001/spec.md))
> assigns `xhigh` to "manager" agents that do open-ended planning and
> orchestration with no fixed rubric, and `high` to evaluator agents that
> apply known criteria — exactly the rubric-vs-no-rubric criterion this
> plan uses. moai-adk also documents that **`xhigh` is the effective
> ceiling for Opus 4.7+** (other models default to `high` as internal
> fallback). Anthropic's official subagent docs list the enum but provide
> no per-level semantics, so the convention is community-derived rather
> than vendor-specified.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** **`effort: max` carries model-version risk.** A community
> source ([FlorianBruniaux/claude-code-ultimate-guide quiz](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/quiz/questions/09-advanced-patterns.yaml))
> states `effort: max` is Opus 4.6-exclusive and returns an API error on
> other models. The Anthropic SDK has a `caps["effort"]["max"]["supported"]`
> capability flag confirming `max` availability is per-model. The plan
> correctly avoids `max` — preserve that decision; do not "upgrade"
> adversarial-reviewer to `max` as a follow-up unless the agent is also
> pinned to a specific Opus version where `max` is verified supported.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** **No published cost/latency multipliers.** Anthropic does
> not document the token-budget ratio between `high`/`xhigh`/`max`.
> Order-of-magnitude proxies from the API's extended-thinking parameter:
> `high` ≈ 2-4× a non-thinking call; `xhigh` adds further latency on
> complex prompts; `max` reportedly approaches 5-10× but no authoritative
> figure exists. Treat the Performance Considerations section's "1.5-2x /
> 2-3x" estimates as best-guess only.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Foundation

- [ ] 1.1: `gt branch create agent/feat/model-explicit-coverage-gaps`
  (stacks on `main`, NOT on the M-A-01..M-A-04 stack — all five upstream
  PRs are merge-pending)
- [ ] 1.2: Confirm none of the 9 agents have changed since this plan was
  written: `git diff main -- <9 paths>`. If any have changed, refresh the
  Current State table before edits.

### Phase 2: Edit 9 agent frontmatter blocks

Each edit inserts `model:` (and optionally `effort:`) immediately after
`description:`, preserving existing field order for `background:`, `memory:`,
`skills:`, `tools:` etc. Canonical convention (description → model → effort
→ background → other fields) is now codified in
`docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`; the
M-A-01..M-A-04 rollout plan that originated it has been archived.

- [ ] 2.1: `plugins/yellow-core/agents/research/best-practices-researcher.md`
  — replace `model: inherit` with `model: sonnet` (no `effort:` added)
- [ ] 2.2: `plugins/yellow-core/agents/research/git-history-analyzer.md`
  — `model: inherit` → `model: sonnet`

  <!-- deepen-plan: codebase -->
  > **Codebase:** `git-history-analyzer` has **no `subagent_type` callers
  > in `commands/` or `skills/`** — only descriptive references in
  > CLAUDE.md and READMEs. The tier change still has value (frontmatter
  > consistency, future direct invocations, agent-discovery surface), but
  > impact on running workflows is zero today. Document this in the
  > changeset so reviewers don't expect runtime behavior changes.
  <!-- /deepen-plan -->

- [ ] 2.3: `plugins/yellow-core/agents/research/repo-research-analyst.md`
  — `model: inherit` → `model: sonnet`
- [ ] 2.4: `plugins/yellow-docs/agents/analysis/doc-auditor.md`
  — `model: inherit` → `model: sonnet`
- [ ] 2.5: `plugins/yellow-docs/agents/generation/diagram-architect.md`
  — `model: inherit` → `model: sonnet`
- [ ] 2.6: `plugins/yellow-docs/agents/generation/doc-generator.md`
  — `model: inherit` → `model: sonnet`
- [ ] 2.7: `plugins/yellow-review/agents/review/adversarial-reviewer.md`
  — keep `model: opus`; add `effort: xhigh` directly after the `model:` line
- [ ] 2.8: `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md`
  — keep `model: opus`; add `effort: high`
- [ ] 2.9: `plugins/yellow-review/agents/review/agent-native-reviewer.md`
  — keep `model: opus`; add `effort: high`

### Phase 3: Validation

- [ ] 3.1: Run `pnpm validate:agents` — must exit 0 with no warnings.
  Expected: V3 inapplicable (none in scanners/ or ci/), V4 inapplicable
  (none match the synthesizer regex). If any warning fires, the assumption
  in the Current State section is wrong; re-evaluate.
- [ ] 3.2: Run `pnpm validate:schemas` — must pass.
- [ ] 3.3: Run `pnpm test:unit` — must pass.
- [ ] 3.4: Run `pnpm typecheck && pnpm lint` — must pass.

### Phase 4: Plan-doc update + changeset

- [x] 4.1: Update `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
  with the `xhigh` vs `high` vs `max` decision rule and the 9 tier
  assignments from this PR. The catalog is the canonical source of truth;
  the prior `plans/model-selection-frontmatter-rollout.md` was archived,
  so its "Per-Agent Assignment Table" responsibility has migrated here.

- [ ] 4.2: `pnpm changeset` — patch bumps for `yellow-core`, `yellow-docs`,
  `yellow-review`. Include the `xhigh` rationale paragraph in the changeset
  body so future tiers have a precedent reference.
- [ ] 4.3: Normalize CRLF on edited files: `for f in <9 paths>; do sed -i
  's/\r$//' "$f"; done`

### Phase 5: Commit + submit

- [ ] 5.1: `gt commit create -m "feat(agents): close model/effort coverage
  gaps for 9 agents (M-A-05)"` with a body summarizing the 3-plugin patch
  bumps + `xhigh` precedent rationale
- [ ] 5.2: `gt stack submit` (creates a new PR off `main`, independent of
  the M-A-01..M-A-04 stack)

## Technical Specifications

### Files to Modify (9 agents + 1 plan + 1 changeset)

- `plugins/yellow-core/agents/research/best-practices-researcher.md`
- `plugins/yellow-core/agents/research/git-history-analyzer.md`
- `plugins/yellow-core/agents/research/repo-research-analyst.md`
- `plugins/yellow-docs/agents/analysis/doc-auditor.md`
- `plugins/yellow-docs/agents/generation/diagram-architect.md`
- `plugins/yellow-docs/agents/generation/doc-generator.md`
- `plugins/yellow-review/agents/review/adversarial-reviewer.md`
- `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md`
- `plugins/yellow-review/agents/review/agent-native-reviewer.md`
- `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
  (effort tier-selection rule + per-agent assignment migration target;
  replaces the archived `plans/model-selection-frontmatter-rollout.md`)

### Files to Create

- `.changeset/model-explicit-coverage-gaps.md` (3-plugin patch bumps)

### Dependencies

None.

## Acceptance Criteria

1. `grep -L "^model: " plugins/{yellow-core/agents/research,yellow-docs/agents/{analysis,generation},yellow-review/agents/review}/<9 files>` returns empty (every target file declares an explicit model).
2. `grep -c "^model: inherit" plugins/yellow-core/agents/research/*.md plugins/yellow-docs/agents/{analysis,generation}/*.md` returns 0 (no remaining inheritance in the targeted directories).
3. `grep -l "^effort: xhigh" plugins/yellow-review/agents/review/*.md` returns exactly `adversarial-reviewer.md` (and only that file).
4. `pnpm validate:agents` exits 0 with no V3/V4 warnings on the live tree.
5. CI baseline gate (`pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`) passes.
6. Changeset present at `.changeset/model-explicit-coverage-gaps.md` with three patch bumps.

## Edge Cases

- **One of the 9 agents gains a new `effort:` field upstream before this
  PR ships.** Mitigation: Phase 1.2 re-checks frontmatter before editing.
  If a conflict surfaces, defer that file's edit and document why in the
  changeset.
- **Future ImportError on `xhigh`.** If Claude Code's frontmatter parser
  rejects `xhigh` (which would also break PR #477's V1 enum), that's a
  framework regression unrelated to this PR — escalate, do not work around.
- **adversarial-reviewer at `effort: xhigh` runs noticeably slower in CI.**
  This is the intended trade-off — the agent only fires on large/high-risk
  diffs (>200 changed lines or auth/payment/data-mutation domains), so the
  wall-clock cost is bounded. If it becomes a problem, downgrade to `high`
  in a follow-up.

## Performance Considerations

- The 6 sonnet downgrades (research/ and analysis/generation/) are *cost
  reductions* — they exit the inheritance trap that was silently using
  opus when the calling session was opus.
- The 3 opus + effort additions are *cost increases* — `effort: high`
  roughly 1.5–2x token use vs default; `effort: xhigh` ~2–3x (best-guess
  proxies; Anthropic does not publish per-tier multipliers — see the
  catalog's "No published cost/latency multipliers" note). These run
  conditionally (adversarial only on large/high-risk PRs), so the
  per-PR-review impact is bounded.

## Security Considerations

None directly — frontmatter changes don't affect tool surfaces, MCP access,
or the W1.5 read-only-reviewer rule. The 3 yellow-review agents already had
their tools constrained pre-existing.

## Migration & Rollback

- **Rollback:** revert the single commit. No state migration; pure
  frontmatter changes.
- **Downstream impact:** all 9 agents are spawned via `Task` from
  command/skill bodies that pin `subagent_type` strings. The 9 `name:`
  fields are unchanged, so no caller breaks.

## References

- Source plan: `plans/model-selection-frontmatter-rollout.md` *(archived
  during plan-lifecycle cleanup; canonical tier rule and per-agent
  assignments migrated to the catalog below)*
- Source brainstorm: [`docs/brainstorms/2026-05-08-research-integration-model-selection-context-optimization-brainstorm.md`](../docs/brainstorms/2026-05-08-research-integration-model-selection-context-optimization-brainstorm.md)
- Subagent frontmatter catalog: [`docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`](../docs/solutions/code-quality/subagent-frontmatter-field-catalog.md) (canonical source for `effort:` enum, including `xhigh` semantics)
- Validator implementation: [`scripts/validate-agent-authoring.js`](../scripts/validate-agent-authoring.js) (V1-V4 rules from PR #477)
- M-A-01 through M-A-04 PRs (merged or in flight): #467, #469, #470, #471, #477
- PR #471 review surfaced these gaps — see review-all run summary
