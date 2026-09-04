# yellow-goal Plugin

Read-only process bridge to the yellow-goal `goal-gen` engine. Spawn the
engine, parse JSON stdout / structured stderr, discriminate exit codes
0 / 2 / 1. **Never** import TypeScript from yellow-goal, `npm link` it, or
copy its schemas as a second source of truth.

## Process contract

- Pin: `0.1.0` in `src/pin.ts`. `/goal:setup` fail-closes on missing binary
  (`GOAL_ENGINE_MISSING`) or `engineVersion` mismatch
  (`GOAL_ENGINE_VERSION_MISMATCH`).
- Consumer CLI: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js` — one JSON object
  on stdout, diagnostics on stderr, exit 0 / 1 / 2.
- Engine argv is always an array (`spawnSync`, `shell: false`). Override
  the binary with `GOAL_GEN_BIN` in tests only.
- Never `run --executor claude-code`, never `npm run runner`, never live
  `analyze` (it can spawn `claude -p`).

## Commands

- `/goal:setup` — `goal-gen version --json` vs the pin
- `/goal:request` — `request create` / `request validate` only

Out of scope this sprint: inspect / analyze / compile / run.

## Tests

`pnpm --filter yellow-goal test` uses an env-driven fake `goal-gen` on PATH
(`tests/fixtures/bin/goal-gen`). Do not point tests at a product clone.

The live tarball CI job (download GitHub Release `v0.1.0`, install into
mktemp, create/validate + `run --executor stub`) lands after that tag
exists. Until then the fake-binary suite is the blocking contract gate.
