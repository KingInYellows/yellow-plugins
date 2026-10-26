---
'yellow-core': patch
'yellow-debt': patch
'yellow-docs': patch
'yellow-review': patch
---

Pin `effort: medium` on the 34 sonnet agents that had no effort, so they no
longer run at whatever effort the launching session uses. After the CLAUDE-187
eval, route agent-native-reviewer to `sonnet` / `medium`, the duplication and
ai-pattern scanners to `haiku` / `low`, knowledge-compounder's Context Analyzer
and Related Docs Finder to `haiku` / `low`, and the `/optimize` judge to
`sonnet` / `medium`.
