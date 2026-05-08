---
'yellow-core': patch
'yellow-docs': patch
'yellow-review': patch
---

feat(agents): close model/effort coverage gaps for 9 agents (M-A-05)

Closes the three coverage gaps identified during M-A-01..M-A-04 review (PRs
#467/469/470/471/477) that fell outside the original five-PR rollout scope.

**6 agents downgraded `inherit` → `sonnet`** (no `effort:` — caller-flexible):

- `yellow-core/agents/research/best-practices-researcher.md`
- `yellow-core/agents/research/git-history-analyzer.md` (note: no
  `subagent_type` callers in commands or skills today; tier change is for
  consistency and future direct invocations)
- `yellow-core/agents/research/repo-research-analyst.md`
- `yellow-docs/agents/analysis/doc-auditor.md`
- `yellow-docs/agents/generation/diagram-architect.md`
- `yellow-docs/agents/generation/doc-generator.md`

**3 yellow-review agents retain `model: opus` and gain explicit `effort:`**:

- `agent-cli-readiness-reviewer` — `effort: high` (7-principle structured
  rubric, multi-axis but bounded)
- `agent-native-reviewer` — `effort: high` (parity-matrix reasoning,
  structured)
- `adversarial-reviewer` — `effort: xhigh` (constructs novel failure
  scenarios; no rubric ceiling — additional CoT directly expands the
  failure-mode search space rather than re-applying the same axes)

**Establishes `xhigh` vs `high` vs `max` convention.** This PR is the first
use of `xhigh` in the repo; `max` remains unused (community sources indicate
it may be Opus 4.6-exclusive and return API errors on other model versions —
avoid in agents that ship across Opus versions). The decision rule is now
documented in `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
as part of this PR.

V3/V4 validator inapplicable to all 9 agents: none are in `agents/scanners/`
or `agents/ci/` (V3 inert), and none of their `name:` fields match the
synthesizer/orchestrator/conductor/aggregator/compounder pattern (V4 inert).
No allowlist updates required.
