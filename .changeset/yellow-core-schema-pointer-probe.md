---
"yellow-core": patch
---

Add `$schema` pointer to `https://json.schemastore.org/claude-code-plugin-manifest.json`
in `plugin.json`. Single-plugin probe — IDE/editor JSON Schema autocomplete
should now work, and Claude Code's plugin loader should silently ignore the
field per official docs ("Claude Code ignores this field at load time"). If
the remote validator unexpectedly rejects this key on install (similar to
the recent `userConfig.pattern` rejection), this single bump can be reverted
without affecting any other plugin.

Gates the broader 17-plugin rollout in a follow-up PR.
