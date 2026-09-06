---
'yellow-review': patch
'yellow-docs': patch
---

Stop filtering review findings at the persona stage. Four reviewer agents
(`agent-native-reviewer`, `agent-cli-readiness-reviewer`,
`cli-readiness-reviewer`, `coherence-reviewer`) suppressed findings below
confidence 75 and two capped the count at 5–7, while `/review:pr` and
`/docs:review` already apply the same 75 gate after aggregation. Anthropic's
Sonnet 5 / Opus 5 prompting guides show the Claude 5 generation follows such
instructions literally, so the redundant persona-side gate lowered measured
recall. Personas now report findings with a confidence score and severity,
capped at 40 (lowest-ranked overflow dropped, not counted as
orchestrator-suppressed); the aggregators keep the single gate and count
only findings the gate actually removes as suppressed (`/review:pr` P0 at
50+ and `/docs:review` P1 at 50+ survive and are excluded from that
count).
