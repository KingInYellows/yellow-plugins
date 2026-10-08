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
- **Shell libraries and zsh:** Markdown blocks run under the user's shell,
  often zsh with `noclobber`. `lib/compound-staging.sh`, `lib/repo-profile.sh`
  and `lib/validate-fs.sh` are dual-shell (Tier 4) and are sourced directly;
  keep them that way — `tests/shell-compat/` runs them under bash and zsh.
  Bash-only code goes in a `bash /dev/fd/3 3<<'__YELLOW_CORE_BASH__'` wrapper
  (as in `staging-reviewer`); see CONTRIBUTING.md "Bash and zsh".
  `lib/quote-ground.sh` is executed with bash and is never sourced. It is
  not a dual-shell library and is not registered in `tests/shell-compat/`.
- Review agents (`security-sentinel`, `security-reviewer`, `security-lens`,
  `architecture-strategist`, `polyglot-reviewer`, `test-coverage-analyst`,
  `pattern-recognition-specialist`, `code-simplicity-reviewer`,
  `performance-oracle`, `performance-reviewer`) carry `memory: project`
  frontmatter, which auto-enables Read/Write/Edit per Claude Code docs (so
  agents can persist learnings to `.claude/agent-memory/<name>/`). The
  runtime `disallowedTools: [Write, Edit, MultiEdit]` block on those agents
  enforces the read-only contract that their bodies assert at the prompt
  level — orchestrating commands apply all fixes; review agents only report

## Plugin Components

### Agents (21)

**Review** — parallel code review specialists:

- `code-simplicity-reviewer` — YAGNI enforcement, simplification
- `security-sentinel` — security audit, OWASP, secrets scanning
- `performance-oracle` — bottlenecks, algorithmic complexity, scalability
- `performance-reviewer` — review-time runtime performance with anchored confidence rubric (companion to `performance-oracle`)
- `architecture-strategist` — architectural compliance, design patterns
- `polyglot-reviewer` — language-idiomatic review for TS/Py/Rust/Go
- `test-coverage-analyst` — full test suite audits, coverage gaps, strategy
- `pattern-recognition-specialist` — anti-patterns, duplication, naming drift
- `security-reviewer` — review-time exploitable security vulnerabilities (companion to `security-sentinel`)
- `security-lens` — plan-level security architect for planning documents and architecture proposals

**Research** — codebase and external research:

- `repo-research-analyst` — repository structure, conventions
- `best-practices-researcher` — external docs, community standards
- `git-history-analyzer` — git archaeology, change history
- `learnings-researcher` — searches `docs/solutions/` for past learnings
  relevant to a PR diff or planning context (Wave 2 keystone pre-pass)

**Workflow** — planning and analysis:

- `spec-flow-analyzer` — user flow analysis, gap identification
- `brainstorm-orchestrator` — iterative brainstorm dialogue with research integration
- `knowledge-compounder` — extract and document solved problems to docs/solutions/ and MEMORY.md; a 6th Phase 1 subagent (Vocabulary Extractor) proposes `docs/CONCEPTS.md` glossary candidates per `references/knowledge-compounder/concepts-vocabulary.md`, written by the orchestrator only, inside the M3 gate (interactive-only — the background drain never writes CONCEPTS.md)
- `session-historian` — cross-vendor session search across Claude Code (local
  JSONL), Devin (REST API via MCP), and Codex (local
  directory-per-session). BM25 + optional ruvector cosine + recency fused
  via Reciprocal Rank Fusion. Secret redaction (AWS keys, GitHub tokens,
  API keys, JWTs, PEM blocks) before excerpts are returned
- `staging-reviewer` — drain orchestrator for the background-compounding
  pipeline; dispatched by the SessionStart hook's `claude -p` drain
  subshell. 10-phase pipeline: move pending → processing, dedup,
  Haiku scoring via `staging-scorer`, guardian + injection + sanity
  filters, asymmetric semantic dedup, promotion via `staging-promoter`
- `staging-scorer` — Haiku-backed rubric scorer for one transcript
  excerpt; structured JSON output (skip OR score shape); hardened
  prompt with few-shot examples covering injection attempts
- `staging-promoter` — non-interactive writer that creates
  `docs/solutions/<category>/<slug>.md` and appends a one-line index
  entry to MEMORY.md `## Session Notes` ONLY. Frontmatter
  `disallowedTools: [AskUserQuestion]` is load-bearing (D8 in the
  background-compounding plan); RULE 14 in
  `scripts/validate-agent-authoring.js` blocks any removal of this deny

### Commands (19)

