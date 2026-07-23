---
'gt-workflow': minor
---

Codex-pilot shell 04: gt-workflow becomes a full-surface cross-host plugin. All seven commands are now thin wrappers over canonical skills (`gt-setup`, `gt-nav`, `gt-stack-plan`, `gt-sync`, `smart-submit`, `gt-amend`, `gt-cleanup`), joined by three skill-only components with no command wrapper (`audit-review`, consolidating the three quick-audit prompts previously duplicated in `smart-submit`/`gt-amend`; `stack-decomposition-format` and `stack-plan-style`, cross-host copies of the two `output-styles/*.md` files). The `graphite` MCP server declaration moved from an inline `mcpServers` object to a shared `.mcp.json` file reference. The two bash PreToolUse/PostToolUse hooks (`check-git-push.sh`, `check-commit-message.sh`) were rewritten as a cross-host Node runtime (host-agnostic policy modules, a snake_case/camelCase envelope adapter, and per-host thin entrypoints), proven behavior-equivalent via a golden-fixture parity harness before the bash scripts were deleted. `targets.codex.enabled: true` exposes all ten skills to Codex, verified via a live install/inspect/uninstall round-trip against codex-cli 0.144.6.

<!-- markdownlint-disable-file MD041 -->
