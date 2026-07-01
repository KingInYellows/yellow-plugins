---
'yellow-core': patch
'yellow-research': patch
'yellow-codex': patch
'yellow-composio': patch
'yellow-mempalace': patch
'yellow-ruvector': patch
---

docs(optimization): Tier 1 quick wins C1-C4 — self-description layer fixes.

C1: rewrite 5 weak `user-invokable: false` skill descriptions
(security-fencing, research-patterns, codex-patterns, composio-patterns,
mempalace-conventions) with concrete "Use when" triggers, removing topic
enumeration and "integration context" boilerplate.

C2: add one negative-disambiguation clause each to 5 confusable surfaces:
optimize vs /workflows:review, debugging vs /codex:rescue, session-history
vs ruvector recall, and /ruvector:memory <-> /mempalace:search pointing at
each other. Additive only — no existing trigger removed.

C3: fix stale yellow-core catalogs — CLAUDE.md Skills (13)→(18),
README.md Skills table 9→18 rows, learnings-researcher.md Integration
section corrected to the real dispatch sites (/review:pr,
/review:review-all, /docs:review).

C4: split the 168-line Subagent Failure Convention section out of
create-agent-skills/SKILL.md (513 lines, over its own 500-line ceiling)
into references/subagent-failure-convention.md behind a load stub that
preserves the section heading. SKILL.md is now 365 lines.

Doc-only; no scripts, hooks, schemas, or CI behavior change. Root
CLAUDE.md (C5) and root README recounts ship in the same PR without a
changeset (outside plugins/).
