---
"yellow-research": minor
---

Bump the pinned `ast-grep-mcp` commit from `674272f` to `149e20d`. The old
pin's unbounded `mcp[cli]>=1.6.0` dependency now resolves `mcp` 2.x, which
removed `mcp.server.fastmcp`, so the ast-grep MCP server crashed at startup and
`/research:code` / `/research:deep` lost AST search. Upstream migrated to MCP 2
and pins `mcp[cli]==2.1.0`; the four tools (`find_code`, `find_code_by_rule`,
`dump_syntax_tree`, `test_match_code_rule`) are unchanged. Restart Claude Code
after updating — a failed MCP connection stays cached for about 15 minutes.