- `/flow:brainstorm` — explore requirements through dialogue and research before planning
- `/flow:spec` — draft a requirements spec (stable `R1..Rn` IDs + design)
  through guided dialogue, written to `plans/specs/<slug>.md`; the entry point
  for large multi-subsystem projects that decompose into shells. Spec only — no
  code
- `/flow:decompose` — break a spec into dependency-ordered shell files in
  `plans/shells/` with a blocking R-id coverage gate and `depends_on`
  traceability; a single-shell result bails out to `/flow:plan`
- `/flow:pick-next-shell` — pick the lowest-numbered shell whose
  `depends_on` are all archived in `plans/complete/` (exact-slug oracle),
  expand it, capture learnings, and halt for a fresh `/flow:work` session;
  reports cycles/unsatisfiable deps and the terminal state explicitly
- `/flow:expand-shell` — expand one shell into a concrete `- [ ]` checkbox
  plan in `plans/`, verifying `Consumes` against the live codebase and deleting
  the shell only after approval; usually invoked by `/flow:pick-next-shell`
- `/flow:plan` — transform feature descriptions into structured plans
- `/flow:work` — execute work plans systematically
- `/flow:review` — session-level review of plan adherence, cross-PR
  coherence, and scope drift with autonomous P1 fix loop. Falls back to
  `/review:pr` redirect for PR number/URL/branch arguments.
- `/flow:compound` — document a recently solved problem to compound
  knowledge. Pass `--in-pr` while on a feature branch with an open PR to
  draft both the solution doc and the MEMORY.md index line from the PR
  body + commit subjects instead of the live conversation transcript. This
  is the default pattern documented in `CONTRIBUTING.md` "Solution Docs";
  use it during a draft PR so the doc co-ships with the code change. The
  `knowledge-compounder` agent runs Related Docs Finder before any slug
  derivation so legitimate updates to an existing topic AMEND_EXISTING
  rather than creating a `-2`/`-3` suffixed file
- `/compound:review-staged` — manually drain the background-compounding
  staging ledger ahead of the SessionStart auto-drain threshold;
  AskUserQuestion M3 gate before any bulk write
- `/plan:status` — thin wrapper over the `plan-status` skill (invokes it via
  the `Skill` tool); read-only dashboard of `plans/` (open) and
  `plans/complete/` (archived) with per-file checkbox progress; 100%
  open plans annotated `-- ready to complete`. Sibling of
  `/plan:complete` and `/flow:plan` (see "Plan namespace split"
  below)
- `/plan:complete` — archive a single open plan with two safety gates:
  Gate A scans for unchecked `- [ ]` boxes; Gate C verifies merged-PR
  evidence in three tiers. A file-provenance tier runs first: it finds
  the commit that most recently touched the plan file on the repository's
  configured trunk and looks up its merged PR(s) via
  `gh api repos/{owner}/{repo}/commits/{sha}/pulls` — a unique match
  passes without prompting, captured in a `Plan-Verifier-FileProvenance:`
  commit trailer. This catches the routine case where a plan was
  expanded from a shell and implemented in the same PR, so the branch
  name carries too few slug tokens for either slug-match tier. When
  provenance finds no commit or an ambiguous PR set, a strict tier
  (server-side `--state merged` + `--jq` word-boundary post-filter of
  the full slug on `headRefName`) runs, then a loose tier scoring the
  100 most recent merged PRs by slug-token coverage over branch +
  title — a unique PR containing all slug tokens except at most one
  (all of them for slugs of ≤3 tokens) passes without prompting,
  captured in a `Plan-Verifier-LooseMatch:` commit trailer. Ambiguous
  or zero loose matches prompt the user via `AskUserQuestion` "Other"
  label for a PR-number override; the decision is captured in a
  `Plan-Verifier-Override:` commit trailer. Archival branch is
  `plan/archive-<slug>`; submitted via the active stacked-PR provider.
  The companion PR-diff-scoped validator `scripts/validate-plans.js`
  enforces the same no-stray-checkbox rule on archived files in CI
- `/stack:status` — read-only classification of stacked-PR provider state
  into one of eight states (`UNSELECTED`, `READY_GRAPHITE`, `READY_GITHUB`,
  `CONFLICT`, `CONFIG_MISMATCH`, `CONFIG_INVALID`, `MANAGED_CONFLICT`,
  `PARTIAL_TOOLING`). Reads `claude plugin list --json` plus the
  repository's optional `.yellow-stack.yml` intent through
  `lib/stack-provider-state.js`
- `/stack:select` — switch the active stacked-PR provider (`graphite` /
  `github`) at `user`, `project`, or `local` scope. Shows the exact
  `claude plugin install|enable|disable` commands before running any of
  them, installs only after confirmation, refuses managed-scope conflicts
  with an empty plan, aborts at the first failed step, and directs the
  user to `/reload-plugins`. Never edits settings JSON and never falls
  back to the other provider
