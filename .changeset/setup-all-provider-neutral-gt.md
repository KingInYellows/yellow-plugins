---
"yellow-core": patch
"yellow-review": patch
"yellow-debt": patch
---

`/setup:all` no longer requires `gt` for yellow-review or yellow-debt, since
both now submit through the enabled stacked-PR provider; `/review:setup` and
`/debt:setup` report `gt` as needed only with gt-workflow (CLAUDE-160).

The dashboard adds a `gt_mcp_check` row, and the gt-workflow Detail column
flags gt below 1.6.7, where the bundled Graphite MCP server is unavailable.
A third-party `stack`-named gh extension is reported as
`gh_stack_ext: WRONG_OWNER` instead of `MISSING`, matching
`lib/stack-tooling-probe.js`, with removal and reinstall steps.
