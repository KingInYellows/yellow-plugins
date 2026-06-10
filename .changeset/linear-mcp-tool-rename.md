---
"yellow-linear": patch
---

fix: migrate to current Linear MCP tool names — `create_issue`/`update_issue` → `save_issue`, `create_comment` → `save_comment`, `list_initiative_updates` → `get_status_updates`, `create_initiative_update` → `save_status_update` — across all command/agent bodies and allowed-tools lists, and update call prose to the upsert parameter names (`id`, `state`, `team`, `labels`, `project`). The old names no longer exist on the Linear MCP server, so every write operation failed with "tool not found".
