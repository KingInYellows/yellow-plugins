# Changelog

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
