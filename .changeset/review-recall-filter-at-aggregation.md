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
recall. Personas now report every finding with a confidence score and severity;
the aggregators keep the single gate and count sub-75 findings as suppressed.
