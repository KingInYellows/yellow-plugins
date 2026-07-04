---
"yellow-core": minor
---

Add `session-handoff` skill: writes a tracked handoff artifact at
`plans/handoff/<YYYY-MM-DD>-<slug>.md` (current task, workflow status, active
artifact, open decisions, in-flight changes, next action) with all free-text
content piped through `cs_redact_secrets` before it touches the tracked file.
Includes resume guidance for fresh sessions. Catalogs updated to 19 skills.
