# Changelog

All notable changes to the Yellow Plugins project will be documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** This file contains catalog-level release notes for the full
> marketplace snapshot. Per-plugin changelogs live in
> `plugins/<name>/CHANGELOG.md`.

---

## [2.1.41] - 2026-11-25

### Fixed

- **yellow-ruvector 2.1.1** fixes a flaky SessionStart test: it now waits for
  the old co-edit cursor temp to be swept before checking that it is gone. No
  hook behavior changes.

---

## [2.1.40] - 2026-11-25

### Changed

- **github-workflow 0.7.0** lets agents run a plain `git push`, including
  `git push -u origin <branch>`. Its hook still blocks force pushes, `--mirror`
  and branch deletes, which can break a pull request stacked on the branch, and
  any push it cannot read in full. Pushing a branch that belongs to a gh-stack
  stack gets a reminder to run `/github-stack:sync`.
- **gt-workflow 2.2.1** keeps blocking every raw `git push`; its copy of the
  shared push detector gains the `analyzeGitPushCommand` export.

### Fixed

- **yellow-core 2.17.3** makes `/setup:all`, `/stack:status` and the
  stack-provider-router skill probe only the stacked-PR provider the repository
  uses, so a GitHub-stacks repository never runs `gt`. `/setup:all` and
  `/statusline:setup` no longer report a plugin left only in the plugin cache as
  installed.

---

## [2.1.39] - 2026-11-24

### Added

- **yellow-docs 1.5.0** adds the technical-diagrams skill for Claude and Codex.
  It updates Mermaid, draw.io, and connected canvas diagrams from project
  evidence while preserving human edits.

### Changed

- **yellow-ruvector 2.1.0** reads cached semantic recall at session start,
  refreshes it in the background, and records co-edits asynchronously. Replacing
  a store at the same path invalidates its cached recall.
- **yellow-ci 1.5.12** reads cached GitHub status at session start and refreshes
  it in the background.

### Fixed

- **yellow-morph 1.3.5** forwards proxy and CA settings during installation,
  including uppercase and lowercase proxy variables. Only selected npm
  configuration variables reach the installer.

---

## [2.1.38] - 2026-11-19

### Changed

