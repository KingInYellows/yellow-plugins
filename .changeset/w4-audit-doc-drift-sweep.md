---
'yellow-ci': patch
'yellow-codex': patch
'yellow-composio': patch
'yellow-core': patch
'yellow-docs': patch
'yellow-research': patch
'yellow-semgrep': patch
---

Audit doc-drift sweep (2026-07-09 full-marketplace audit, Wave 4): add the
three standard SKILL.md headings (`## What It Does` / `## When to Use` /
`## Usage`) to the 8 skills flagged by RULE 15b — yellow-ci `ci-conventions`
+ `diagnose-ci`, yellow-codex `codex-patterns`, yellow-composio
`composio-patterns`, yellow-core `create-agent-skills`, yellow-docs
`docs-conventions`, yellow-research `research-patterns`, yellow-semgrep
`semgrep-conventions` — clearing every RULE 15b advisory warning. Also adds
Ceramic to yellow-research's marketplace.json description (mirroring
plugin.json), and fixes the root README MCP counts against mechanical counts
(nine MCP-bundling plugins, six yellow-research servers) with a one-line
yellow-mempalace deprecation footnote under the MCP table.
