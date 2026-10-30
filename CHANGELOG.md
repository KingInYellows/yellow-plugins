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
