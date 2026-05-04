---
"yellow-core": minor
"yellow-review": patch
---

Document agent archetypes and subagent failure convention

Extends `plugins/yellow-core/skills/create-agent-skills/SKILL.md` with two
new sections:

1. **Agent Archetypes** — a table mapping frontmatter fields to archetype
   (Reviewer / Scanner / Orchestrator / Research / Analyst) so authors can
   see at a glance which fields are required for which agent type. Flags
   the common `memory: true` mistake (correct form is a scope string).

2. **Subagent Failure Convention (Output-File Pattern)** — documents the
   community-adopted workaround for unreliable Task tool return values
   (GitHub Issues #24181, #25818): spawned agents write a structured JSON
   result file to `${CLAUDE_PLUGIN_DATA}/agent-result-<agent>.json`, and
   orchestrators read the file rather than relying on stdout parsing.

Wires the convention into the review-pr.md (Step 5 Pass 1) and work.md
(Phase 3 step 4) orchestrators so multi-agent sessions can distinguish
partial-success from complete failure and surface failed agents in the
user-visible summary.