- `/statusline:setup` — generate and install an adaptive statusline showing context, git, MCP health;
  Step 5b (or `/statusline:setup observer`) enables, refreshes or disables the opt-in context
  observer. `lib/statusline-settings.py` is the only writer of `statusLine.command`
- `/setup:all` — run setup for all installed marketplace plugins with unified dashboard
- `/setup:claude-web` — audit a repository and scaffold the files Claude Code
  Web needs (`.claude/settings.json`, `scripts/install_pkgs.sh`,
  `.gitattributes`, `.gitignore`, `.github/workflows/claude.yml`). Tiered
  interaction: auto-write safe additive edits, AskUserQuestion gate before
  new files / config merges, warn-only for STDIO MCP and oversized
  CLAUDE.md
- `/worktree:cleanup` — scan git worktrees, classify by state, and remove stale worktrees with safeguards
- `/worktree:restack` — restack a stack whose branches are each checked out in their own worktree.
  Routed through `stack-provider-router`, it detaches the stack worktrees (Graphite) or relies on
  gh-stack >= 0.2.0 (GitHub), runs one restack, and restores every worktree. A conflict pauses it;
  `--continue` / `--abort` resume. `--submit` submits through the provider afterwards; `--remote <name>`
  (GitHub) picks the remote when the clone has several. The work lives in
  `skills/git-worktree/scripts/worktree-restack.sh`; the command holds no `gt` / `gh stack` literals

### Skills (22)

- `agent-native-architecture` — reference for the five agent-native
  architecture principles (action parity, context parity, shared workspace,
  primitives over workflows, dynamic context injection); canonical source
  applied by `yellow-review:review:agent-native-reviewer`
- `agent-native-audit` — step-by-step audit checklist for evaluating an
  existing codebase against agent-native principles (capability mapping,
  noun test, anti-pattern catalog); used by `agent-native-reviewer` for PR
  reviews and broader audits
- `brainstorming` — reference guide for iterative brainstorm dialogues (internal)
- `compound-lifecycle` — audit, refresh, and consolidate `docs/solutions/`
  with composite-scored staleness detection, BM25+cosine overlap clustering,
  and AskUserQuestion-gated consolidation hand-off; archives superseded
  entries to `docs/solutions/archived/` rather than deleting them
- `create-agent-skills` — guidance for creating skills and agents:
  Claude 5 body style, security-fencing for untrusted input, reviewer/
  scanner confidence-scored findings vs task-specific output for other
  archetypes, and W1.5b `disallowedTools` on memory-backed read-only
  agents
- `debugging` — systematic root-cause debugging with causal-chain gate,
  prediction-for-uncertain-links hypothesis testing, three-failed-attempts
  smart escalation, and conditional defense-in-depth/post-mortem; routes to
  the active stacked-PR provider / `/yellow-core:flow:brainstorm` / `/yellow-core:flow:compound`
- `git-worktree` — git worktree management for parallel development;
  injects a `.ruvector/` symlink into new worktrees so the ruvector MCP
  server reaches the shared project DB instead of silently no-op'ing on
  a missing directory. `scripts/worktree-restack.sh` is the second script: the
  detach / restack / restore engine behind `/worktree:restack` (state under the git common dir,
  re-validated on every read)
- `ideation` — generate 3 grounded approaches to a soft problem using the
  Toulmin warrant contract (evidence + linking principle + idea), filtered
  through MIDAS three-phase generation, then route the chosen approach into
  `brainstorm-orchestrator` via the Agent tool. Strict-warrant mode
  auto-engages for security/auth/data-migration domains
- `local-config` — yellow-plugins.local.md per-project config schema (internal)
- `mcp-health-probe` — canonical MCP server health classification (OFFLINE /
  DEGRADED / HEALTHY plus PRESENT (untested) refinement) for
  `/<plugin>:status` commands (internal)
- `mcp-integration-patterns` — shared ruvector recall/remember and morph discovery patterns; its copy of the ruvector protocol constants is a RULE 16-linted replica of yellow-ruvector's canonical `memory-query` skill (internal)
- `memory-recall-pattern` — Recall-Before-Act pattern for ruvector: query
  past learnings via `hooks_recall` at workflow start (internal)
- `memory-remember-pattern` — Tiered-Remember-After-Act pattern for
  ruvector: record learnings via `hooks_remember` at workflow completion
  with Auto/Prompted/Skip signal-strength tiers (internal)
- `morph-discovery-pattern` — morph discovery + fallback pattern: discover
  `edit_file` and `warpgrep` at runtime via ToolSearch, prefer them for
  large edits and intent-based search, fall back to Edit/Grep silently
  when yellow-morph is missing (internal)
