# yellow-claudemod

## 0.1.2

### Patch Changes

- [`4d9a767`](https://github.com/KingInYellows/yellow-plugins/commit/4d9a767b6d0f079ae4311e2b45d93e201f2e69b6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Run ledger key
  pruning beside the write chain, one prune at a time, so a store call that
  never answers while pruning no longer holds up later spawns' rows.

## 0.1.1

### Patch Changes

- [`01a3f04`](https://github.com/KingInYellows/yellow-plugins/commit/01a3f04780d82387ef741e9efe34055d5c8b674d)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - The spawn
  ledger now keeps each session's rows under its own store key, so concurrent
  sessions no longer overwrite each other, and keeps the eight most recent
  sessions. A store call that never settles can no longer stall a subagent
  spawn: each ledger write gives up after 2 seconds. `/claudemod-status` says
  when the session's last ledger write failed. `/claudemod:setup` reports an
  installed but disabled plugin as disabled, with the command to enable it.

## 0.1.0

### Minor Changes

- [`f795c6f`](https://github.com/KingInYellows/yellow-plugins/commit/f795c6fae25869cb250dae0441c06cb1378fbf63)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-claudemod (experimental, Claude Code 2.1.301 or later), the first
  plugin in this marketplace that is a Claude Code mod: a TypeScript hooks
  module rather than command hooks. It records every subagent spawn (the agent,
  the model asked for, the model it ran on, the fullest usage window) and shows
  them with `/claudemod-status`. With `downshift_enabled` on (off by default),
  eight Opus-tier reviewers and synthesizers run on Sonnet once a Max usage
  window passes `downshift_threshold` (default 80%); security-sentinel, forks,
  resumes and calls that name a model are never changed. `/claudemod:setup`
  checks the Claude Code version. `/setup:all` now covers the plugin.
