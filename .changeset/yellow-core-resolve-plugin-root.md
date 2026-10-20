---
"yellow-core": patch
---

`/stack:status` and `stack-provider-router` locate `stack-provider-state.js`
when `CLAUDE_PLUGIN_ROOT` is unset. They try that variable, then the marketplace
checkout's `plugins/yellow-core`, then `yellow-core`'s `installPath` in
`installed_plugins.json`. A missing library still stops the command. Provider
classification is unchanged.
