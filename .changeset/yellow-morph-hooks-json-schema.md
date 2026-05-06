---
"yellow-morph": patch
---

Fix `hooks/hooks.json` shape so Claude Code 2.1.131+ can load the plugin's `SessionStart` prewarm hook.

The reference file had `SessionStart` at the top level instead of nested under a `"hooks"` key. Recent Claude Code releases auto-discover and validate `hooks/hooks.json` against `{ hooks: Record<EventName, …> }`, so the plugin failed `/doctor` with `Hook load failed: expected "record", received undefined at path ["hooks"]`. The inline `hooks` block in `plugin.json` is unchanged; only the reference file was rewrapped to match the schema and the shape used by every other plugin in this repo (gt-workflow, yellow-ci, yellow-debt, yellow-ruvector).
