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
`goal-gen-0.3.0.tgz` from annotated tag `v0.3.0`; URL and SHA-256 in
`src/pin.ts`), then run `/goal:setup`.

## Commands

- `/goal:setup` — probe `goal-gen version --json` against pin `0.3.0`
- `/goal:request` — `request create` / `request validate`
- `/goal:run-stub` — one deterministic, zero-spend Provider Protocol v2 stub
  scenario (`success`, `failed`, `budget-exhausted`, `await-cancel`) through the
  pinned engine; reports the validated terminal summary only
- `/goal:run-real` — user-only real run. Displays the engine-rendered manifest,
  forwards an operator approval path, never passes `--yes`, never mints an
  approval, and reports spend and the bundle path when the outcome has them

This plugin spawns the engine's version, capabilities (`--protocol v2`),
request-create, request-validate, stub `run --executor stub --protocol v2`,
and real `run --protocol v2 --executor agx-claude-code` operations.
The real-run executor id is fixed; callers cannot select `--executor claude-code`
or a protocol. It never invokes `analyze` or `claude -p`, and never imports
yellow-goal source. Every request probes the pinned artifact version before
proceeding. The plugin version and engine version are independent release
identities.

## See also

- [Loop/graph lineage note](../../docs/research/2026-09-17-loop-graph-vs-yellow-harness.md)
  — community Loop Engineering, ADK 2, and goal-gen GOAP are three lineages.
  Mappings are analogous, not identity. This plugin remains a process bridge
  (`/goal:setup`, `/goal:request`, `/goal:run-stub`, `/goal:run-real`).
