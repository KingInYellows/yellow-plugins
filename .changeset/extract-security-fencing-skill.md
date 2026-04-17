---
"yellow-core": minor
---

Add canonical security-fencing skill as source of truth for agent prompt-injection hardening

Introduces `plugins/yellow-core/skills/security-fencing/SKILL.md` as the
authoritative copy of the CRITICAL SECURITY RULES + content-fencing block
used by 25 agents across yellow-core, yellow-review, yellow-debt, yellow-ci,
and yellow-browser-test.

The skill is marked `user-invokable: false` (following repo convention) and
is intended as documentation/template, not runtime-injected via agent
`skills:` frontmatter. Rationale: research (GitHub Issue #21891) confirms
Claude Code does not deduplicate skill content across parallel subagent
spawns, so migrating 25 consumers would not deliver token savings at
runtime for this 180-token block.

Future migration is explicitly deferred pending (a) empirical verification
of skill-injection behavior at scale and (b) a drift-detection lint rule.
Until then, the skill serves as the single source of truth — update here
first, then propagate to inline copies.
