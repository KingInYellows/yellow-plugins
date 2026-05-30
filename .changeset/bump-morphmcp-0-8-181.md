---
"yellow-morph": minor
---

Bump `@morphllm/morphmcp` pin 0.8.165 → 0.8.181 (latest npm release). Verified via an MCP `tools/list` probe per the upstream-pins bump checklist: 0.8.181 exposes `edit_file` and `codebase_search` — the two tools the plugin namespaces (`mcp__plugin_yellow-morph_morph__edit_file` / `__codebase_search`) — plus `github_codebase_search`. The bump removes or renames nothing the plugin depends on, and the env-var surface is unchanged. Updates `plugins/yellow-morph/package.json`, `package-lock.json`, the root `pnpm-lock.yaml`, and the version reference in the plugin CLAUDE.md.
