---
'gt-workflow': patch
'yellow-browser-test': patch
'yellow-ci': patch
'yellow-codex': patch
'yellow-core': patch
'yellow-council': patch
'yellow-debt': patch
'yellow-devin': patch
'yellow-docs': patch
'yellow-research': patch
'yellow-review': patch
'yellow-semgrep': patch
---

Modernise the authoring surface for current Claude Code and the Claude 5
generation. The agent-authoring validator now accepts the `fable` model alias
and full `claude-*` model IDs (V2), understands the post-2.1.63 `Agent` tool
name in `Agent(bareword):` shorthand checks, and adds RULE 21 — a warning-tier
line ceiling for commands (500) and agents (300) so the next
progressive-disclosure pass has a scoreboard. Every `tools:` / `allowed-tools:`
list and prose call site is renamed from the legacy `Task` to `Agent` (the alias
still works). The `debt-conventions` scanner template now matches the shipped
scanners (`model: sonnet`, `effort: low`).
