---
"yellow-core": patch
---

Fix stale `/setup:all` checks so the dashboard agrees with each plugin's own setup command: read credential-status files from the real `CLAUDE_PLUGIN_DATA` directory, probe `agy` (not the retired `gemini` CLI) plus council's system tools, detect keyring Codex login, add `goal-gen`, `awk_nul`, Node 22.22 and `@cursor/sdk` probes, run the remote-agent classifier correctly, and tighten the gt-workflow, yellow-ruvector, yellow-debt, yellow-ci, yellow-browser-test and yellow-council rules.
