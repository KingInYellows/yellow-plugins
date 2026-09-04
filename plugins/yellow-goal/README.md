# yellow-goal

Read-only Claude Code bridge to the yellow-goal engine. Installs as
`yellow-goal@yellow-plugins` and talks to `goal-gen` **as a process**.

## Installation

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-goal@yellow-plugins
```

Put a pinned `goal-gen` binary on PATH (GitHub Release tarball
`goal-gen-0.1.0.tgz` once tag `v0.1.0` exists), then run `/goal:setup`.

## Commands

- `/goal:setup` — probe `goal-gen version --json` against pin `0.1.0`
- `/goal:request` — `request create` / `request validate`

This plugin does not run the engine, does not call `claude -p`, and does
not import yellow-goal source.
