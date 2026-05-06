# yellow-codex

## 0.2.2

### Patch Changes

- [`42eb0ef`](https://github.com/KingInYellows/yellow-plugins/commit/42eb0ef7f1316b2f332d22ada5c6f2a26d1c3438)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Fix auth
  detection for Codex CLI v0.118+ across `/codex:setup` and `/codex:status`

  Replace the `~/.codex/auth.json` file-existence check in `/codex:setup` Step 2
  and `/codex:status` Step 4 with a `codex login status` probe. The Rust-based
  CLI (v0.118+) stores OAuth state in the OS keyring (libsecret on Linux,
  Keychain on macOS, Credential Manager on Windows) rather than `auth.json`, so
  the old check reported "not configured" for every authenticated user on a
  current CLI.

  `codex login status` is the canonical, version-stable probe — it reads from
  wherever the installed CLI persists credentials and returns a string like
  `Logged in using ChatGPT` or `Not logged in`. The grep match is anchored to
  `^logged in` so the negative case `Not logged in` is not silently classified
  as authenticated. Both commands fall through to a "legacy auth.json found"
  note when the file still exists (for users on pre-v0.118 CLIs) and to "not
  configured" otherwise.

  Companion doc updates:
  - `plugins/yellow-codex/skills/codex-patterns/SKILL.md` — Authentication
    Methods table updated: ChatGPT OAuth row points to OS keyring with
    `codex login status` as the state probe; legacy `auth.json` retained as a
    separate row for pre-v0.118. Prose corrected to scope `codex login status`
    to OAuth/keyring state; API key auth is checked via
    `[ -n "$OPENAI_API_KEY" ]`.
  - `plugins/yellow-codex/CLAUDE.md` — Required Environment section rewritten to
    describe the keyring-based storage and the `codex login status` probe.

  No agent or command behavior changes — `codex exec` invocations are unaffected
  (they read auth from wherever the CLI resolves it).

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
