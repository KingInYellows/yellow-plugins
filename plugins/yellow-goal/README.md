# yellow-goal

Read-only Claude Code bridge to the yellow-goal engine. Installs as
`yellow-goal@yellow-plugins` and talks to `goal-gen` **as a process**.

## Installation

```text
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-goal@yellow-plugins
```

Put a pinned `goal-gen` binary on PATH (GitHub Release tarball
`goal-gen-0.1.0.tgz` from tag `v0.1.0`), then run `/goal:setup`.

## Commands

- `/goal:setup` — probe `goal-gen version --json` against pin `0.1.0`
- `/goal:request` — `request create` / `request validate`

This plugin spawns the engine's version, request-create, and request-validate
operations. It never invokes `goal-gen run`, `analyze`, or `claude -p`, and
never imports yellow-goal source. Every request probes the pinned artifact
version before proceeding. The plugin version and engine version are independent
release identities.
