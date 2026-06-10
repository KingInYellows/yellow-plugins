---
"yellow-ci": patch
---

fix: replace stale Linear MCP tool name in /ci:report-linear (`create_issue` → `save_issue` with `team`/`labels` params); add executable validation snippets to /ci:setup (sources `validate_ssh_host`/`validate_ssh_key_path` via `${CLAUDE_PLUGIN_ROOT}`); wire failure-analyst log fetch through `redact_secrets` instead of a prose-only redaction instruction
