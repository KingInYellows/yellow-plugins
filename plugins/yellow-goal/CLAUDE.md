# yellow-goal Plugin

Read-only process bridge to the yellow-goal `goal-gen` engine. Spawn the engine,
parse JSON stdout / structured stderr, discriminate exit codes 0 / 2 / 1.
**Never** import TypeScript from yellow-goal, `npm link` it, or copy its schemas
as a second source of truth.

## Process contract

- Pin: `0.2.0` in `src/pin.ts` (annotated tag `v0.2.0`, public Release asset URL
  and SHA-256 live there too). `/goal:setup` fail-closes on missing binary
  (`GOAL_ENGINE_MISSING`) or `engineVersion` mismatch
  (`GOAL_ENGINE_VERSION_MISMATCH`). `tests/release-pin.test.ts` keeps
  `scripts/verify-goal-release.sh` in agreement with the pin.
- Consumer CLI: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js` — one JSON object on
  stdout, diagnostics on stderr, exit 0 / 1 / 2.
- Engine argv is always an array (`spawnSync`, `shell: false`), with a 30-second
  timeout and forced termination. Override the binary with `GOAL_GEN_BIN` in
  tests only. Create/validate probe the pin before acting.
- Each successful engine operation emits exactly one JSON line with empty
  stderr. Usage failures use structured stderr and exit 2. Schema-invalid
  validation uses `{valid:false,errors}` on stdout, empty stderr, and exit 1.
- Never `run --executor claude-code`, never `npm run runner`, never live
  `analyze` (it can spawn `claude -p`).

## Commands

- `/goal:setup` — `goal-gen version --json` vs the pin
- `/goal:request` — `request create` / `request validate` only

Out of scope: inspect / analyze / compile / run. `src/provider-protocol.ts`
holds the pure Provider Protocol v1 consumer guards (discovery, JSON Lines
framing, run-event ordering, terminal/stderr/exit agreement) as independent
observable-data checks, never copied engine schemas; the fixed stub-run
transport that uses them lands separately.

## Tests

`pnpm --filter yellow-goal test` uses an explicit Node executable with a
test-only preload (`tests/fixtures/fake-engine.mjs`), so no shell fixture or
ambient engine is needed. Do not point tests at a product clone.

The blocking `Released Goal Engine Compatibility` CI job downloads the public
GitHub Release `v0.2.0` tarball, verifies its SHA-256 before installing it into
a temporary consumer with lifecycle scripts ignored, and verifies version, the
`capabilities --json` protocol handshake, create/validate, usage errors, schema
rejection, and incompatible identity. It never invokes `run`, including the stub
executor. Engine artifact and plugin versions are distinct identities even when
their numbers coincide.
