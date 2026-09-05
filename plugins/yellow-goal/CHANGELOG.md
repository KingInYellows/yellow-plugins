# yellow-goal

## 0.2.0

### Minor Changes

- [`c9733b8`](https://github.com/KingInYellows/yellow-plugins/commit/c9733b8c3ba1c1bf27a7a1b07a8a15bfc9799325)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add the
  read-only `yellow-goal` engine bridge: `/goal:setup` probes a pinned
  `goal-gen` process (`version --json` vs `0.1.0`) and fail-closes on missing
  binary or mismatch; `/goal:request` wraps `request create` /
  `request validate`. The engine is spawned, never imported. Deterministic
  fake-process tests and a blocking public v0.1.0 release-artifact job cover the
  process contract, strict usage errors, identity checks, and bounded process
  termination.

- [`9133164`](https://github.com/KingInYellows/yellow-plugins/commit/9133164d923f58474af112d3103cb5d8f0f605ca)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Pin the
  released Yellow Goal engine `0.2.0` (annotated tag `v0.2.0`, public GitHub
  Release asset `goal-gen-0.2.0.tgz` with its SHA-256) and add the pure Provider
  Protocol v1 consumer guards: capability discovery validation, strict
  single-object and JSON Lines framing, run-event stream ordering, terminal
  summary/stderr/exit agreement, and additive protocol error codes with bounded
  diagnostics. The blocking public-artifact job now verifies the asset hash
  before installing it and performs the `capabilities --json` handshake.
  Existing `/goal:setup` and `/goal:request` behavior is unchanged; no run
  surface is exposed yet. Operators holding `goal-gen` 0.1.0 must reinstall the
  `goal-gen-0.2.0.tgz` release asset, because `/goal:setup` now fail-closes on
  the old version.

- [`dd3a2e6`](https://github.com/KingInYellows/yellow-plugins/commit/dd3a2e650b68d598e08577d47e85fe474528b9e6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add the
  fixed-authority `/goal:run-stub` operation: an asynchronous engine process
  transport that probes `version` and `capabilities` against the pin, then runs
  exactly
  `run --executor stub --protocol v1 --stub-scenario <scenario> [--timeout-ms <n>] [--yes] -- <request>`
  with closed stdin, a credential-free scratch environment, bounded JSON Lines
  streaming, one absolute deadline, SIGTERM-then-SIGKILL cancellation and
  exactly-once settlement. Results carry only the validated terminal summary and
  bounded diagnostics. The blocking public-artifact job now also drives every
  stub scenario, the noninteractive gate, the engine timeout and a forwarded
  SIGTERM through the installed `v0.2.0` asset with real-provider traps and an
  unchanged scratch target. No executor, protocol, target or raw-argv selector
  is exposed; `/goal:setup` and `/goal:request` are unchanged. The yellow-core
  setup dashboard now names the `0.2.0` engine pin.

### Patch Changes

- [`3a91fdd`](https://github.com/KingInYellows/yellow-plugins/commit/3a91fdd4280345df04846374c93d95ae3d5b0fe6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  `/goal:run-stub` hygiene: the test-only `GOAL_GEN_SCRATCH` override is
  stripped from the production CLI environment (scratch trees are always
  removed, and cleanup failures never mask the run outcome), the request-path
  allowlist counts bytes so a newline cannot slip past command substitution, the
  released-artifact smoke asserts every `git` exit status, and the security doc
  states the trusted local-executable boundary explicitly.

- [`84fa929`](https://github.com/KingInYellows/yellow-plugins/commit/84fa929fa619d0f14008750c80034a33b82a1aba)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Tighten
  `/goal:run-stub`: the zero-spend check now exempts only an actual
  `budget-exhausted` terminal (a budget-exhausted request that ended cancelled
  must report zero cost), and the command's request-path validation restores the
  explicit safe-character allowlist ahead of the canonical yellow-core check.
