---
'yellow-review': patch
---

`/review:pr` and `/review:all` no longer select the plugin-surface reviewers
(`pattern-recognition-specialist`, `plugin-contract-reviewer`,
`cli-readiness-reviewer`, `agent-cli-readiness-reviewer`,
`agent-native-reviewer`) when a `plugin.json` diff changes only its
`"version"` line, as in Changesets' version-packages PRs. Any other manifest
change still selects them.
