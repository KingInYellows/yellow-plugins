# yellow-codex

## 0.2.0

### Minor Changes

- [`4f5cfff`](https://github.com/KingInYellows/yellow-plugins/commit/4f5cfff69febeb50853dbd49130eb452ce9d30a8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-codex plugin wrapping OpenAI Codex CLI with review, rescue, and setup
  workflows. Patch yellow-review to spawn codex-reviewer as an optional
  supplementary reviewer, and patch yellow-core to surface yellow-codex
  readiness plus delegate codex:setup from /setup:all.

### Patch Changes

- [`31da4b1`](https://github.com/KingInYellows/yellow-plugins/commit/31da4b14740f8eea7fc45501b94a2151c5a36009)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix shell
  portability and reliability in setup scripts. Replace bash-only version_gte()
  with POSIX-compatible implementation in install-codex.sh and
  install-semgrep.sh. Add fnm/nvm activation before Node version check and guard
  against fnm multishell ephemeral npm prefix in install-codex.sh. Fix dashboard
  reliability in setup:all by replacing Python heredoc with python3 -c,
  snapshotting tool paths to prevent PATH drift, and using find|xargs instead of
  find|while for plugin cache detection. Add web-app pre-flight check to
  browser-test:setup.

## 0.1.0

### Minor Changes

- Initial release: plugin scaffold, setup command, review command,
  codex-reviewer agent