- `multi-host-fleet` — multi-host plugin credential and config reference:
  canonical shell env var names for every credential-bearing plugin, for
  new-workstation setup, CI/devcontainer config, and fleet credential
  replication
- `optimize` — run a metric-driven optimization pass with parallel candidate
  variants and an LLM-as-judge analytic rubric. Two-run order-swap recovers
  positional-bias variance; per-criterion scoring (1-5) outperforms holistic;
  style-bias self-check flags rationale drift. Optional `knowledge-compounder`
  hand-off writes the winner to `docs/solutions/optimizations/`
- `plan-status` — canonical read-only dashboard of `plans/` (open) and
  `plans/complete/` (archived) with per-file checkbox progress; the
  `/plan:status` command is a thin wrapper over this skill. One of
  yellow-core's three Codex-distributed skills (see "Codex Distribution"
  below)
- `security-fencing` — canonical prompt-injection hardening block for agents that analyze untrusted content (source code, CI logs, workflow files); single source of truth for the inlined `CRITICAL SECURITY RULES` block (internal)
- `session-handoff` — write a handoff note at
  `plans/handoff/<date>-<slug>.md` whose front matter is measured by
  `scripts/handoff.sh` (hashed repository/worktree identity, HEAD, dirty
  fingerprint, `context_at_capture` from the opt-in context observer) and
  whose narrative is redacted via `cs_redact_secrets`; resume only from an
  explicitly named note after a read-only preflight
  (`ready | mismatched | unsupported | blocked`)
- `session-history` — cross-vendor session-history user surface — dispatches
  the `session-historian` agent against Claude Code + Devin + Codex
  backends with availability detection and graceful degradation per backend
- `stack-provider-guard` — the four invariants that keep the provider
  model single-provider: exactly one enabled, managed scope fails closed,
  never edit settings JSON, never fall back. Consulted by `/stack:select`
  before it proposes anything
- `stack-provider-router` — resolves the active stacked-PR provider and
  routes provider-specific work to it. Only `READY_GRAPHITE` and
  `READY_GITHUB` route; the other six states stop with the classifier's
  own `detail` string

### Codex Distribution

yellow-core is the first plugin in this repo to set `targets.codex.enabled:
true` (`catalog/plugins/yellow-core.json`) — the first non-empty Codex
marketplace state (`.agents/plugins/marketplace.json`). Its Codex exposure
is a deliberately narrow, read-only allowlist of exactly three skills:
`agent-native-architecture`, `agent-native-audit`, and `plan-status`. Every
other component — all 21 agents, all three hooks (SessionStart, Stop,
PreCompact), background compounding, `setup:all`, statusline setup, MCP
helpers, `lib/` executables, and the remaining skills — is excluded.
`targets.codex.includeHooks: false` in the catalog source keeps those three
hooks (Stop and SessionStart are needed for background compounding on the
Claude side; PreCompact alters compaction prompts) out of the generated Codex
manifest entirely — see
`docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md`
for why that opt-out exists.

### Shared Libraries

`lib/` also carries four Node modules and two Python scripts, invoked rather
than sourced:

- `stack-provider-state.js` — the single owner of stacked-PR provider state.
  Classifies `claude plugin list --json` plus the repository's optional
  `.yellow-stack.yml` intent into the eight `/stack:status` states, and
  builds (never executes) the ordered `claude plugin` command plan for a
  provider switch. Dependency-free CJS with a small CLI
  (`node lib/stack-provider-state.js classify|plan`). It ships a replica of
  the catalog's `capabilityProvider` table because an installed plugin
  cannot read `catalog/` at runtime; `scripts/validate-provider-groups.js`
  fails CI (`ERROR-PROVIDER-006`) when that replica drifts. Fixture coverage
  at `tests/integration/stack-provider-state.test.ts`
