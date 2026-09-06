# Changelog

## 2.0.2

### Patch Changes

- [`e239b34`](https://github.com/KingInYellows/yellow-plugins/commit/e239b3462d7c65e866d87dc27197b0167dc0e0d7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Rename the
  skill frontmatter key `user-invokable` to `user-invocable` in every SKILL.md.
  Claude Code (verified against 2.1.259) parses only `user-invocable`; the `k`
  spelling this repo standardised on was silently ignored, so every internal
  skill declared `user-invokable: false` still appeared in the `/` menu. The
  validator gains RULE 20 (error tier) rejecting the old key so it cannot creep
  back through stale templates.

## 2.0.1

### Patch Changes

- [#729](https://github.com/KingInYellows/yellow-plugins/pull/729)
  [`828e5c7`](https://github.com/KingInYellows/yellow-plugins/commit/828e5c741289c685e268d35082af6f7a7afd4faf)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix three
  defects in the Cursor delegation surface that survived onto `main`.

  `delegate`'s `--max-active` cap could be exceeded: the active-agent sweep
  stopped after a fixed page bound and returned the partial count as if it were
  the total, so an account with more pages of cloud agents silently undercounted
  and a billable launch was authorized past the configured cap. The sweep now
  fails closed with `CURSOR_CONCURRENCY_LIMIT` when the listing is still
  paginating at the bound. Archived agents remain **in** the concurrency count
  whenever their status is still `running`: `/cursor:archive --force` archives
  an agent without cancelling its run, so force-archiving hides an agent from
  the default listing but never frees a `--max-active` slot. Only the agent's
  status gates the count, so archived-and-finished agents cost nothing.

  `/cursor:archive` did not actually hide anything: the adapter always requested
  archived agents, so they stayed in `/cursor:list` despite the archive and
  unarchive command contracts promising the opposite. Archived visibility is now
  caller-driven — excluded from the default listing only, and included both for
  canonical-id reconciliation (which must still find an agent archived between
  `send()` and the sweep) and for the concurrency sweep described above — and
  opt-in via `/cursor:list --archived`.

  `/linear:delegate`'s launch step consumed shell variables assigned in earlier
  Bash calls, which do not persist, and derived `CURSOR_REPO_URL` after the
  block that used it. The derivation now precedes the launch and every required
  value is asserted non-empty first, so a missing plugin root or empty
  delegation packet fails loudly instead of launching a billable agent with no
  instructions.

## 2.0.0

### Major Changes

- [#726](https://github.com/KingInYellows/yellow-plugins/pull/726)
  [`575f8cd`](https://github.com/KingInYellows/yellow-plugins/commit/575f8cd83ab3afc63174af8254029b7070957876)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  `/linear:delegate` is now provider-neutral: it resolves the `remote-agent`
  capability provider (Cursor preferred, Devin legacy) before any external
  mutation and launches through the provider-owned surface — the yellow-cursor
  CLI or `/devin:delegate` — instead of owning Devin credentials and REST calls
  itself. The command builds a provider-neutral delegation packet with fenced
  untrusted issue content, derives a stable idempotency key so retries cannot
  double-launch, confirms immediately before every billable launch, keeps the
  separate comment-posting confirmation with deduplication, and re-fetches the
  issue before any status transition. An explicit `--provider cursor|devin`
  argument resolves the both-enabled conflict state per invocation; every other
  non-ready provider state stops with actionable guidance and no mutation.

## 1.4.0

### Minor Changes

- [#716](https://github.com/KingInYellows/yellow-plugins/pull/716)
  [`d422f55`](https://github.com/KingInYellows/yellow-plugins/commit/d422f55472f16bc14503236d7b64de5e9de4b15f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  `linear-pr-linker`, `linear:sync`, `linear:work`, and the `linear-workflows`
  skill now resolve the active stacked-PR provider once via
  `stack-provider-router` before committing or submitting, instead of hardcoding
  Graphite. The Graphite path is unchanged.

## 1.3.6

### Patch Changes

- [#704](https://github.com/KingInYellows/yellow-plugins/pull/704)
  [`fbe5df7`](https://github.com/KingInYellows/yellow-plugins/commit/fbe5df71338c94fe00f86923514aed8872d97f3c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Rename the
  `workflows:` command namespace to `flow:`. Native Claude Code's built-in
  `/workflows` occupies that autocomplete prefix, so typing `/workflows` no
  longer narrows to these commands; `/flow` does.

  The nine yellow-core commands are now `/flow:brainstorm`, `/flow:spec`,
  `/flow:decompose`, `/flow:pick-next-shell`, `/flow:expand-shell`,
  `/flow:plan`, `/flow:work`, `/flow:review`, and `/flow:compound`. Their
  directory moved to `commands/flow/`, and `/flow:work`'s progressive-disclosure
  reference moved to `references/flow-work/` alongside the `work.md` path that
  loads it. Runtime surfaces moved with the names: `skill:` dispatch targets,
  log tags, user-facing error text, and the `<!-- Updated by flow:work -->`
  marker `/flow:work` stamps into plan files.

  yellow-research's `/workflows:deepen-plan` becomes `/flow:deepen-plan`, moving
  to `commands/flow/` alongside the yellow-core commands it shares a namespace
  with. Its documented pipeline is now `/flow:plan` → `/flow:deepen-plan` →
  `/flow:work`.

  yellow-linear takes a `patch`: `/linear:work` dispatches into the renamed
  namespace via `skill: "flow:plan"`, and those two dispatch strings would have
  silently failed to resolve at runtime had they been left behind. No
  yellow-linear command name changes.

  yellow-review takes a `patch` for the same reason: `/review:sweep-all`'s
  end-of-loop learning capture dispatches `skill: "flow:compound"`.

  gt-workflow takes a `patch`: its stack-decomposition skills, output styles,
  and docs name `/flow:work` / `/flow:plan` as the plan consumer, updated from
  the retired `workflows:` names.

  yellow-docs takes a `patch`: `/docs:review` Step 9 offers a compound handoff
  to the user, and that offer named a command this release deletes. Swept here
  rather than in the follow-up prose PR — a handoff a user can accept at runtime
  is a functional surface, not prose.

  `major` for both: the old `/workflows:*` command files are deleted outright
  with no forwarding alias, and both AGENTS.md and `CONTRIBUTING.md` state the
  bump-type rule as major for "removal of a command" / "removed or breaking
  command interfaces" with no carve-out for a marketplace with no external
  install base. The singular `yellow-core:workflow:*` agent namespace is
  unchanged.

  A new CI gate, `pnpm validate:flow-namespace`, walks the whole repository
  (including hidden directories) for surviving `workflows:` references and fails
  on any that is not in `scripts/flow-namespace-allowlist.json` at its exact
  expected occurrence count. The allowlist shrinks to nothing as the remaining
  prose sweep lands.

- [#706](https://github.com/KingInYellows/yellow-plugins/pull/706)
  [`91c755c`](https://github.com/KingInYellows/yellow-plugins/commit/91c755cc10c016e1618c46b0dc757a06aadcaf72)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Sweep the
  remaining prose references to the retired `workflows:` command namespace under
  `plugins/` — 59 references across 23 files in 5 plugins — so every documented
  invocation matches the `flow:` names the commands actually carry.
  Documentation only; no behavior changes.

  Five plugins, not the seven the migration plan predicted, and not the eight an
  earlier draft of this changeset claimed. The list is re-derived from this
  commit's own diff rather than trusted, and it shrank twice during review as
  references that turned out to be functional rather than prose were pulled
  forward into the parent PR: `gt-workflow` and `yellow-research` (agent and
  skill instructions), then `yellow-docs` (a `/docs:review` handoff a user can
  accept at runtime). All three carry their bumps in the parent PR's changeset.
  Listing them here would publish new versions of plugins this commit does not
  touch.

  Two findings worth recording:
  - **The gate could not see the glob form.** `plugins/yellow-core/CLAUDE.md`
    documented the namespace as `` `/workflows:*` ``, which
    `scripts/validate-flow-namespace.js` matched against none of its ten
    enumerated command names. It was found by hand, which is exactly the "sweep
    misses N+1" mode the gate exists to prevent. The matcher now also bans the
    collective forms `workflows:*` and `workflows:<cmd>`.
  - **The glob rule needed a `(?!\*)` guard.** Markdown bold places `**`
    immediately after a colon-terminated phrase —
    `**Template-driven workflows:**` — which a bare `\*` alternative matches as
    `workflows:` plus `*`. Three such false positives appeared the moment the
    rule was added; a real glob is never followed by a second asterisk.

  The sweep used `perl`, not `sed`, so the replacement could carry the same
  `(?![a-z-])` tail guard the gate matches with. The singular
  `yellow-core:workflow:*` agent namespace is untouched throughout.

## 1.3.5

### Patch Changes

- [#671](https://github.com/KingInYellows/yellow-plugins/pull/671)
  [`4b35a76`](https://github.com/KingInYellows/yellow-plugins/commit/4b35a760a354e06ab3b845a19ce0e2ba878e3b20)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Correctness,
  contract-wording, and sweep-completeness follow-ups deferred from the PR
  #666/#667 review loops
  - yellow-ruvector: memory-manager queue rewrite retains entries whose
    processing failed (failed `file_change` re-index included), not only failed
    `hooks_remember` stores.
  - yellow-semgrep: `/semgrep:fix` verify-outcome language aligned with
    scan-verifier's findings-at-modified-lines WARNING contract.
  - yellow-ci: runner-diagnostics SSH rule now covers its own Step 3
    connectivity check ("Steps 3 and 4").
  - yellow-mempalace: `/mempalace:kg` closet definition moved out of the render
    placeholder into prose.
  - yellow-devin: devin-orchestrator documents the non-interactive default for
    the `max_acu_limit` question; devin-workflows tier table points at the
    in-file M3 definition.
  - yellow-debt / yellow-linear: bare "(M3)" jargon rewritten to
    confirmation-gate plain language (same class as the PR #666 sweep).
  - yellow-core: `/plan:complete` states rules inline instead of citing the
    maintainer-local MEMORY.md; the AskUserQuestion `Other`-label rule is
    standardized to one canonical phrasing across `decompose`, `expand-shell`,
    `spec`, and `work`, with expand-shell's `Other` option moved last to match
    its siblings.

## 1.3.4

### Patch Changes

- [#666](https://github.com/KingInYellows/yellow-plugins/pull/666)
  [`5a0b9c5`](https://github.com/KingInYellows/yellow-plugins/commit/5a0b9c5190885e45927aa9afd63a779e69bacd67)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Prompt-quality
  correctness pass across instructional markdown, driven by the updated
  prompting-guidance research (docs/research/best-practices/
  gpt-claude-latest-model-prompting-guidance.md and its 2026-07-27 addendum).

  Fixes fall into four classes: (1) dangling or stale references — archived plan
  paths, a nonexistent MCP tool name, "MEMORY.md" citations that do not resolve
  for installed users, undefined jargon like "(M3)" and "the keystone"; (2)
  contradictions between paired files — dedup-threshold drift (0.85 vs the
  canonical 0.82), revert/retry option mismatches, doc claims the referenced
  code disproves; (3) ambiguous or unactionable instructions — AskUserQuestion
  free-text options not labeled `Other`, undefined shell variables in
  illustrative bash, branches with no specified check; (4) Codex-exposed
  gt-workflow skills assuming Claude-only primitives (AskUserQuestion, the Skill
  tool) with no host branch — each now carries an "On Codex" fallback, with
  generated codex/ artifacts regenerated. No command interfaces changed.

## 1.3.3

### Patch Changes

- [#630](https://github.com/KingInYellows/yellow-plugins/pull/630)
  [`ea6b47b`](https://github.com/KingInYellows/yellow-plugins/commit/ea6b47bbb51ab44431fcf3433d8896e7d4466fba)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - docs: correct
  both CLAUDE.md restatements of the `/linear:delegate` dependency — the command
  validates the `DEVIN_SERVICE_USER_TOKEN`/`DEVIN_ORG_ID` environment variables
  (delegate.md Step 1), not yellow-devin plugin presence; installing
  yellow-devin is one way to obtain the credentials, not a hard plugin
  dependency.

## 1.3.2

### Patch Changes

- [#570](https://github.com/KingInYellows/yellow-plugins/pull/570)
  [`97cea5f`](https://github.com/KingInYellows/yellow-plugins/commit/97cea5f21595ad8f839f01357a5b1097383b7b09)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: migrate to
  current Linear MCP tool names — `create_issue`/`update_issue` → `save_issue`,
  `create_comment` → `save_comment`, `list_initiative_updates` →
  `get_status_updates`, `create_initiative_update` → `save_status_update` —
  across all command/agent bodies and allowed-tools lists, and update call prose
  to the upsert parameter names (`id`, `state`, `team`, `labels`, `project`).
  The old names no longer exist on the Linear MCP server, so every write
  operation failed with "tool not found".

## 1.3.1

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

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.3.0] - 2026-03-10

### Minor Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.
- Add `/linear:setup` to validate Linear MCP visibility, first-use OAuth
  readiness, and Graphite availability.

---

## [1.2.0] - 2026-03-06

### Minor Changes

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

- Initial release — Linear MCP integration with PM workflows for issues,
  projects, initiatives, cycles, and documents.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
