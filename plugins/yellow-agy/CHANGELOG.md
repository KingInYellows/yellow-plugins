# yellow-agy

## 0.2.3

### Patch Changes

- [#1809](https://github.com/KingInYellows/yellow-plugins/pull/1809)
  [`b51a9e7`](https://github.com/KingInYellows/yellow-plugins/commit/b51a9e7e60f99caa95d629384807c76ac4625da5)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Claude Code
  2.1.323 follow-ups (CLAUDE-338): yellow-claudemod declares
  `engines["claude-code"]: ">=2.1.301"` and imports `./policy` without a `.ts`
  extension, clearing the new TS5097 validator warning. The git-worktree
  manager, the review-gate shadow run and yellow-agy now name the Claude Code
  Bash sandbox when `git worktree add` or `remove` fails read-only.

## 0.2.2

### Patch Changes

- [#1719](https://github.com/KingInYellows/yellow-plugins/pull/1719)
  [`63f8873`](https://github.com/KingInYellows/yellow-plugins/commit/63f887385e74fc8ee4146ebad1d69464957f1c1c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Stabilize the
  bridge Linux group timeout test: check every member of the killed process
  group, ignoring zombies, and give a busy runner up to two seconds to show them
  gone.

- [#1697](https://github.com/KingInYellows/yellow-plugins/pull/1697)
  [`98a4b9d`](https://github.com/KingInYellows/yellow-plugins/commit/98a4b9d4d843d42438a94b3f1e43496fd15b5a62)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - `/agy:setup` no
  longer asks the owner to add `"useG1Credits": false` by hand. agy saves that
  key with omitempty, so it drops `false` whenever it rewrites `settings.json`
  (seen when agy self-updated to 1.5.1), and an absent key now counts as off.
  Setup refuses with `AGY_OVERAGES` only when `useG1Credits` is `true`, or when
  `userSettings.useAiCredits` in `~/.gemini/config/config.json`, which agy
  copies into `useG1Credits` at startup, is `true`.

## 0.2.1

### Patch Changes

- [#1679](https://github.com/KingInYellows/yellow-plugins/pull/1679)
  [`a74fd70`](https://github.com/KingInYellows/yellow-plugins/commit/a74fd7024179c0a8a3e2cecf3c6529f25adb642c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - On the
  Windows/WSL bridge, a timed-out host command (git, mkdir, tee, rm) now kills
  its Linux process group instead of only `wsl.exe`, and waits for that kill
  before the call fails (CLAUDE-246). Host commands run under the same
  `setsid -w` wrapper and pgid line as agy turns. The
  `wsl.exe -e kill -s KILL -- -<pgid>` group kill was confirmed on the owner's
  Windows PC.

- [#1677](https://github.com/KingInYellows/yellow-plugins/pull/1677)
  [`2f05dfc`](https://github.com/KingInYellows/yellow-plugins/commit/2f05dfcf6a65a2b3bc8240e3eef806185bf821b6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fit every
  `/agy:*` call inside the wrappers' 600 s Bash timeout (CLAUDE-255). A new
  `Budget` counts from process start: host commands (git, mkdir, tee, rm) are
  cut to what is left and, until the turn spawns, leave a 60 s turn's worth
  free; the turn's print timeout is shortened to fit; and a call that can no
  longer fit a 60 s turn after the quota probe refuses with the new `AGY_BUDGET`
  code, refunding the task or corrective round. Before, slow git could push the
  call past the wrapper, which killed it before it settled.

- [#1681](https://github.com/KingInYellows/yellow-plugins/pull/1681)
  [`f6c4ad4`](https://github.com/KingInYellows/yellow-plugins/commit/f6c4ad44848ecf6edae8adf7c2952cdc85553776)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - `setup` now
  runs `agy mcp list` itself and refuses with `AGY_MCP` before it records
  host.json when a server is enabled, the command fails, or its table can't be
  parsed (pinned to the agy 1.4.12 output captured on the owner's PC). The owner
  can keep a server by naming it with `setup --allow-mcp <name>` and typing the
  code shown on their own terminal; setup then warns that its tools bypass the
  command allowlist and flags an unpinned launch line.

- [#1672](https://github.com/KingInYellows/yellow-plugins/pull/1672)
  [`0c8bc40`](https://github.com/KingInYellows/yellow-plugins/commit/0c8bc4097877f02adbda91c65f51dc8cbb42d0ac)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  `/linear:delegate` can hand a Linear issue to the local agent, yellow-agy
  (CLAUDE-261). The remote-agent classifier reports yellow-agy under
  `localAgent` and returns the new `READY_AGY` state when no remote-agent
  provider is enabled; yellow-agy sits outside the group's exactly-one rule, so
  it never causes a `CONFLICT`. `--provider agy` picks it in any other state.
  The agy branch runs a plan-only `delegate` on a new `agy/<ISSUE-ID>-r<rev>`
  branch under the owner's grant, and prints the owner's `authorize` line when
  none covers it. After 2026-11-11, `READY_JULES` points to yellow-agy.
  `setup:all` probes `agy_cli_resolved`, and `validate-provider-groups` checks
  the local agent at every consumer site.

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