- `stack-operation-registry.js` — maps each of the nine neutral stack operations
  (and `/flow:work`'s lower-level stack primitives) to exactly one Graphite and
  one GitHub implementation, or `null` (unsupported — callers stop, never try
  the other provider). Only its integration test loads it: `/flow:work` and
  `skills/git-worktree/scripts/worktree-restack.sh` derive from the entries in
  prose (the script adds scoping flags; its Graphite comment lists them), so
  change all together, and `/stack:status` / `/stack:select` do not read it.
  Dependency-free; verified by
  `tests/integration/stack-operation-registry.test.ts`
- `stack-tooling-probe.js` — the shared owner of provider CLI readiness
  (`gt` on PATH; `gh auth status` plus a verified `github/gh-stack`
  extension). `/stack:status`, `stack-provider-router`, and github-workflow's
  `github-stack-status` / `github-stack-setup` call it. Exception:
  `commands/setup/all.md`'s dashboard still inlines its own `gt` / `gh`
  checks, so a readiness change must update it too
- `remote-agent-provider-state.js` — classifies which `remote-agent` provider
  (yellow-cursor, yellow-devin, or yellow-jules) is active for
  `/linear:delegate` and `/setup:all` Step 2.5; a smaller
  sibling of `stack-provider-state.js` with no intent file and no switch plan
- `context-observer.py` — opt-in statusline stage (installed as
  `<config>/yellow-context-observer.py`): passes the payload through, always
  exits 0, and records context-window numbers to
  `<config>/projects/<slug>/context-observations/<session_id>.json`
  (stdlib only, no git; a 2 s recording deadline, `DEADLINE_SECONDS`, and
  a 100 ms latency target, backed by a looser R22 bats regression guard: best
  of five runs against a limit well above the target). Bats coverage at
  `tests/context-observer.bats` with real-host fixtures under
  `tests/fixtures/statusline/<client-version>/`
- `statusline-settings.py` — the only writer of `statusLine.command`
  (`statusline`, `status`, `plan`, `install`, `remove`, `prune`); every path
  has a default, `--dry-run` writes nothing, one JSON object per run. Used by
  `/statusline:setup` Steps 1, 5, 5b and 6

`lib/` otherwise contains sourceable shell helpers that consumer plugins
reach via the `${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/<name>.sh`
cross-plugin pattern:

- `credential-status.sh` — credential resolution and SessionStart hook helper
  for `/setup:all` dashboards
- `compound-staging.sh` — helpers for the background-compounding pipeline
  (project-slug derivation, atomic JSONL writes, secret redaction, drain-budget
  observability counter, ANTHROPIC_API_KEY auth-route detection, and
  `cs_stage_entry` for staging a non-transcript narrative). Sourced by
  yellow-core's `hooks/scripts/stop.sh`, `session-start.sh`,
  `_stop-capture-subshell.sh`, and the `/compound:review-staged` command, and
  by yellow-review's `lib/stage-learning.sh` and `lib/review-ledger.sh`
- `jev-prefilter.sh` — opt-in TypeSafe Jev shadow pre-filter for compound
  staging (see "Jev shadow pre-filter" under Compound Staging). Sourced only by
  `_stop-capture-subshell.sh`
- `validate-fs.sh` — `validate_file_path()` and `canonicalize_project_dir()`
  path-traversal validators (consumed by yellow-ci, yellow-ruvector,
  yellow-debt; yellow-debt declares it as a required dependency). Idempotent
  via `_VALIDATE_FS_LOADED` guard; safe to source twice from test setup +
  runtime hook chain. Canonical bats coverage at
  `plugins/yellow-core/tests/validate-fs.bats`
- `repo-profile.sh` — git-SHA-keyed repo-orientation profile cache
  (`rp_get`/`rp_put`): root-sha + head-sha key with proactive shallow-clone
  guard, conservative dirty-input invalidation, atomic whole-object tmp+mv
  writes (single writer per key — subfield patching is forbidden by
  contract), NO-CACHE degradation everywhere. Storage:
  `${CLAUDE_PLUGIN_DATA}` → `~/.cache/yellow-plugins/repo-profile/`.
  First consumer: `/flow:plan` Phase 2. Bats coverage at
  `plugins/yellow-core/tests/repo-profile.bats`
- `plugin-identity.sh` — `pi_report <plugin>` prints JSON comparing the
  installed cache's `plugin.json` version (under `${CLAUDE_PLUGIN_ROOT}`)
  with the checkout's `package.json` version; `identity` is
  `matches-checkout` (equal versions), `cache-lags-checkout`,
  `cache-ahead-of-checkout`, `no-checkout` (no checkout tree found), or
  `unknown`. "Matches" means the version strings agree — not that cached
  files match the checkout. `cache_commit` comes from
  `installed_plugins.json` for observability and is not compared with the
  checkout. Always exits 0 and never installs anything. Used by the
  `session-handoff` preflight. Bats coverage at
  `plugins/yellow-core/tests/plugin-identity.bats`
- `context-observer.sh` — `co_read_observation <session_id>` (the newest
  record for the session id wins) prints
  the observer's record reduced to `{remaining_percentage, used_percentage,
  observed_at, advisory_crossings, advisory_state, watermark_remaining}`,
  or `unknown` (missing, stale beyond 300 s, cross-session, malformed, out of
  range) with a stable reason code in `CO_REASON_FILE`. `CO_CONTEXT_JQ` is the
  shared jq validator for that object. Runs no git; needs `compound-staging.sh`
  sourced first. Used by `session-handoff`'s `measure` and `context`

`lib/quote-ground.sh` is not one of those sourced helpers. Execute it with
bash 4.4 or newer (`batch` also needs jq and iconv). `check <file> <line>
[radius]` reads the quote from stdin only (a missing radius is 3) and prints
the matched line number when the redacted, placeholder-canonicalized,
whitespace-normalized quote is a substring of a line in the inclusive window;
it exits 0 grounded, 1 for `ungrounded`, `too-short` or `unsafe-path`, and 2
for usage, a bad line or radius, a missing or unreadable file, or a redaction
failure. `batch` reads JSONL `{id, file, line, quote}` and writes one object
per input row, in input order, with `id`, `result` (`grounded`, `ungrounded`,
`too-short`, `unsafe-path`) and `matched_line` (a number for `grounded`,
otherwise `null`); it always uses radius 3, reports a missing file as
`ungrounded` and a row with a usable id but a bad field as `ungrounded`, and
exits 2 with no rows when jq or iconv is missing, a line is not JSON, a row
has no usable id (including an integer outside ±2^53), or a cited file cannot
be read. A quote with fewer than 8
characters outside `[REDACTED]` placeholders is `too-short`; a placeholder
matches any secret the line held. The script writes no temp files, so
unredacted text stays in memory and pipes. It sources `validate-fs.sh` and
`compound-staging.sh` itself. Do not source `quote-ground.sh`, and do not add
it to the Tier 4 dual-shell list. Bats coverage is `tests/quote-ground.bats`;
the contract is also in the README's "Quote grounding" section.

### Optional Plugin Dependencies

- **gt-workflow** — `/flow:work` delegates to `/smart-submit` for
  commit+submit and supports stack-aware execution when a
  `## Stack Decomposition` section exists in the plan (produced by
  `/gt-stack-plan`). Without gt-workflow, falls back to committing and
  submitting via the active stacked-PR provider and stack features are
  unavailable.
