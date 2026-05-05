# Changelog

## 2.3.0

### Minor Changes

- [#259](https://github.com/KingInYellows/yellow-plugins/pull/259)
  [`160f021`](https://github.com/KingInYellows/yellow-plugins/commit/160f02182e5e37d66658fcd1d567893bf3026e0e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Roll out
  userConfig-based credential storage across five plugins, replacing or
  augmenting shell environment variable lookups with Claude Code userConfig.
  - **yellow-semgrep** (BREAKING): `SEMGREP_APP_TOKEN` is now read from
    `userConfig.semgrep_app_token` instead of the shell environment variable.
    Users who supplied the token only via `SEMGREP_APP_TOKEN` in their shell
    profile must re-enter it via the userConfig prompt (run `/semgrep:setup`);
    the shell env path no longer feeds the MCP server at startup.
  - **yellow-research** (BREAKING): All three API keys (`PERPLEXITY_API_KEY`,
    `TAVILY_API_KEY`, `EXA_API_KEY`) are migrated to userConfig. Existing users
    who relied solely on shell env vars must answer the userConfig prompt to
    continue using the plugin; run `/research:setup` to re-enter credentials.
  - **yellow-devin** (additive): HTTP-MCP userConfig declaration added for
    `devin_service_user_token` and `devin_org_id`. The shell env fallback
    (`DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID`) continues to work; no action
    required for current users.
  - **yellow-core** (additive): New `mcp-health-probe` skill defining a
    canonical three-state MCP health classification (OFFLINE / DEGRADED /
    HEALTHY) for `/<plugin>:status` commands. The existing
    `mcp-integration-patterns` skill is split into three focused sub-skills for
    narrower auto-invocation: `memory-recall-pattern`,
    `memory-remember-pattern`, and `morph-discovery-pattern`. The umbrella
    `mcp-integration-patterns` skill is retained until consumers migrate. The
    `/setup:all` env-variable dashboard gains a `check_key()` helper that
    reports shell env vs userConfig state per credential.

## [2.2.0] - 2026-04-17

### Minor Changes

- **Adopt `userConfig` for credential entry.** `DEVIN_SERVICE_USER_TOKEN`
  (sensitive) and `DEVIN_ORG_ID` (non-sensitive — IDs are not secrets) are now
  declared as `userConfig` fields in `plugin.json`. Claude Code prompts for them
  at plugin-enable time and stores the token in the system keychain (or
  `~/.claude/.credentials.json` at 0600 perms on Linux). Commands still read the
  shell env vars for curl invocations, so existing shell-env setups continue to
  work unchanged — userConfig is an additive UX improvement, not a breaking
  change. `/setup:all` now classifies the plugin READY when either source is
  present.
- `/devin:setup` now emits a dual-source drift WARNING when userConfig is
  configured but the corresponding shell env var is empty, noting that
  `/devin:*` curl-based commands will return 401 until the shell export is also
  added.

### Migration (existing users)

- No action required for existing shell-env setups — they continue working
  unchanged. `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` shell exports are
  still read by all `/devin:*` commands.
- Recommended for new installs: answer the userConfig prompt at plugin enable so
  the token is keychain-backed and Claude Code's MCP env substitution handles
  authentication for the MCP server without a shell export. **`/devin:*`
  curl-based commands still need the same values exported in the shell** — they
  do not read userConfig directly. In this release the two sources remain
  independent for backward compat: keychain backs the MCP, shell env backs the
  curl-based commands. Power users who want the curl path to work without a
  shell export can author a thin per-command CLI bridge that resolves the
  credential from the keychain at invocation time — see yellow-morph's
  `bin/start-morph.sh` for a reference pattern of that shape.

## 2.1.2

### Patch Changes

- [#255](https://github.com/KingInYellows/yellow-plugins/pull/255)
  [`3b4025e`](https://github.com/KingInYellows/yellow-plugins/commit/3b4025e8c1af062223ea8db4bf6b067f439156c6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Set memory
  scope on workflow orchestrators; sharpen overlap descriptions

  Add `memory: project` to 4 workflow orchestrators (brainstorm-orchestrator,
  knowledge-compounder, spec-flow-analyzer in yellow-core; devin-orchestrator in
  yellow-devin) so they accrue cross-session learning per project. The correct
  frontmatter form is a scope string (`user`/`project`/`local`), not the boolean
  `memory: true` used elsewhere in the codebase.

  Also correct invalid `memory: true` to `memory: project` on the remaining 12
  agents that were not covered by the parent PR's review-agent sweep:
  yellow-core (repo-research-analyst, git-history-analyzer, security-reviewer,
  performance-reviewer, security-lens, session-historian), yellow-research
  (code-researcher, research-conductor), yellow-docs (doc-auditor,
  doc-generator, diagram-architect), and yellow-review
  (project-compliance-reviewer). After this PR, no agent in the repository
  declares the invalid `memory: true`.

  Note on tool surface: per Claude Code docs, `memory: <scope>` automatically
  enables Read/Write/Edit so agents can persist learnings to
  `.claude/agent-memory/<name>/`. For yellow-review's review agents — which the
  plugin's CLAUDE.md documents as "report findings, do NOT edit project files
  directly" — the prompt-level read-only contract remains the source of truth;
  the orchestrating `/review:pr` command applies all fixes. The implicit
  Write/Edit grant is required for memory persistence and does not reflect a
  change in agent responsibility.

  Sharpen the `description:` trigger clauses for two overlap pairs:
  - security-sentinel (active vulnerabilities) vs security-debt-scanner (debt
    patterns that could become vulnerabilities)

  The code-simplicity-reviewer vs code-simplifier pair already had clear
  pre-fix/post-fix trigger clauses — no change needed there.

## 2.1.1

### Patch Changes

- [`9c01fbf`](https://github.com/KingInYellows/yellow-plugins/commit/9c01fbf4f95973bdeab77a67eb4b68d62d0bdc29)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix 403 error
  when sending messages to Devin sessions by adding ManageOrgSessions permission
  probe to setup and PR comment fallback to message/review-prs commands

## 2.1.0

### Minor Changes

- [`f2e890a`](https://github.com/KingInYellows/yellow-plugins/commit/f2e890aff6868a7926eab930c20dbddc33c2683f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add a
  `/devin:review-prs` command for discovering Devin-authored PRs in the current
  repository, triaging review findings, and choosing whether to fix them locally
  or send remediation back to Devin.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.1] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [2.0.0] - 2026-02-23

### Added

- Add devin-orchestrator agent for multi-step plan-implement-review cycles.

### Changed

- Migrate to Devin V3 API. Breaking change: all session management endpoints
  updated.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — Devin.AI integration for multi-agent workflows: delegate
  tasks, research codebases, orchestrate plan-implement-review chains.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
