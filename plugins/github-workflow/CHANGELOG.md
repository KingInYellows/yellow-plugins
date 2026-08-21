# github-workflow

## 0.3.0

### Minor Changes

- [#716](https://github.com/KingInYellows/yellow-plugins/pull/716)
  [`d422f55`](https://github.com/KingInYellows/yellow-plugins/commit/d422f55472f16bc14503236d7b64de5e9de4b15f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add the full
  `github-stack:*` command surface (plan, submit, amend, sync, nav, cleanup,
  merge) and the `github-stack-runtime.js` adapter that backs them. All mutating
  `gh stack` calls now go through the adapter's argument-array-only, validated,
  confirmation-gated execution — no command or skill invokes `gh stack <verb>`
  directly. `modify`/`switch` remain unsupported (TUI-only upstream); conflict
  recovery uses `rebase --continue`/`--abort`.

- [#716](https://github.com/KingInYellows/yellow-plugins/pull/716)
  [`d422f55`](https://github.com/KingInYellows/yellow-plugins/commit/d422f55472f16bc14503236d7b64de5e9de4b15f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `check-git-push` (PreToolUse) and `check-commit-message` (PostToolUse) hooks,
  mirroring `gt-workflow`'s safety net — previously a repo with only the GitHub
  provider enabled had no raw-`git push` block at all.

## 0.2.0

### Minor Changes

- [#712](https://github.com/KingInYellows/yellow-plugins/pull/712)
  [`495d3f7`](https://github.com/KingInYellows/yellow-plugins/commit/495d3f74a8843e8415e5124d5e763b6f2dfcf722)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Establish the
  stacked-PR provider foundation so a repository can eventually choose exactly
  one provider — Graphite (`gt-workflow`) or GitHub native stacks
  (`github-workflow`) — with no silent fallback between them.

  **yellow-core** gains the provider-neutral surface:
  - `/stack:status` — classifies provider state as `UNSELECTED`,
    `READY_GRAPHITE`, `READY_GITHUB`, `CONFLICT`, `CONFIG_MISMATCH`,
    `MANAGED_CONFLICT`, or `PARTIAL_TOOLING`. Read-only.
  - `/stack:select` — switches the active provider through
    `claude plugin install|enable|disable` after showing the exact commands,
    refuses managed-scope conflicts, never edits settings JSON, and directs the
    user to `/reload-plugins`.
  - `stack-provider-router` and `stack-provider-guard` skills.
  - `lib/stack-provider-state.js` — the single owner of the seven states and of
    switch planning, covered by deterministic fixture tests.
  - `/setup:all` now documents alternative provider groups and offers setup for
    the enabled provider only, so no user is asked to configure both.

  **github-workflow** is a new provider skeleton: `/github-stack:setup` and
  `/github-stack:status` verify `gh`, authentication, and that the installed
  `gh stack` extension is the official `github/gh-stack` (three third-party
  lookalikes expose the same command name). No MCP server, no hooks, and no
  `gh stack` operation is invoked.

  Foundation only — stack creation, submission, amendment, synchronisation,
  cleanup, and merging are not implemented, `flow:work` is unchanged, and the
  repository's Graphite workflow is untouched. See
  `plans/stacked-pr-provider-abstraction.md` and
  `docs/research/2026-08-16-github-native-stacks-vs-graphite.md`.