- **yellow-review 4.0.0 (breaking), yellow-core 2.17.2, yellow-linear 2.3.2** —
  The owner's merge approval for medium and high tier pull requests is now a
  hand-added `merge-approved` label instead of `graphite-queue`.
  `check-merge-ready` counts it only when its latest addition was made by a
  listed human by hand (REST issue events report `performed_via_github_app` as
  null) after the head commit arrived; an addition made through a GitHub App
  never approves. Unreadable label events give the new `label_events_unknown`
  token, and the report's `queued` field and the merge-ready `Queue` row are
  gone (CLAUDE-345, #1863).
- **yellow-linear 2.3.2, yellow-review 4.0.0** — `/linear:setup` checks the
  stack tool for the active stacked-PR provider (`gt` for Graphite, the
  `gh-stack` extension for GitHub) and points to `/stack:status` when the
  provider is unresolved. yellow-review's CLAUDE.md says `commit-resolve-fixes`
  submits through its provider and verifies the remote head (CLAUDE-359, #1870).
- **github-workflow 0.6.0** — The stack `merge` preview reads the landing set
  from the Stacks REST API the way `gh stack merge` does, and a confirmed merge
  must carry the previewed `repository` and `previewToken`; it is refused when
  the set, a head commit, the base or the method changed. `merge-single` also
  checks the Stacks API for stack membership, lists open pull requests built on
  its branch, and lands into a release or hotfix branch only when that base is
  named with `--base` (CLAUDE-361, #1872).

### Fixed

- **github-workflow 0.6.0, yellow-core 2.17.2** — github-workflow `merge` names
  the repository gh-stack would merge in and refuses an ambiguous one, a URL for
  another repository, or a repository that changed since the preview;
  `merge-single` reports where the head branch lives. yellow-core reads gh-stack
  prerelease versions, and `/setup:all` checks for git 2.36+ with the GitHub
  provider (CLAUDE-347, #1856).
- **yellow-review 4.0.0** — `check-merge-ready` fails closed on a
  `merge-approved` label event whose time does not parse (approval unknown while
  the label is on, a definite `approval_required` once it is off) (CLAUDE-360,
  #1868).

---

## [2.1.37] - 2026-11-18

### Changed

- **yellow-ci 1.5.11, yellow-goal 0.4.2** — The typed-only commands are named in
  a description Claude still sees. `/ci:runner-cleanup` and `/goal:run-real` set
  `disable-model-invocation: true`, which hides their own descriptions, so the
  `/ci:runner-health` description now says disk cleanup is typed-only and the
  `/goal:run-stub` description says a real, paid run is typed-only. Asked in
  plain language, Claude tells the user to type them instead of working around
  them (CLAUDE-341, #1858).

### Fixed

- **yellow-core 2.17.1, yellow-morph 1.3.4, yellow-ruvector 2.0.7, yellow-review
  3.18.3** — Directory locks stay exclusive on Ubuntu 26.04, whose uutils
  `mkdir` can tell several racing callers they created the same directory. The
  compound-staging drain and Stop capture locks, the morph and ruvector install
  locks, the ruvector model lock and its reclaim markers are now claimed by an
  exclusive create of an `.owner` or `pid` file and released by renaming them
  aside. The `/setup:all` ruvector probe caps its writes at 2 MiB and still
  probes when `TMPDIR` is unusable, and yellow-review's ignored-file guard no
  longer makes `run-verify-command` refuse while a ruvector co-edit lock exists
  (CLAUDE-348, #1844).

---

## [2.1.36] - 2026-11-17

### Added

- **github-workflow 0.5.0** — `/github-stack:merge-single` merges an ordinary,
  unstacked pull request. It takes a pull request number and an explicit merge
  method, refuses a draft, a closed pull request and one GitHub reports as part
  of a stack, and merges only the head commit that was confirmed.
  `/github-stack:merge` now points an ordinary pull request to it (CLAUDE-347,
  #1841).

### Changed

- **github-workflow 0.5.0, yellow-core 2.17.0** — GitHub-native stacked pull
  requests are now the recommended stack provider, and the integration targets
  `gh-stack` 0.3.0. github-workflow drops the `--remote` flag gh-stack rejects,
  adopts existing branches bottom to top with `init`, adds a `push` operation,
  accepts a pull request URL in `merge`, and reports a retargeted base as
  `BASE_CHANGE_UNCONFIRMED` instead of success. The amend skill rebases the
  branches above before re-submitting, and the merge preview lists every pull
  request that will land. In yellow-core, the tooling probe reports `gh-stack`
  older than 0.3.0 or Git older than 2.36 as not ready, `UNSELECTED` recommends
  `/stack:select github` without selecting it, and `/setup:all` reports an
  outdated extension. Adds `docs/stacked-prs-native-migration.md` (CLAUDE-343,
  #1819).

### Fixed

- **yellow-core 2.17.0, yellow-ruvector 2.0.6** — Works with the uutils
  coreutils on Ubuntu 26.04. The `/setup:all` ruvector probe no longer stalls
  when `timeout` kills only its direct child, the compound-staging Stop capture
  and the Jev pre-filter cap transcript bytes without `tail -c` on a pipe, and
  the ruvector co-edit session and store locks stay exclusive when `mkdir`
  reports success to two racing callers (CLAUDE-346, #1832).

- **yellow-review 3.18.2** — Documents the `Skill(yellow-review:review:*)` allow
  rule that `/loop`, scheduled tasks and `claude -p` runs of `/review:sweep` and
  the other review commands need from Claude Code 2.1.325 (CLAUDE-339, #1814).

---

## [2.1.35] - 2026-11-16

### Changed

- **yellow-claudemod 0.1.3** — Declares `engines["claude-code"]: ">=2.1.301"` in
  its manifest, and imports `./policy` without a `.ts` extension, which clears
  the TS5097 warning `claude plugin validate` reports from Claude Code 2.1.323
  (CLAUDE-338, #1809).

### Fixed

- **yellow-core 2.16.1, yellow-review 3.18.1, yellow-agy 0.2.3** — When
  `git worktree add` or `remove` fails on a read-only path, the git-worktree
  manager, the review-gate shadow run and yellow-agy name the Claude Code Bash
  sandbox as the likely cause (CLAUDE-338, #1809).

---

## [2.1.34] - 2026-11-12

### Added

- **yellow-review 3.18.0, yellow-core 2.16.0** — Settled decisions in review:
  `/review:pr` and `/review:all` read the `(session-settled: …)` entries of the
  plan a PR names in its body or commits and set aside P2/P3 `maintainability`
  and `docs` findings that only re-argue one. Set-aside findings are listed
  under Coverage, not applied and not written to the ledger; defect findings
  keep full severity (CLAUDE-293, #1775).
- **yellow-core 2.16.0** — Every background compounding drain runs with
  `--max-budget-usd` (3.00 by default, `COMPOUND_DRAIN_MAX_BUDGET_USD` overrides
  it) and logs its `total_cost_usd`. `/compound:review-staged` pins the same
  model and cap as the SessionStart drain (CLAUDE-309, #1774).

### Changed

- **gt-workflow 2.2.0, yellow-core 2.16.0, yellow-linear 2.3.1, yellow-review
  3.18.0** — The eight gt-workflow entry points (`gt-setup`, `smart-submit`,
  `gt-amend`, `gt-stack-plan`, `gt-cleanup`, `gt-sync`, `gt-nav`, `gt-merge`)
  are user-invocable skills and the same-named wrapper commands are removed,
  because Claude Code resolved each pair to the wrapper. Type
  `/gt-workflow:<name>`; `/flow:work`, `/flow:plan`, `/linear:work` and
  `/setup:all` call them by qualified name (CLAUDE-307, #1769).

### Fixed

- **yellow-core 2.16.0** — `create-agent-skills` describes
  `disable-model-invocation` correctly: the entry point leaves the session
  listing, the Skill tool refuses it, and it runs only when typed (CLAUDE-308,
  #1773). The same skill names "the current Claude models" instead of a pinned
  generation (#1778).
- **yellow-goal 0.4.1** — The `/goal:request` and `/goal:setup` descriptions are
  on one line, so Prettier-wrapped text cannot break their frontmatter
  (CLAUDE-291, #1768).

---

## [2.1.33] - 2026-11-09

### Added

- **yellow-core 2.15.0, yellow-review 3.17.0** — Rule packs: team rules that
  need judgment, kept as one `.md` file each under `rule-packs/<id>/` with
  `title` and `applies_when` frontmatter. `/review:pr` gives them to
  `project-standards-reviewer`, read from the PR's base branch, and reports a
  contradiction as a finding citing `(pack: <id>, <file>)`; `/flow:plan` passes
  the matching ones to `learnings-researcher`. Rule text is sanitized and fenced
  as reference data, and machine-local packs come from `rule_pack_dirs`. Ships a
  seed `yellow-plugins` pack; format in `docs/rule-packs.md` (CLAUDE-211,
  #1732).
- **yellow-core 2.15.0** — Settled decisions carry across the flow workflow: a
  decision the user made with a tradeoff in view is recorded as
  `(session-settled: …)` in brainstorm docs, specs and plans, so later steps
  build on it instead of reopening it. `/flow:plan --non-interactive` returns
  `settled-decision-invalidated` when one cannot work (CLAUDE-212, #1729).
- **yellow-core 2.15.0, yellow-review 3.17.0** — `/flow:work` runs a simplify
  pass at the end of Phase 3 with `code-simplifier` and two new agents,
  `test-value-reviewer` and `comment-reviewer`; docs- and Markdown-only diffs
  are skipped (CLAUDE-214, #1721).

---

## [2.1.32] - 2026-11-07

### Added

- **yellow-review 3.16.0, yellow-core 2.14.0** — A review-run lock keeps the
  compound-staging drain out of a checkout that `/review:resolve`,
  `/review:sweep`, `/review:sweep-all` or `/review:resolve-stack` is resolving,
  so drain sentinels no longer trip resolve's ignored-file stop (CLAUDE-267,
  #1688).

### Changed

- **yellow-review 3.16.0** — The resolve line cap applies only to unattended
  runs, per cluster: interactive `/review:resolve` has no cap, and an unattended
  run pushes over-cap clusters with `--over-cap-draft`, which converts the PR to
  a draft for human review instead of reverting the fix (CLAUDE-272, CLAUDE-273,
  #1689, #1704, #1710).
- **yellow-review 3.16.0, yellow-core 2.14.0** — `/review:resolve` re-checks the
  PR head before staging, submitting and each thread write, and stops with
  `reason=head-moved` when another writer pushed; `/review:sweep-all` skips PRs
  whose head commit is under 15 minutes old (CLAUDE-266, CLAUDE-270, CLAUDE-271,
  #1687, #1706).
- **yellow-core 2.14.0** — `/setup:all` matches the current per-plugin setup
  checks for yellow-agy, yellow-council and yellow-review (#1695);
  `knowledge-compounder` pins `effort: medium` (#1713).

### Fixed

- **yellow-codex 0.5.3** — `codex-reviewer` runs Codex with a 6-minute Bash
  timeout and waits for it when backgrounded, so it always returns a verdict
  (CLAUDE-286, #1713).
- **yellow-agy 0.2.2** — `/agy:setup` treats an absent `useG1Credits` key as off
  and also checks `useAiCredits`, so agy's own settings rewrites no longer make
  setup ask for a manual edit (#1697). The bridge process-group timeout test no
  longer flakes on busy runners (CLAUDE-284, #1719).
- **yellow-review 3.16.0** — `review-ledger.sh summary` skips ledgers pruned
  mid-read, and `/review:sweep` names the worktree that holds a PR branch on a
  branch mismatch (#1690).

---

## [2.1.31] - 2026-11-05

### Added

- **yellow-linear 2.3.0, yellow-core 2.13.0** — `/linear:delegate` can hand a
  Linear issue to the local agent, yellow-agy (CLAUDE-261, #1672). The
  remote-agent classifier returns the new `READY_AGY` state when no remote-agent
  provider is enabled, `--provider agy` picks it in any other state, and after
  2026-11-11 `READY_JULES` points to yellow-agy.
- **yellow-review 3.15.0, yellow-council 0.7.0, yellow-core 2.13.0, yellow-codex
  0.5.2** — A `cross_model_review: auto | off` switch in
  `yellow-plugins.local.md`. With `off`, `/review:pr` never selects
  `codex-reviewer` and `/council` runs only the Claude reviewer unless the run
  names the external reviewers (CLAUDE-217, #1648).

### Changed

- **yellow-agy 0.2.1** — Every `/agy:*` call fits inside the wrappers' 600 s
  Bash timeout: a call that can no longer fit a turn refuses with the new
  `AGY_BUDGET` code and refunds the task or corrective round (CLAUDE-255,
  #1677).
- **yellow-agy 0.2.1** — `setup` runs `agy mcp list` itself and refuses with
  `AGY_MCP` when a server is enabled, unless the owner keeps it with
  `setup --allow-mcp <name>` and a code typed on their own terminal (CLAUDE-254,
  #1681).
- **yellow-review 3.15.0, yellow-core 2.13.0, yellow-devin 3.0.11** — Persona
  reviewers return anchor-25-and-below findings at that anchor so the single
  confidence gate suppresses and counts them; `/devin:review-prs` applies the
  same gate (CLAUDE-256, #1673).

### Fixed

- **yellow-agy 0.2.1** — On the Windows/WSL bridge, a timed-out host command now
  kills its Linux process group and waits for the kill before the call fails
  (CLAUDE-246, #1679).

## [2.1.30] - 2026-11-04

### Added

- **yellow-agy 0.2.0** — New experimental plugin, the successor to yellow-jules:
  a local supervised delegate on the Antigravity CLI (`agy`) under the owner's
  Google AI Pro sign-in. Ships `/agy:setup` (read-only host check, #1561), the
  adapter core and permission profiles (#1607), the delegate lifecycle with
  worktrees, snapshots and a local journal (#1624), and the `/agy:*` commands
  (authorize, delegate, approve, reply, status, collect, abandon) with owner
  grants and a `/usage` quota gate (#1651). `/setup:all` now lists yellow-agy.
- **yellow-review 3.14.0** — Risk-tiered review: `classify-risk` and a root
  `REVIEW.md` with the seed risk policy (#1610); the `review-gate` dynamic
  workflow in shadow mode (#1612); `/review:merge-ready` approval by risk tier
  (CLAUDE-234, #1626) and a "Risk tier" line in the sticky blocking-threads
  comment (#1629). Also a sticky blocking-threads PR comment for repos that do
  not enforce conversation resolution (CLAUDE-55, #1540), the
  `previous-comments-reviewer` persona (CLAUDE-219, #1647),
  `/review:pr --report-only` (CLAUDE-213, #1644), and a `### Themes` section
  that groups related findings (CLAUDE-218, #1646).
- **yellow-core 2.12.0** — Learning quality gates ported from Compound
  Engineering: the durable-bar counterfactual for every new learning
  (CLAUDE-208, #1642), optional `retire_when` frontmatter for solution docs
  (CLAUDE-209, #1643), solution-doc citation grounding in `validate-solutions`
  (CLAUDE-210, #1649), and a check that the agent-instruction file still points
  at `docs/solutions/` (CLAUDE-221, #1654).
- **gt-workflow 2.1.0, github-workflow 0.4.0** — `smart-submit` and
  `github-stack-submit` add a `## New concepts` section to the commit body when
  a change introduces a load-bearing term not yet in `CONCEPTS.md` (CLAUDE-220,
  #1641).

### Changed

- **yellow-review 3.14.0** — Documents the `review-gate.yml` CI job, which runs
  the workflow headless in shadow mode on human-authored PRs (#1645).
- **yellow-council 0.6.4** — Documents that `opencode run --format json` text
  events are completed parts, so credential redaction cannot split a key
  (CLAUDE-205, #1528).

### Deprecated

- **yellow-jules 0.4.2, yellow-linear 2.2.2** — yellow-jules is deprecated:
  Jules is read-only after 2026-11-11 and shuts down 2026-12-31.
  `/jules:delegate` and the Jules branch of `/linear:delegate` stop before
  launching after 2026-11-11 (#1527).

### Fixed

- **yellow-core 2.12.0** — Stop capture stages nothing when the jq dialogue
  filter fails, instead of an unfiltered raw tail (#1523).
- **yellow-review 3.14.0** — review-gate shadow matches ledger dismissals at
  their head-mapped location and enclosing scope (CLAUDE-243, #1632), and
  `/review:pr` and `/review:resolve` read the risk policy from the PR's base
  repository, not `origin`, so a fork cannot set its own tier (#1652).

## [2.1.29] - 2026-10-29

### Added

- **yellow-review 3.13.0** — `/review:resolve` hands CodeRabbit threads back to
  CodeRabbit: before resolving a thread CodeRabbit opened, the write phase
  replies `@coderabbitai resolve` in that thread (new `handback-pr-thread`
  script, plan key `handback`), so CodeRabbit stops reopening it. The GraphQL
  resolve still follows; `YELLOW_REVIEW_CODERABBIT_HANDBACK=0` turns the
  hand-back off (CLAUDE-56).
- **yellow-debt 1.9.6** — `debt_backfill_todos` in `lib/validate.sh` fills a
  missing `id`, `status`, `severity` or `priority` in older todos from the file
  name, never changes a present value, and reports todos missing `category` or
  `affected_files` for a hand edit (CLAUDE-4).

### Changed

- **yellow-council 0.6.3** — gemini-reviewer and opencode-reviewer route to
  `sonnet` / `medium` (were `haiku` / `low`). In the CLAUDE-200 eval, Haiku
  sometimes skipped the CLI call or replaced the canonical credential-redaction
  program; Sonnet followed the procedure in every run.
- **yellow-core 2.11.7, yellow-debt 1.9.6, yellow-semgrep 4.2.9** — Eval-gated
  model swaps from the Phase 3 leftovers eval (CLAUDE-194): `scan-verifier`
  moves to haiku/low, `staging-promoter` to haiku/medium, and
  `audit-synthesizer` from opus/high to sonnet/medium. `/semgrep:fix` Step 9
  treats a verifier answer with no `Verification:` verdict like "Cannot verify"
  and offers to commit with the new `unverified (no verifier result)` trailer,
  instead of reading it as a pass.

### Fixed

- **yellow-core 2.11.7** — The Stop hook capture no longer stages an empty
  transcript tail. Its scan window doubles until it holds 100 dialogue records,
  passes the 96 KiB byte cap, covers the whole file, or reaches 128000 lines
  (CLAUDE-148). Capture keeps only user and assistant records, drops a
  half-written final line, skips tails with no dialogue, and an older capture of
  a session no longer replaces a newer one (CLAUDE-199).
- **yellow-semgrep 4.2.9** — `/semgrep:scan` and the post-fix `scan-verifier`
  scan with the `p/default` ruleset (override with `YELLOW_SEMGREP_CONFIG`)
  instead of `--config auto`, which current semgrep refuses alongside
  `--metrics off`; the verifier also adds the target rule (CLAUDE-195).
- **yellow-devin 3.0.10** — The command reference moved from
  `commands/devin/README.md` to `docs/commands.md`, so Claude Code no longer
  loads it as a stray `/devin:README` command (CLAUDE-201).

## [2.1.28] - 2026-10-28

### Fixed

- **yellow-review 3.12.1** — `review-ledger.sh summary` now reports `skipped`,
  the count of ledger records the fold could not read, and a write whose fold
  skipped records removes the `.pending` sidecar so the fast path cannot report
  the ledger as clear. When `skipped` is above 0, `check-merge-ready` reports
  the ledger as `partial` and lists it under `unknowns`, `/review:sweep` prints
  `Merge: unknown (<n> unreadable ledger records)`, and `/review:sweep-all`
  lists the PR as merge readiness unknown (CLAUDE-190).

## [2.1.27] - 2026-10-27

### Added

- **yellow-review 3.12.0** — `/review:merge-ready` is a read-only merge gate for
  one PR. Its `check-merge-ready` script reports unresolved review threads
  (outdated included), `CHANGES_REQUESTED` reviewers, a missing required review,
  the head commit's CI rollup, draft and conflict state, conversation-resolution
  enforcement, the `graphite-queue` label and pending P0-P2 ledger findings, and
  exits 0 ready, 1 blocked or 3 unknown. It never writes to GitHub or the
  ledger.

### Changed

- **yellow-goal 0.4.0, yellow-core 2.11.6** — The goal-gen engine is pinned to
  0.4.0 (annotated tag `v0.4.0` at `63647f1`). 0.4.0 splits the engine's models
  by role: extraction on Sonnet, action attempts on Haiku, and retries after a
  failed attempt on Sonnet. The approval-gated real run is unchanged.
  `/setup:all` now reports READY only for engine version 0.4.0.
- **yellow-review 3.12.0, yellow-core 2.11.6, yellow-debt 1.9.5, yellow-docs
  1.4.1** — Sonnet agents that had no `effort` now pin `effort: medium`, so they
  no longer run at whatever effort the launching session uses. After the
  CLAUDE-187 eval, agent-native-reviewer routes to `sonnet` / `medium`, the
  duplication and ai-pattern scanners to `haiku` / `low`, knowledge-compounder's
  Context Analyzer and Related Docs Finder to `haiku` / `low`, and the
  `/optimize` judge to `sonnet` / `medium`.
- **github-workflow 0.3.7, gt-workflow 2.0.9, yellow-ci 1.5.10, yellow-core
  2.11.6, yellow-devin 3.0.9** — Documentation cleanup. `learnings-researcher`
  now names `/review:all` instead of the retired `/review:review-all`. The
  gt-workflow, yellow-ci, and yellow-devin READMEs document `/gt-merge`,
  `/ci:report-linear`, `/ci:setup-self-hosted`, and `/devin:review-prs`. The
  github-workflow README links the stacked-PR plan at its `plans/complete/`
  path.

### Fixed

- **yellow-jules 0.4.1** — A grant write that passes a controller check now also
  takes the controller lock: `revokeGrant` and `releaseSlotInStore` take one
  `{ beforeWrite, lock }` object, so a caller cannot pass the check without the
  lock. The take-over lock-wait test waits for the take-over to reach its lock
  attempt instead of a fixed 300 ms.
- **yellow-review 3.12.0** — The `poll-new-threads` bats suite stubs a frozen
  `date` in `setup()`, so tests that assert exact sleep lengths no longer
  shorten when a second ticks over on a slow runner. The wall-clock tests keep
  their own fake clock.

## [2.1.26] - 2026-10-26

### Added

- **yellow-review 3.11.0, yellow-core 2.11.5** — The review compact-return
  schema lives in one canonical file, and the new `validate:compact-return`
  gate fails any persona copy that drifts from it. `reviewer_set.include` no
  longer bypasses depth tiering in `/review:pr` and `/review:all`; the new
  `reviewer_set.force_depth` list keeps a reviewer running at every size.
- **yellow-review 3.11.0** — `/review:resolve` runs its whole write phase
  (follow-up issue, reply, resolve) through one `apply-thread-actions` call per
  PR, checks `addressed` evidence with a new `check-addressed-evidence` script
  that accepts fixes made lower in a stack, and reads its config through
  `read-resolve-config`. `/review:pr`, `/review:all` and `/review:triage` commit
  fixes through `commit-resolve-fixes` as a new commit instead of amending.
  `/review:resolve-stack` and `/review:sweep-all` end with a machine-readable
  `ResolveStack:` / `SweepAll:` outcome line.
- **yellow-jules 0.4.0** — `supervise --clear-deviation --session <ref>` is the
  recovery path for a blocking policy deviation, and controller authority
  writes are serialized across data directories that share a controller id.

### Changed

- **yellow-review 3.11.0, yellow-debt 1.9.4** — comment-analyzer and
  project-standards-reviewer route to `haiku` / `medium`, and complexity-scanner
  to `haiku` / `low`, after a replay eval showed equal or better recall.
- **yellow-debt 1.9.4, yellow-research 5.2.1** — A per-search token handoff
  replaces the global ast-grep recipe lock, so parallel scanners no longer
  collide or fall back to Grep.

### Fixed

- **yellow-review 3.11.0** — Closes the remaining git trust-boundary gaps
  (unjudgeable program-running config keys are refused, `ext::` remotes are
  blocked, ssh and askpass programs are pinned in the verify environment).
  `run-verify-command` also refuses when hooks or git config changed after the
  ignored-file marker, handles unreadable foreign-owned worktree directories,
  and the `.git/hooks` guard no longer refuses configs with more than 64
  includes. `/review:sweep` reports a changed-local-config stop as aborted.
- **yellow-ci 1.5.9, yellow-core 2.11.5** — The CI-log redactor and
  `cs_redact_secrets` mask the same set of credential shapes, enforced by a
  new parity test.
- **yellow-council 0.6.2** — Credential redaction runs in linear time and no
  longer leaks the tail of a serializer-wrapped PEM key.
- **yellow-claudemod 0.1.2** — Ledger key pruning no longer holds up later
  spawns' rows when a store call hangs.
- **yellow-ruvector 2.0.5** — The busy-store co-edit bats case is
  deterministic.

## [2.1.25] - 2026-10-22

### Changed

- **yellow-core 2.11.4, yellow-review 3.10.3, yellow-debt 1.9.3** — `/setup:all`
  no longer requires `gt` for yellow-review or yellow-debt, which now submit
  through the enabled stacked-PR provider. The dashboard adds a `gt_mcp_check`
  row, flags gt below 1.6.7, and reports a third-party `stack` gh extension as
  `WRONG_OWNER`. `/review:pr` resolves the stacked-PR provider before checkout
  and uses `gh pr checkout` for GitHub stacks.
- **yellow-review 3.10.3** — `/review:sweep` and `/review:resolve-stack` are
  trimmed under the 500-line command ceiling with no behaviour change.

### Fixed

- **yellow-core 2.11.4, yellow-review 3.10.3** — The resolver `PATH` screen no
  longer trusts setuid/setgid bits: an unreadable executable fails closed unless
  root owns it and the user cannot write it. `harden_git_config` splits
  `git config --null` records in bash, so the resolver scripts run on hosts
  whose only awk is BWK (stock macOS). `/statusline:setup` backups refuse
  symlinks and are created `O_EXCL|O_NOFOLLOW` at 0600, and the context observer
  can no longer crash on a late `SIGALRM`.
- **yellow-review 3.10.3** — `check-resolve-text` treats an awk program that
  never ran as a scan failure (exit 6) instead of clean, and the review-findings
  ledger merges a finding observed once with a verified scope and once without
  one, so `/review:triage` no longer shows these as duplicates.
- **yellow-goal 0.3.2** — `/goal:setup`, `/goal:run-stub` and `/goal:run-real`
  find yellow-core's `lib/validate-fs.sh` in the version-suffixed plugin cache
  instead of reporting yellow-core missing.
- **yellow-claudemod 0.1.1** — The spawn ledger keys rows per session so
  concurrent sessions no longer overwrite each other, ledger writes give up
  after 2 seconds, and `/claudemod:setup` reports an installed but disabled
  plugin as disabled.
- **yellow-core 2.11.4, yellow-devin 3.0.8, yellow-semgrep 4.2.8** (and the
  plugins above) — Active-install sibling lookups rank a `local`-scoped install
  above a `project`-scoped one for the same project, matching Claude Code's
  precedence, and match projects recorded through a symlink.

## [2.1.24] - 2026-10-22

### Added

- **yellow-research 5.2.0** — Research agents query Ceramic the way its docs
  recommend (2–3 short keyword variants, `maxDescriptionLength: 1000`) and fall
  back to other providers by how many results contain the query's distinctive
  terms.

### Fixed

- **yellow-review 3.10.2** — `run-verify-command --revert-denied` closes five
  gaps where edited trusted config stayed live behind symlinks or special files,
  and `/review:resolve-stack` and `/review:sweep-all` cleanup always runs it
  with a pre-flight marker. The resolver hard-link screens match file to file,
  so overlayfs device numbers no longer let a planted hard link through.
  `/review:sweep` binds its local-config guard to the checked-out head.
- **yellow-core 2.11.3** — `jev-category-eval run` rejects a malformed `--model`
  before spending requests; `/plan:complete` no longer exits when `gt` is
  missing before the provider is resolved; `/worktree:restack --abort` reports
  what it kept and cleared; the stack library lookup works without
  `CLAUDE_PLUGIN_ROOT` and rejects symlinked or relative plugin roots; research
  agents use the new Ceramic query pattern.
- **yellow-browser-test 1.1.12, yellow-ci 1.5.8, yellow-codex 0.5.1, yellow-debt
  1.9.2, yellow-ruvector 2.0.4** (and the plugins above) — Shell blocks that
  parse `ls`, `ps`, `df` or `top` output call them through `command`, so user
  aliases (`ls=eza`, `ps=procs`) no longer break plan listings, process checks
  or permission probes.

## [2.0.4] - 2026-07-10

### Fixed

- **yellow-docs 1.3.6** — Restored the doc-auditor's read-only contract by
  denying write tools and limiting its documented Bash exception to Git
  history inspection.
- **yellow-browser-test 1.1.5** — Repaired the agent-browser prerequisite link
  and replaced six unresolved shorthand task dispatches with fully qualified
  subagent references.
- **yellow-ci 1.4.6** — Fully qualified the runner-assignment subagent used by
  `/ci:setup-self-hosted`.
- **yellow-ruvector 1.1.8** — Enforced deterministic hook timeout budgets,
  removed slow `npx` fallbacks, and added hanging-binary regression coverage.

### Changed

- **yellow-linear 1.3.3** — Corrected `/linear:delegate` documentation to
  describe its credential requirements instead of a hard yellow-devin plugin
  dependency.
- Standardized the required skill headings across yellow-ci, yellow-codex,
  yellow-composio, yellow-core, yellow-docs, yellow-research, and
  yellow-semgrep.
- Synchronized marketplace documentation for yellow-research's Ceramic MCP
  integration, current MCP counts, and yellow-mempalace's deprecation status.

---

## [1.2.0] - 2026-03-12

### Added

- **yellow-docs** — Documentation audit, generation, and Mermaid diagram
  creation for any repository. 3 agents, 5 commands, 1 skill.
- **yellow-morph** — Intelligent code editing and search via Morph Fast Apply
  and WarpGrep MCP. 2 commands, 1 MCP.
- **yellow-semgrep** — Semgrep security finding remediation — fetch, fix, and
  verify findings from the Semgrep platform. 2 agents, 5 commands, 1 skill,
  1 MCP.
- **yellow-research** — Added ast-grep MCP server (5th MCP source).
- **yellow-devin** — Added `/devin:review-prs` command for multi-agent PR
  review and remediation of Devin-authored PRs.
- **yellow-ci** — Added `/ci:report-linear` command for CI failure Linear issue
  creation.
- **yellow-core** — Added `/setup:all` command to validate all installed plugin
  prerequisites at once.
- **gt-workflow** — Added `/gt-amend` command, `smart-submit` command, and
  Graphite MCP server integration.

### Changed

- Consolidated CI from 3 workflows to 1 unified `version-packages.yml`.
- All agent definitions now use `tools:` frontmatter (migrated from `allowed-tools:`).
- Per-plugin independent versioning via changesets is now fully operational.

### Totals

- **14 plugins** across 5 categories
- **51 agents** for autonomous task execution
- **81 commands** for manual workflows
- **19 skills** for shared conventions and patterns
- **9 hooks** for automated event-driven behavior
- **14 MCP server integrations**

---

## [1.1.0] - 2026-02-23

### Added

- **yellow-devin** — Migrated to Devin V3 API (v2.0.0). Breaking change: all
  session management endpoints updated. Added orchestrator agent for
  plan-implement-review chains.
- **yellow-core** — Added `/workflows:brainstorm` command and
  `brainstorm-orchestrator` agent for pre-planning requirement exploration.
- **yellow-core** — Added `/workflows:compound` command for documenting solved
  problems to compound team knowledge.
- **yellow-research** — Added `yellow-research` plugin with 4 bundled MCP
  servers (Perplexity, Tavily, EXA, Parallel Task).
- Per-plugin versioning system via `@changesets/cli` — each plugin now has its
  own `package.json` and `CHANGELOG.md` for independent version tracking.

---

## [1.0.0] - 2026-02-18

Initial public release of the yellow-plugins marketplace — 10 Claude Code
plugins for development productivity, code quality, and workflow automation.

### Plugins

#### Development

- **gt-workflow** (1.0.0) — Graphite-native workflow commands for stacked PRs,
  smart commits, sync, and stack navigation. 5 commands.
- **yellow-core** (1.0.0) — Dev toolkit with review agents, research agents, and
  workflow commands for TypeScript, Python, Rust, and Go. 10 agents, 3 commands,
  2 skills.
- **yellow-review** (1.0.0) — Multi-agent PR review with adaptive agent
  selection, parallel comment resolution, and sequential stack review. 8 agents,
  3 commands, 1 skill.
- **yellow-debt** (1.0.0) — Technical debt audit and remediation with parallel
  scanner agents for AI-generated code patterns. 7 agents, 5 commands, 1 skill.
- **yellow-ruvector** (1.0.0) — Persistent vector memory and semantic code
  search for Claude Code agents via ruvector MCP server. 2 agents, 6 commands, 2
  skills, 3 hooks.
- **yellow-ci** (1.0.0) — CI failure diagnosis, workflow linting, and runner
  health management for self-hosted GitHub Actions runners. 3 agents, 5
  commands, 2 skills, 1 hook.

#### Productivity

- **yellow-linear** (1.0.0) — Linear MCP integration with PM workflows for
  issues, projects, initiatives, cycles, and documents. 3 agents, 5 commands, 1
  skill.
- **yellow-chatprd** (1.0.0) — ChatPRD MCP integration with document management
  and Linear bridging. 2 agents, 5 commands, 1 skill.

#### Integrations

- **yellow-devin** (1.0.0) — Devin.AI integration for multi-agent workflows —
  delegate tasks, research codebases via DeepWiki, orchestrate
  plan-implement-review chains. 1 agent, 5 commands, 1 skill.

#### Testing

- **yellow-browser-test** (1.0.0) — Autonomous web app testing with
  agent-browser — auto-discovery, structured flows, and bug reporting. 3 agents,
  4 commands, 2 skills.

### Marketplace Infrastructure

- Schema-validated plugin manifests (`plugin.json` + `marketplace.json`)
- Plugin validation scripts (`scripts/validate-plugin.js`,
  `scripts/validate-marketplace.js`)
- Contribution guide with plugin authoring conventions
- MIT licensed

### Totals

- **10 plugins** across 4 categories
- **39 agents** for autonomous task execution
- **46 commands** for manual workflows
- **13 skills** for shared conventions and patterns
- **5 hooks** for automated event-driven behavior
- **3 MCP server integrations** (Linear, ruvector, DeepWiki)

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows) **Format**:
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) **Versioning**:
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)
