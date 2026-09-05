# yellow-goal

Claude Code bridge to the yellow-goal engine: read-only request operations plus
a zero-spend stub run. Installs as `yellow-goal@yellow-plugins` and talks to
`goal-gen` **as a process**.

## Installation

```text
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-goal@yellow-plugins
```

Put a pinned `goal-gen` binary on PATH (GitHub Release tarball
`goal-gen-0.2.0.tgz` from annotated tag `v0.2.0`; URL and SHA-256 in
`src/pin.ts`), then run `/goal:setup`.

## Commands

- `/goal:setup` — probe `goal-gen version --json` against pin `0.2.0`
- `/goal:request` — `request create` / `request validate`
- `/goal:run-stub` — one deterministic, zero-spend Provider Protocol v1 stub
  scenario (`success`, `failed`, `budget-exhausted`, `await-cancel`) through the
  pinned engine; reports the validated terminal summary only

This plugin spawns the engine's version, capabilities, request-create,
request-validate and stub-only `run --executor stub --protocol v1` operations.
It never selects a real executor, never invokes `analyze` or `claude -p`, and
never imports yellow-goal source. Every request probes the pinned artifact
version before proceeding. The plugin version and engine version are independent
release identities.
