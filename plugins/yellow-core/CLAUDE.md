# yellow-core Plugin

Comprehensive dev toolkit for TypeScript, Python, Rust, and Go projects.

## Conventions

- Use the active stacked-PR provider (see `/stack:status`) for all branch
  management and PR creation — never raw `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Keep code simple and direct. No premature abstractions
- Prefer explicit over implicit. Name things clearly
- Write tests for non-trivial logic
- **Shell libraries and zsh:** Markdown blocks run under the user's shell, often
  zsh with `noclobber`. `lib/compound-staging.sh`,
  `lib/plan-gate-provenance.sh`, `lib/repo-profile.sh` and `lib/validate-fs.sh`
  are dual-shell (Tier 4) and are sourced directly; keep them that way —
  `tests/shell-compat/` runs them under bash and zsh. Bash-only code goes in a
  `bash /dev/fd/3 3<<'__YELLOW_CORE_BASH__'` wrapper (as in `staging-reviewer`);
  see CONTRIBUTING.md "Bash and zsh". `lib/quote-ground.sh` is executed with
  bash and is never sourced. It is not a dual-shell library and is not
  registered in `tests/shell-compat/`.
- Review agents (`security-sentinel`, `security-reviewer`, `security-lens`,
  `architecture-strategist`, `polyglot-reviewer`, `test-coverage-analyst`,
  `pattern-recognition-specialist`, `code-simplicity-reviewer`,
  `performance-oracle`, `performance-reviewer`) carry `memory: project`
  frontmatter, which auto-enables Read/Write/Edit per Claude Code docs (so
  agents can persist learnings to `.claude/agent-memory/<name>/`). The runtime
  `disallowedTools: [Write, Edit, MultiEdit]` block on those agents enforces the
  read-only contract that their bodies assert at the prompt level —
  orchestrating commands apply all fixes; review agents only report

## Plugin Components

Full detail for each catalog below (command behavior, skill descriptions,
library contracts, optional-dependency behavior, compound-staging pipeline)
lives in
[`references/components-reference.md`](references/components-reference.md). Read
it before editing a command, library or the staging pipeline.

### Agents (21)

- Review: `code-simplicity-reviewer`, `security-sentinel`, `security-reviewer`,
  `security-lens` (plan-level), `performance-oracle`, `performance-reviewer`,
  `architecture-strategist`, `polyglot-reviewer`, `test-coverage-analyst`,
  `pattern-recognition-specialist`
- Research: `repo-research-analyst`, `best-practices-researcher`,
  `git-history-analyzer`, `learnings-researcher`
- Workflow: `spec-flow-analyzer`, `brainstorm-orchestrator`,
  `knowledge-compounder`, `session-historian`
- Background compounding: `staging-reviewer` (drain orchestrator),
  `staging-scorer` (Haiku), `staging-promoter` (non-interactive writer; its
  `disallowedTools: [AskUserQuestion]` is load-bearing, enforced by RULE 14)

### Commands (19)

- `/flow:brainstorm`, `/flow:spec`, `/flow:decompose`, `/flow:pick-next-shell`,
  `/flow:expand-shell`, `/flow:plan`, `/flow:work`, `/flow:review`,
  `/flow:compound` (`--in-pr` for draft-PR solution docs)
- `/compound:review-staged` — manual drain of the compounding staging ledger
  behind an M3 gate
- `/plan:status` (thin wrapper over the `plan-status` skill), `/plan:complete`
  (archive a plan behind Gate A unchecked-box and Gate C merged-PR evidence; see
  reference for the provenance tiers and commit trailers)
- `/stack:status` (classify provider state into eight states; a failed
  `claude plugin list --json` is UNKNOWN before any library runs; otherwise
  resolves yellow-core via `CLAUDE_PLUGIN_ROOT`, then the first enabled
  `installPath` with the library for this repository (never the open
  repository's tree), before classify),
  `/stack:select` (switch provider; never edits settings JSON, never falls back)
- `/statusline:setup`, `/setup:all`, `/setup:claude-web`
- `/worktree:cleanup`, `/worktree:restack` (logic lives in
  `skills/git-worktree/scripts/worktree-restack.sh`; the command holds no `gt` /
  `gh stack` literals). `--abort` / `--continue` touch only recorded worktrees
  (run, detached entries, github `owner`s; `owners N` tells a run with none
  from a legacy state). Every refusal it cannot prove safe exits `31` with the
  state kept and a final `kept: <reason>` token; add a token to `kept()` and
  the restack.md table together. `status` labels: `on branch`, `detached`,
  `moved`, `missing`, `replaced`, `owner`, `rebasing`, `busy`, `unreadable`,
  `not recorded`

### Skills (22)

Reference and workflow skills: `agent-native-architecture`,
`agent-native-audit`, `brainstorming`, `compound-lifecycle`,
`create-agent-skills`, `debugging`, `git-worktree`, `ideation`, `local-config`,
`mcp-health-probe`, `mcp-integration-patterns`, `memory-recall-pattern`,
`memory-remember-pattern`, `morph-discovery-pattern`, `multi-host-fleet`,
`optimize`, `plan-status`, `security-fencing`, `session-handoff`,
`session-history`, `stack-provider-guard`, `stack-provider-router`. Descriptions
are in the reference.

### Codex Distribution

The generated Codex manifest sets `commands: []` to prevent automatic conversion
of Claude command wrappers into additional skills. Codex exposes only the skills
selected by the catalog allowlist.

yellow-core is the first plugin in this repo to set
`targets.codex.enabled: true` (`catalog/plugins/yellow-core.json`) — the first
non-empty Codex marketplace state (`.agents/plugins/marketplace.json`). Its
Codex exposure is a deliberately narrow, read-only allowlist of exactly four
skills: `agent-native-architecture`, `agent-native-audit`, `plan-status`, and
`worktree-inventory`. Every other component — all 21 agents, all three hooks
(SessionStart, Stop, PreCompact), background compounding, `setup:all`,
statusline setup, MCP helpers, `lib/` executables, and the remaining skills — is
excluded. `targets.codex.includeHooks: false` in the catalog source keeps those
three hooks (Stop and SessionStart are needed for background compounding on the
Claude side; PreCompact alters compaction prompts) out of the generated Codex
manifest entirely — see
`docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md`
for why that opt-out exists.

### Shared Libraries

`lib/` carries Node modules and Python scripts that are invoked, and shell
helpers that consumer plugins source via
`${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/<name>.sh`. Contracts for each are in
the reference.

- `stack-provider-state.js` — single owner of provider state; carries a
  `capabilityProvider` replica that `validate-provider-groups.js` checks
  (`ERROR-PROVIDER-006`)
- `stack-operation-registry.js` — maps the nine neutral stack operations to one
  Graphite and one GitHub implementation or `null`; `/flow:work` and
  `worktree-restack.sh` derive from it in prose, so change all together
- `stack-tooling-probe.js` — provider CLI readiness; `commands/setup/all.md`
  still inlines its own `gt` / `gh` checks, so a readiness change must update it
  too
- `remote-agent-provider-state.js` — active `remote-agent` provider for
  `/linear:delegate` and `/setup:all` Step 2.5
- `run-github-stack-runtime.js` — entry to github-workflow's runtime;
  yellow-review, yellow-debt, yellow-devin and yellow-semgrep ship
  byte-identical copies
- `context-observer.py`, `statusline-settings.py` (only writer of
  `statusLine.command`), `jev-category-eval.py` (manual, offline)
- Sourceable shell: `credential-status.sh`, `compound-staging.sh`,
  `plan-gate-provenance.sh`, `jev-prefilter.sh`, `validate-fs.sh`,
  `repo-profile.sh`, `plugin-identity.sh`, `context-observer.sh`
- `quote-ground.sh` is executed with bash 4.4+, never sourced, and is not on the
  Tier 4 dual-shell list

### Optional Plugin Dependencies

`gt-workflow`, `yellow-codex`, `yellow-review`, `yellow-linear`,
`yellow-research` and `yellow-council` each enable an optional path in
`/flow:work`, `/flow:plan`, `/flow:review` or `best-practices-researcher`. Every
one degrades silently or with an install notice when absent; per-plugin behavior
is in the reference.

### MCP Servers (0)

yellow-core no longer bundles any MCP servers. Previously it shipped `context7`
as a bundled HTTP MCP, but that caused dual-registration issues when users also
had context7 at user level. Per CE PR #486 (2026-04-03) parity, the bundled
entry has been removed.

**Recommended user-level MCP:** `context7` — up-to-date library documentation
via [context7.com](https://context7.com). Install once at user level
(`/plugin install context7@upstash` or via Claude Code MCP settings); all
yellow-core and yellow-research agents that benefit from it (e.g.,
`best-practices-researcher`, `code-researcher`) detect availability via
ToolSearch and gracefully fall through to WebSearch / EXA when absent.

### Prompt cache TTL

No yellow-core agent sets `experimental.cacheTtl`. `learnings-researcher` is
one-shot on `/review:pr`, `/flow:plan`, `/flow:brainstorm`, and `/docs:review`,
so a `1h` cache write (about 2x base input versus 1.25x for the default `5m`)
would not pay back there. `/review:all` dispatches it once per PR in the batch,
which can pay back when those reviews are more than five minutes apart; the
field still stays off because the common path is a single `/review:pr`. The 1h
field stays on the yellow-review personas that are re-dispatched across reviews.

### MCP Tool Integration

- **ruvector** — Recall past learnings at workflow start; tiered remember at
  workflow end. Graceful skip if yellow-ruvector not installed. See
  `mcp-integration-patterns` skill for canonical patterns.
- **morph** — Preferred for file edits (>200 lines or 3+ non-contiguous regions)
  and intent-based code search. Discovered via ToolSearch at runtime; falls back
  to built-in tools silently.

## Compound Staging

Background pipeline: the Stop hook writes a redacted pending entry, the
SessionStart hook launches a disowned `claude -p` drain (`count >= 5` or
oldest > 48h, `mkdir` `.drain-lock`, `COMPOUND_DRAIN_IN_PROGRESS=1` recursion
guard, `--model haiku` unless `COMPOUND_DRAIN_MODEL` is set), and
`staging-reviewer` scores, filters, dedups and hands survivors to
`staging-promoter`. `cs_stage_entry` is the second producer (used by
yellow-review's `lib/stage-learning.sh`). `COMPOUND_JEV_PREFILTER=shadow` is an
opt-in, log-only pre-filter that sends session text to a third party.
`/compound:review-staged` drains manually. Architecture, thresholds, the Jev log
layout, auth route and cost are in the reference.

## Plan Namespace Split

The plugin uses two distinct namespaces for plan-related commands:

- **`/flow:*`** — end-to-end workflows that produce new artifacts. `/flow:plan`
  writes a new plan file from a feature description; `/flow:work` executes one.
  Plan creation lives here because it is one of several artifact-producing
  workflows (alongside `brainstorm`, `review`, `compound`).
- **`/plan:*`** — lifecycle operations on existing plan artifacts.
  `/plan:status` (read-only dashboard) and `/plan:complete` (archival with Gate
  A + Gate C) are not general workflows; they operate specifically on the corpus
  of `plans/*.md` files. Future authors adding plan-related lifecycle commands
  should put them under `/plan:*`.

The PR-diff-scoped validator `scripts/validate-plans.js` (root-level) enforces
no-stray-checkbox on archived files in PR diffs. It is wired as a 6th matrix
target in `.github/workflows/validate-schemas.yml` (sibling to the
marketplace/plugins/contracts/examples/solutions targets), not inside
`validate:schemas` itself. The error code is `ERROR-PLAN-001` (catalog:
`packages/domain/src/validation/errorCatalog.ts`, category
`ErrorCategory.PLAN_LIFECYCLE`).

## Testing

`bats tests/` from the plugin directory (`compound-session-start-hook`,
`compound-staging`, `compound-stop-hook`, `context-observer`,
`credential-status`, `handoff`, `jev-category-eval`, `jev-prefilter`,
`plan-commands`, `plan-status-parity`, `plan-gate-tier`, `plugin-identity`,
`stack-provider-root`,
`pre-compact-hook`, `quote-ground`, `repo-profile`, `setup-all-ruvector-probe`,
`statusline-template`, `validate-fs`) plus `skills/git-worktree/tests/`
(`worktree-manager.bats`, `worktree-restack.bats` with stub `gt` / `gh` / `git`
shims under `tests/mocks/`). Manifest hook budgets: Stop 5s, SessionStart 3s,
PreCompact 3s (`catalog/plugins/yellow-core.json`).

## Known Limitations

- **Per-worktree staging.** Each git worktree has its own
  `~/.claude/projects/<slug>/compound-staging/` directory (derived from
  `git rev-parse --show-toplevel`) and promotes to its own `docs/solutions/`.
  Concurrent worktree sessions on the same project do not share pending entries.
- **PII residue window.** Raw transcript tails (post-secret-redaction) sit in
  `pending/` until drained. The SessionStart hook's reaper deletes pending
  entries older than 7 days as a PII safety net. Treat
  `~/.claude/projects/<slug>/compound-staging/` as sensitive — do not relocate
  to a tracked directory; the recommended `.gitignore` entry is
  `compound-staging/`.
- **One pending entry per session, newest wins.** Two captures of one session
  can overlap. `capture-marks/<session>` records the transcript size of the
  newest published capture, and a capture that read a smaller transcript does
  not publish. A capture that cannot take the per-session lock within five
  seconds also skips publishing. The marks share the 7-day TTL.
- **Async via disowned subshells only.** The plugin manifest does NOT use an
  `async: true` hook schema field (Claude Code's remote validator rejects it —
  confirmed via deepen-plan validation). Non-blocking behavior comes entirely
  from the disowned-subshell pattern in `hooks/scripts/stop.sh` and
  `hooks/scripts/session-start.sh`.
- **PreCompact hook is the odd one out.** `hooks/scripts/pre-compact.sh` prints
  plain text, not `{"continue": true}`: Claude Code appends a PreCompact hook's
  stdout to the **main-session** compaction prompt on exit 0 (exit 2 blocks
  compaction). Subagent compactons (`agentContext` set) discard that stdout. It
  carries the Claude 5-generation compaction-preservation instruction (plan
  path + unchecked tasks, modified files, user decisions verbatim, open
  questions, last failing command, in-flight branch/PR names — every item
  secret-redacted then fenced as untrusted-content). Synchronous, no jq, well
  under its 3s timeout. Hook events live in `catalog/plugins/yellow-core.json`
  and are regenerated into `plugin.json` by `pnpm generate:manifests`. Tests:
  `tests/pre-compact-hook.bats`.
- **MEMORY.md migration is manual.** Plugin install does not partition an
  existing MEMORY.md into `## CORE_RULES`/`## USER_PREFERENCES`/
  `## KNOWN_PROJECTS`/`## Session Notes` automatically. `staging-promoter`
  creates the `## Session Notes` section at end-of-file if absent; partition
  migration is recommended manual work (see the contract block at the top of
  MEMORY.md for the canonical structure).
- **Uninstall does not reap staging dirs.** Removing yellow-core does NOT delete
  `~/.claude/projects/<slug>/compound-staging/` or any pending/processing
  entries. Manually `rm -rf` the staging dir to reclaim disk; the directory is
  inert without the hooks installed.

- **`$ARGUMENTS` word-splitting in `/worktree:restack` (won't-fix).** The
  "Phase 1: Parse flags" block in `commands/worktree/restack.md` runs in a
  `bash /dev/fd/3` child and splits `$ARGUMENTS` unquoted (`set -f; set --
  $ARGUMENTS`), because zsh does not word-split it. The residual concern is
  that a quoted value with a space, such as `--remote "a b"`, splits into two
  tokens. It is accepted because no flag takes such a value (remote names
  cannot hold spaces) and the stray token is rejected as an unexpected
  argument (exit `2`), so it fails closed. Do not replace the block with a
  zsh-native parser.

## Codex compatibility expansion

The shared worktree-inventory skill provides a bounded read-only workflow.
Installed Codex acceptance and exact support are recorded in the canonical
[Codex distribution](../../docs/codex-distribution.md) table. Other commands,
agents and hooks retain their existing host contracts.
