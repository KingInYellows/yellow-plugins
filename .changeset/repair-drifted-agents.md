---
"yellow-core": minor
---

Repair 6 drifted research/review agents and split performance + security into specialized roles

Brings 4 research/workflow agents to parity with upstream EveryInc patterns (locked at `compound-engineering-v3.3.2`, SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f`) and splits the deep-analyzer agents `performance-oracle` and `security-sentinel` into multi-role agent families:

- **`best-practices-researcher`** — added Phase 0 skill discovery step; now checks `.claude/skills/`, `~/.claude/skills/`, and `plugins/*/skills/` for curated knowledge before going to MCP/web. Skill-based guidance outranks generic external sources.
- **`repo-research-analyst`** — added Phase 0 Technology & Infrastructure Scan with manifest-to-ecosystem mapping table, monorepo detection, deployment / API surface / data layer detection (each conditional on what 0.1 finds). Grounds all subsequent research in a known stack.
- **`git-history-analyzer`** — added "Note: The current year is 2026" preamble for time-based query interpretation.
- **`spec-flow-analyzer`** — added Phase 0 codebase grounding step before the existing 4 phases. "Gaps are only gaps if the codebase doesn't already handle them" — reduces generic feedback in spec reviews.
- **`performance-oracle`** — added "Role Split" section pointing to new `performance-reviewer` companion. Oracle stays as the deep analyzer (algorithmic complexity, scaling projections, benchmarking guidance); reviewer handles review-time confidence-calibrated findings.
- **`security-sentinel`** — added "Role Split" section pointing to new `security-reviewer` (review-time code) and `security-lens` (plan-level architect). Sentinel stays as the broad OWASP-Top-10 audit agent.

**New agents (3):**

- **`performance-reviewer`** — review-time persona for runtime performance and scalability. Anchored confidence rubric (100 = verifiable, 75 = provable from code, 50 = depends on data size — usually suppress unless P0, ≤25 = suppress). Higher effective threshold than other personas because performance issues are easy to measure and fix later; FPs waste engineering time on premature optimization.
- **`security-reviewer`** — review-time persona for exploitable security vulnerabilities. Lower effective threshold than other personas — security findings at anchor 50 should typically be filed at P0 severity to survive the aggregation gate via the P0 exception. Hunts injection vectors, auth/authz bypasses, secrets in code/logs, insecure deserialization, SSRF / path traversal.
- **`security-lens`** — plan-level security architect. Reviews planning documents, brainstorms, or architecture proposals for attack-surface gaps before implementation begins. Distinct from code-level review — examines whether the plan makes security-relevant decisions and identifies its attack surface.

All 9 agents are read-only (`tools: [Read, Grep, Glob]`) per the W1.2 read-only-reviewer rule. The 3 new reviewers will be wired into the W2.4 review:pr orchestrator dispatch table.
