# yellow-codex

## 0.2.1

### Patch Changes

- [`ab3f2d3`](https://github.com/KingInYellows/yellow-plugins/commit/ab3f2d365c911d8f5bdeff9f9cf0f141f254fb03)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Enable true
  parallel execution for multi-agent review sessions

  Add `background: true` to 15 agents (7 in yellow-core/agents/review, 6 in
  yellow-review/agents/review, plus
  `yellow-core/agents/research/best-practices-researcher` and
  `yellow-review/agents/workflow/pr-comment-resolver`) and update four
  orchestrator commands (`review-pr.md`, `resolve-pr.md`, `work.md`, `audit.md`)
  to explicitly require `run_in_background: true` on each Task invocation, with
  explicit wait gates (TaskOutput / TaskList polling) before any step that
  consumes agent output. Frontmatter flag alone is insufficient — the spawning
  call must also run in the background for agents to run concurrently rather
  than serially.

  Memory field changes: drop the prior `memory: true` from review and research
  agents (it was a no-op and re-adding a scope value would silently activate
  per-spawn MEMORY.md injection of up to ~25 KB across 13+ parallel agents). Set
  `memory: project` only on the three workflow orchestrators
  (`brainstorm-orchestrator`, `knowledge-compounder`, `spec-flow-analyzer`),
  where MEMORY.md context is intentional and the spawn fan-out is small.
  Auditing the broader `memory:` activation across review agents remains a Phase
  1.5 follow-up (plan open question 8).

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
