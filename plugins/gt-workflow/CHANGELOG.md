# Changelog

## 1.5.3

### Patch Changes

- [#532](https://github.com/KingInYellows/yellow-plugins/pull/532)
  [`be06a57`](https://github.com/KingInYellows/yellow-plugins/commit/be06a571a9e8817870eec61b5844aec3c5182163)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: remediate
  7 security-debt patterns across 6 plugins and root scripts

  Targeted fixes for the security-debt findings (006, 009, 017, 022, 023,
  032, 033) from the 2026-05-13 audit.
  - **006** `yellow-research/scripts/install-ast-grep.sh`: replace `curl … | sh`
    with download-to-temp over `--proto =https`, shebang sanity-check, then
    execute the local copy. The uv installer URL is version-pinned for
    reproducibility.
  - **009** `scripts/export-ci-metrics.sh`: allowlist-validate `STAGE` /
    `STATUS` and validate `ADDITIONAL_LABELS` key/value pairs before they are
    embedded in Prometheus label output — prevents label injection.
  - **017** `yellow-devin/commands/devin/delegate.md`: validate the git remote
    URL format and wrap the gathered Repository/Branch context in
    `--- begin/end repository context (reference only) ---` fencing before it
    enters the Devin task prompt.
  - **022** `yellow-composio/hooks/check-mcp-url.sh`: drop the brittle hardcoded
    cache-path fallback for `CLAUDE_PLUGIN_ROOT` — skip the credential-status
    write when it is unset rather than guessing a path.
  - **023** `yellow-ci/hooks/scripts/session-start.sh`: hash the `$PWD`-derived
    cache key (md5, 32 chars) so deeply-nested paths cannot exceed the 255-byte
    filename limit and break the cache path.
  - **032** `gt-workflow/hooks/check-commit-message.sh`: extend the `-m` grep to
    also match single-quoted arguments — `-m 'feat: x'` previously bypassed
    conventional-commit enforcement entirely.
  - **033** `yellow-morph/lib/install-morphmcp.sh`: validate `owner_pid` is
    numeric before `kill -0`, treating an empty/corrupt pid file as a stale lock
    instead of passing garbage to `kill`.

  Gates: `pnpm validate:plugins`, yellow-ci Bats (147), shellcheck, bash -n —
  all green.

## 1.5.2

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

## 1.5.1

### Patch Changes

- [`40f6767`](https://github.com/KingInYellows/yellow-plugins/commit/40f67673bca785741114c05aba73b8445e20ce72)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Apply
  mechanical audit followups (2026-05-07 audit):
  - **C-02 (yellow-core):** update three legacy 2-segment `subagent_type:`
    references in `commands/workflows/plan.md` lines 90/98/132 to the 3-segment
    runtime form (`yellow-core:research:repo-research-analyst`,
    `yellow-core:research:best-practices-researcher`,
    `yellow-core:workflow:spec-flow-analyzer`). Clears three INFO warnings from
    `pnpm validate:agents`.
  - **M-02 (yellow-morph):** mark `hooks/scripts/prewarm-morph.sh` as
    executable. The hook already worked because `bash script.sh` was the
    invocation form, but the missing `+x` bit raised a WARNING in
    `pnpm validate:schemas`.
  - **C-01 (gt-workflow):** document the un-namespaced command convention
    exception in `CLAUDE.md`. The seven gt-workflow commands ship without the
    `namespace:verb` prefix intentionally — they predate the namespacing
    convention. No behavior change; documentation only.

  Companion to PR #436 (X-02 validator fix) and the broader audit followups plan
  at `plans/audit-followups-2026-05-07.md`.

## 1.5.0

### Minor Changes

- [`2a3eec7`](https://github.com/KingInYellows/yellow-plugins/commit/2a3eec795a89a5497cd524fa2b9e2cfb2e18fc13)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add two
  platform-level guards motivated by the Graphite merge-queue research:
  - `gt-setup` Phase 1 now detects whether GitHub native merge queue is
    configured for the repo and emits a soft advisory if so. Graphite and GitHub
    native queue are incompatible — running both causes Graphite to restart CI
    on queued commits and may produce out-of-order merges. Detection uses
    `gh api graphql` to query `repository.mergeQueue.url`. Fail-open on any
    error (`COULD NOT CHECK`) so setup is never blocked.
  - `gt-cleanup` now distinguishes "closed without merging" from "merged" in the
    Closed PR category. When any PR for the branch has `state == "CLOSED"`
    (queue ejection, abandoned PR, or any close-without-land — `gh pr list`
    represents merged PRs as `state == "MERGED"`, so `CLOSED` is by itself
    unambiguous), the branch is tagged and a count warning appears in "Delete
    all" mode, plus a per-branch `closed (no merge — verify before deleting)`
    line in "Review individually" mode. Adds `mergedAt` to the existing
    `gh pr list --json` call (requested set is `state,mergedAt`) for display use
    only — no new API requests.

  Both changes apply to **all** Graphite users, not just users of Graphite's
  optional merge queue. No new dependencies. No breaking changes.

## 1.4.0

### Minor Changes

- [`88d7434`](https://github.com/KingInYellows/yellow-plugins/commit/88d7434839385322197d22eb67cc939d3bc3fcd4)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/gt-cleanup` command for branch cleanup and divergence reconciliation. Scans
  local branches for staleness (orphaned, closed PR, aged out) and bidirectional
  divergence (behind/ahead of remote), with category-based cleanup actions using
  `gt delete`, `gt get`, and warn-only for unpushed branches. Complements
  `/gt-sync` which handles merged branches.

- [`b9c6e5b`](https://github.com/KingInYellows/yellow-plugins/commit/b9c6e5bf422027828c99c0537aa4597d604af100)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  `/gt-setup` from validation-only into a 3-phase AI agent configuration wizard:
  prerequisite validation, guided Graphite CLI settings (branch prefix, pager,
  dates, submit body), and convention file + PR template generation. Update
  consumer commands (`/smart-submit`, `/gt-amend`, `/gt-stack-plan`) to read
  `.graphite.yml` for repo-level behavior overrides. Add `.graphite.yml` and PR
  template checks to `/setup:all` dashboard.

### Patch Changes

- [`1741901`](https://github.com/KingInYellows/yellow-plugins/commit/17419010b0ef8a278684f8f146d7dc86ea005840)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Summary

  feat(yellow-core): add /worktree:cleanup command for smart git worktree
  cleanup

  New `/worktree:cleanup` command in yellow-core that scans all git worktrees,
  classifies them into 7 categories (missing directory, locked, branch merged,
  stale, clean-active, dirty, detached HEAD), and removes stale worktrees with
  appropriate safeguards.

  Also adds Phase 6 to `/gt-cleanup` in gt-workflow to offer triggering
  `/worktree:cleanup` via Skill tool with graceful degradation.

## 1.3.0

### Minor Changes

- [`2775f9b`](https://github.com/KingInYellows/yellow-plugins/commit/2775f9ba0617e6c9cf1f83cc4e604ebc8ee3b450)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Repurpose
  gt-stack-plan as plan-only decomposition tool. Removes branch creation phase
  (Phase 3) and writes structured `## Stack Decomposition` section to plan files
  instead. Branches are created just-in-time during `workflows:work` execution.

### Patch Changes

- [`d791c9c`](https://github.com/KingInYellows/yellow-plugins/commit/d791c9c208abd62c4673c7f0522b2e4cdb341bf6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Migrate
  branch-push `git push` references to `gt submit --no-interactive` across
  operational docs. Tag pushes remain unchanged. Adds Graphite callout to
  git-auth.md.

- [`474795e`](https://github.com/KingInYellows/yellow-plugins/commit/474795e8964d358acb047e392b56620a65e817ea)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add stack
  decomposition output format contract defining the structured markdown
  interface between gt-stack-plan (producer) and workflows:work (consumer).

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.2.0] - 2026-03-10

### Minor Changes

- Add Graphite MCP server (stdio via `gt mcp`) as bundled MCP server in
  plugin.json. Extend `/gt-setup` to validate gt CLI version 1.6.7+ for MCP
  availability. Update CLAUDE.md with MCP tool documentation.
- Add `/gt-setup` to validate Graphite CLI availability, auth detection, and
  repo initialization before running workflow commands.

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.1.1] - 2026-03-06

### Patch Changes

- [`9a28a2d`](https://github.com/KingInYellows/yellow-plugins/commit/9a28a2dd7570f741c80c0eb07bdda32165ad5f14)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/linear:work` bridge command and cross-plugin integration connectors.
  yellow-linear gets a minor bump (new command), yellow-core and gt-workflow get
  patch bumps (behavioral additions to existing commands).

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — Graphite-native workflow commands for stacked PRs, smart
  commits, sync, and stack navigation.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
