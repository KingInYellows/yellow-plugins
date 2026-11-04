# yellow-agy

## 0.2.0

### Minor Changes

- [#1607](https://github.com/KingInYellows/yellow-plugins/pull/1607)
  [`15cbb5d`](https://github.com/KingInYellows/yellow-plugins/commit/15cbb5d1e590a607e9d640ee895342440a9ecc79)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add the
  yellow-agy adapter core: the per-host agy invocation builder (env scrub,
  hook-disabling git config, exec-only WSL bridge, Windows command-line limit),
  the read-only and implement permission profiles, turn argv, result
  classification and the AGY\_\* error catalog. Library only; no command uses it
  yet.

- [#1651](https://github.com/KingInYellows/yellow-plugins/pull/1651)
  [`3be47ea`](https://github.com/KingInYellows/yellow-plugins/commit/3be47eabea4dde43559373851039746413dd361f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add the
  `/agy:*` commands (authorize, delegate, approve, reply, status, collect,
  abandon) and the CLI behind them: owner grants checked and charged inside each
  reservation, the `/usage` quota gate, terminal confirmation for creating
  grants and abandoning tasks, and a host record that `/agy:setup` writes after
  a new MCP-server check.

- [#1624](https://github.com/KingInYellows/yellow-plugins/pull/1624)
  [`867f29b`](https://github.com/KingInYellows/yellow-plugins/commit/867f29ba9973c9bbabe8960332e00c4b4b7e15d7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add the
  delegate lifecycle: worktree creation on a new branch, pre-turn snapshots with
  reset-partial, the local journal with request idempotency and a single
  active-run claim, the agy process runner, and collect/abandon with a
  secret-shape scan. Not wired to a command yet.

- [#1561](https://github.com/KingInYellows/yellow-plugins/pull/1561)
  [`a47f03a`](https://github.com/KingInYellows/yellow-plugins/commit/a47f03ae593a467bded4abfb0451711739081efd)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add yellow-agy,
  the experimental successor to yellow-jules: a local supervised delegate on the
  Antigravity CLI (`agy`) under the owner's Google AI Pro sign-in. This scaffold
  ships `/agy:setup`, a read-only check of where agy lives (on `PATH` or through
  an exec-only WSL bridge), its version, any API-key or Vertex variables in the
  caller's env or inside WSL, and whether overages are pinned off. `/setup:all`
  now lists yellow-agy and probes `wsl.exe`.