- **yellow-codex** — `/flow:work` offers Codex rescue
  (`codex-executor`) when tests fail during stack execution. Without
  yellow-codex, the rescue option is silently omitted.
- **yellow-review** — `/flow:work` invokes `/review:pr` after submission;
  `/flow:review` falls back to `/review:pr` redirect for PR
  number/URL/branch arguments. Without yellow-review, the redirect fallback
  shows an install notice.
- **yellow-linear** — `/flow:work` can invoke `/linear:sync --after-submit`
  as a fallback when native Linear GitHub automation is unavailable or needs
  repair. `/flow:plan` detects Linear issue context in brainstorm docs and
  includes a `## Linear Issues` metadata section. Without yellow-linear, both
  features skip silently.
- **yellow-research** — `best-practices-researcher` prefers
  `mcp__plugin_yellow-research_ceramic__ceramic_search` (lexical web search,
  OAuth 2.1) as its primary general-web source when yellow-research is
  installed. Detected via ToolSearch at runtime; falls back to built-in
  `WebSearch` silently when yellow-research is absent. This avoids
  duplicating the Ceramic MCP registration across plugins (single OAuth
  session).
- **yellow-council** — `/flow:work` Phase 3's polish loop escalates
  persistent P1/P2 review findings to `/council review` (cross-lineage review)
  when the review→fix loop hits its 3-iteration cap and the user chooses
  Escalate. Without yellow-council, the Escalate option degrades gracefully —
  only Continue/Stop are offered.

### MCP Servers (0)

yellow-core no longer bundles any MCP servers. Previously it shipped
`context7` as a bundled HTTP MCP, but that caused dual-registration issues
when users also had context7 at user level. Per CE PR #486 (2026-04-03)
parity, the bundled entry has been removed.

