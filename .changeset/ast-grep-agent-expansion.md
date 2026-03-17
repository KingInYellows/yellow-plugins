---
"yellow-review": minor
"yellow-debt": minor
---

Add ast-grep MCP tools to 4 high-value review and debt agents

Add ast-grep structural code search (find_code, find_code_by_rule) with
ToolSearch-based graceful degradation to silent-failure-hunter,
type-design-analyzer, duplication-scanner, and complexity-scanner. Each agent
includes tailored AST vs Grep routing guidance and falls back to Grep when
yellow-research is not installed.
