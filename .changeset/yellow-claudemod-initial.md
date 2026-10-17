---
'yellow-claudemod': minor
'yellow-core': patch
---

Add yellow-claudemod (experimental, Claude Code 2.1.301 or later), the first
plugin in this marketplace that is a Claude Code mod: a TypeScript hooks module
rather than command hooks. It records every subagent spawn (the agent, the model
asked for, the model it ran on, the fullest usage window) and shows them with
`/claudemod-status`. With `downshift_enabled` on (off by default), eight
Opus-tier reviewers and synthesizers run on Sonnet once a Max usage window
passes `downshift_threshold` (default 80%); security-sentinel, forks, resumes
and calls that name a model are never changed. `/claudemod:setup` checks the
Claude Code version. `/setup:all` now covers the plugin.
