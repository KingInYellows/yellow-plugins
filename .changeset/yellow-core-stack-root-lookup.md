---
"yellow-core": patch
---

`/stack:status` and `stack-provider-router` find `stack-provider-state.js`
when `CLAUDE_PLUGIN_ROOT` is unset. They try that variable, then the enabled
`yellow-core@yellow-plugins` install path from `claude plugin list --json`,
then `plugins/yellow-core` in the current checkout. Enablement still comes
only from that plugin list. A missed library is an error, not a guess about
which stacked-PR provider is active.