**Recommended user-level MCP:** `context7` — up-to-date library documentation
via [context7.com](https://context7.com). Install once at user level
(`/plugin install context7@upstash` or via Claude Code MCP settings); all
yellow-core and yellow-research agents that benefit from it (e.g.,
`best-practices-researcher`, `code-researcher`) detect availability via
ToolSearch and gracefully fall through to WebSearch / EXA when absent.

### Prompt cache TTL

No yellow-core agent sets `experimental.cacheTtl`. `learnings-researcher` is
one-shot on `/review:pr`, `/flow:plan`, `/flow:brainstorm`, and
`/docs:review`, so a `1h` cache write (about 2x base input versus 1.25x for
the default `5m`) would not pay back there. `/review:all` dispatches it
once per PR in the batch, which can pay back when those reviews are more
than five minutes apart; the field still stays off because the common path
is a single `/review:pr`. The 1h field stays on the yellow-review personas
that are re-dispatched across reviews.

### MCP Tool Integration

- **ruvector** — Recall past learnings at workflow start; tiered remember at
  workflow end. Graceful skip if yellow-ruvector not installed. See
  `mcp-integration-patterns` skill for canonical patterns.
- **morph** — Preferred for file edits (>200 lines or 3+ non-contiguous
  regions) and intent-based code search. Discovered via ToolSearch at runtime;
  falls back to built-in tools silently.

## Compound Staging

Background-compounding pipeline that captures session-transcript excerpts
at session end and asynchronously promotes high-signal entries to
`docs/solutions/` + the project's auto-memory MEMORY.md. Designed so the
main session never pays a turn-budget cost for compounding.

**Architecture (see `plans/complete/background-compounding-triggers.md` for full
detail):**

- Stop hook (pure shell, < 500ms) writes a JSONL pending entry to
  `~/.claude/projects/<slug>/compound-staging/pending/<session_id>.jsonl`.
  Secrets are redacted before write; transcript_tail capped at 100 lines.
- `cs_stage_entry <cwd> <session_id> <file>` is the second producer: it
  writes the same entry shape from a narrative file. yellow-review's
  unattended `/review:pr` Step 9a uses it (through `lib/stage-learning.sh`)
  instead of spawning the M3-gated `knowledge-compounder`. It caps the text
  at 8 KiB, strips control and invisible characters, redacts, then prefixes
  a `>` and a space to lines that could forge a fence or role turn (`---`, code fences,
  `system:`), in that order; returns 0 staged, 1 bad args, 2 no jq,
  3 sanitisation failed, 4 write failed.
- SessionStart hook checks thresholds (`count >= 5` OR `oldest > 48h`),
  acquires an atomic `.drain-lock` (mkdir-based), and disowns a
  `claude -p` drain subshell with `COMPOUND_DRAIN_IN_PROGRESS=1` env var
  set (recursion guard for the drain's own Stop + SessionStart hooks).
- The drain `claude -p` session invokes `staging-reviewer`, which scores
  each pending entry via `staging-scorer` (Haiku), filters through a
  multi-layer guardian (`category != behavioral_instruction`, no
  injection markers, sanity check for high-priority entries), runs
  asymmetric semantic dedup against the ruvector corpus, and dispatches
  surviving entries to `staging-promoter`.
- `staging-promoter` writes `docs/solutions/<category>/<slug>.md` and
  appends a one-line index entry to MEMORY.md's `## Session Notes`
  section ONLY. Its frontmatter has
  `disallowedTools: [AskUserQuestion]` as a load-bearing scheduler-level
  hard-deny (D8 in the plan). RULE 14 in
  `scripts/validate-agent-authoring.js` blocks any removal of this deny.

**Jev shadow pre-filter (opt-in, log only):** with
`COMPOUND_JEV_PREFILTER=shadow` and `TYPESAFE_API_KEY` set in the environment
the hooks inherit, the capture subshell sends the redacted tail's user and
assistant text (tool calls and results dropped, capped at the newest 24,000
bytes) to TypeSafe's Jev, fenced as untrusted reference data (`jev-1.13.0`
unless `COMPOUND_JEV_MODEL` is set; timeout `COMPOUND_JEV_TIMEOUT_S`, default 5
s). It runs after the pending entry is written and never changes what is staged.
Like the pending entry, the record is per session and each turn's answer
atomically replaces the last unless a newer turn's pending entry has superseded
it: `compound-staging/jev-shadow/<session_id>.json` holds session id, content
hash, the `durable` choice with confidence and probabilities, the
`has_instruction` probability, latency and a `would_skip` flag (trivial or
routine at confidence >= 0.9 and instruction probability <= 0.2). No transcript
text is logged. Every valid answer, even one that lands after a newer turn, is
also appended to `jev-shadow/predictions.jsonl`, because a drain can score an entry before a
later turn replaces the per-session file. When `jev-shadow/` exists, the staging-reviewer drain also
appends each scorer verdict (session id, content hash, verdict, priority) to
`jev-shadow/outcomes.jsonl`, the join key for that comparison. The key reaches curl as a config on fd 3 and the body on stdin,
so neither is in argv, and every failure is silent. The log exists to compare
against staging-scorer outcomes before any skip behaviour ships; this sends
session text to a third party, so leave it unset unless you accept that (trust
boundary: `docs/security.md` "Jev Shadow Pre-Filter").

**Manual override:** `/compound:review-staged` triggers a drain
immediately (skips threshold check) with an `AskUserQuestion` M3
confirmation gate showing pending count + sample titles.

**Auth route:** drains use the existing Claude Code subscription OAuth
token by default. If `ANTHROPIC_API_KEY` is set in the environment,
`claude -p` routes to API billing instead. The compound-staging.sh helper
detects this via `cs_detect_auth_route` and logs the chosen route to
`drain-logs/`. Per-drain cost is observability-only under subscription
auth (~5-20 short-message rate-limit equivalents per drain against the
Max 20x 5h window); the API-route fork is ~$0.13-0.17/drain.

## Plan Namespace Split

The plugin uses two distinct namespaces for plan-related commands:

- **`/flow:*`** — end-to-end workflows that produce new artifacts.
  `/flow:plan` writes a new plan file from a feature description;
  `/flow:work` executes one. Plan creation lives here because it is
  one of several artifact-producing workflows (alongside `brainstorm`,
  `review`, `compound`).
- **`/plan:*`** — lifecycle operations on existing plan artifacts.
  `/plan:status` (read-only dashboard) and `/plan:complete` (archival
  with Gate A + Gate C) are not general workflows; they operate
  specifically on the corpus of `plans/*.md` files. Future authors
  adding plan-related lifecycle commands should put them under
  `/plan:*`.

The PR-diff-scoped validator `scripts/validate-plans.js` (root-level)
enforces no-stray-checkbox on archived files in PR diffs. It is wired
as a 6th matrix target in `.github/workflows/validate-schemas.yml` (sibling
to the marketplace/plugins/contracts/examples/solutions targets), not
inside `validate:schemas` itself. The error code is `ERROR-PLAN-001`
(catalog: `packages/domain/src/validation/errorCatalog.ts`, category
`ErrorCategory.PLAN_LIFECYCLE`).

## Testing

`bats tests/` from the plugin directory (`compound-session-start-hook`,
`compound-staging`, `compound-stop-hook`, `context-observer`,
`credential-status`, `handoff`, `jev-prefilter`, `plan-commands`, `plan-status-parity`,
`plugin-identity`, `pre-compact-hook`, `quote-ground`, `repo-profile`,
`setup-all-ruvector-probe`, `validate-fs`) plus `skills/git-worktree/tests/` (`worktree-manager.bats`,
`worktree-restack.bats` with stub `gt` / `gh` / `git` shims under `tests/mocks/`).
Manifest hook budgets: Stop 5s, SessionStart 3s, PreCompact 3s
(`catalog/plugins/yellow-core.json`).

## Known Limitations

- **Per-worktree staging.** Each git worktree has its own
  `~/.claude/projects/<slug>/compound-staging/` directory (derived from
  `git rev-parse --show-toplevel`) and promotes to its own
  `docs/solutions/`. Concurrent worktree sessions on the same project do
  not share pending entries.
- **PII residue window.** Raw transcript tails (post-secret-redaction)
  sit in `pending/` until drained. The SessionStart hook's reaper
  deletes pending entries older than 7 days as a PII safety net. Treat
  `~/.claude/projects/<slug>/compound-staging/` as sensitive — do not
  relocate to a tracked directory; the recommended `.gitignore` entry is
  `compound-staging/`.
- **Async via disowned subshells only.** The plugin manifest does NOT
  use an `async: true` hook schema field (Claude Code's remote validator
  rejects it — confirmed via deepen-plan validation). Non-blocking
  behavior comes entirely from the disowned-subshell pattern in
  `hooks/scripts/stop.sh` and `hooks/scripts/session-start.sh`.
- **PreCompact hook is the odd one out.** `hooks/scripts/pre-compact.sh`
  prints plain text, not `{"continue": true}`: Claude Code appends a
  PreCompact hook's stdout to the **main-session** compaction prompt on
  exit 0 (exit 2 blocks compaction). Subagent compactons (`agentContext`
  set) discard that stdout. It carries the Claude 5-generation
  compaction-preservation instruction (plan path + unchecked tasks,
  modified files, user decisions verbatim, open questions, last failing
  command, in-flight branch/PR names — every item secret-redacted then
  fenced as untrusted-content).
  Synchronous, no jq, well under its 3s timeout. Hook events live in
  `catalog/plugins/yellow-core.json` and are regenerated into
  `plugin.json` by `pnpm generate:manifests`. Tests:
  `tests/pre-compact-hook.bats`.
- **MEMORY.md migration is manual.** Plugin install does not partition
  an existing MEMORY.md into `## CORE_RULES`/`## USER_PREFERENCES`/
  `## KNOWN_PROJECTS`/`## Session Notes` automatically. `staging-promoter`
  creates the `## Session Notes` section at end-of-file if absent;
  partition migration is recommended manual work (see the contract block
  at the top of MEMORY.md for the canonical structure).
- **Uninstall does not reap staging dirs.** Removing yellow-core does
  NOT delete `~/.claude/projects/<slug>/compound-staging/` or any
  pending/processing entries. Manually `rm -rf` the staging dir to
  reclaim disk; the directory is inert without the hooks installed.
