# yellow-core Plugin

Comprehensive dev toolkit for TypeScript, Python, Rust, and Go projects.

## Conventions

- Use Graphite (`gt`) for all branch management and PR creation — never raw
  `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Keep code simple and direct. No premature abstractions
- Prefer explicit over implicit. Name things clearly
- Write tests for non-trivial logic
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
- `knowledge-compounder` — extract and document solved problems to docs/solutions/ and MEMORY.md
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

### Commands (12)

- `/workflows:brainstorm` — explore requirements through dialogue and research before planning
- `/workflows:plan` — transform feature descriptions into structured plans
- `/workflows:work` — execute work plans systematically
- `/workflows:review` — session-level review of plan adherence, cross-PR
  coherence, and scope drift with autonomous P1 fix loop. Falls back to
  `/review:pr` redirect for PR number/URL/branch arguments.
- `/workflows:compound` — document a recently solved problem to compound
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
- `/plan:status` — read-only dashboard of `plans/` (open) and
  `plans/complete/` (archived) with per-file checkbox progress; 100%
  open plans annotated `-- ready to complete`. Sibling of
  `/plan:complete` and `/workflows:plan` (see "Plan namespace split"
  below)
- `/plan:complete` — archive a single open plan with two safety gates:
  Gate A scans for unchecked `- [ ]` boxes; Gate C queries GitHub for
  a merged PR whose title and branch contain the slug derived from the
  filename (server-side `--state merged` + `--jq` word-boundary
  post-filter on `headRefName`). NO-EVIDENCE prompts the user via
  `AskUserQuestion` "Other" label for a PR-number override; the
  decision is captured in a `Plan-Verifier-Override:` commit trailer.
  Archival branch is `plan/archive-<slug>`; submitted via
  `gt submit --no-interactive`. The companion PR-diff-scoped
  validator `scripts/validate-plans.js` enforces the same
  no-stray-checkbox rule on archived files in CI
- `/statusline:setup` — generate and install an adaptive statusline showing context, git, MCP health
- `/setup:all` — run setup for all installed marketplace plugins with unified dashboard
- `/setup:claude-web` — audit a repository and scaffold the files Claude Code
  Web needs (`.claude/settings.json`, `scripts/install_pkgs.sh`,
  `.gitattributes`, `.gitignore`, `.github/workflows/claude.yml`). Tiered
  interaction: auto-write safe additive edits, AskUserQuestion gate before
  new files / config merges, warn-only for STDIO MCP and oversized
  CLAUDE.md
- `/worktree:cleanup` — scan git worktrees, classify by state, and remove stale worktrees with safeguards

### Skills (13)

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
- `create-agent-skills` — guidance for creating skills and agents
- `debugging` — systematic root-cause debugging with causal-chain gate,
  prediction-for-uncertain-links hypothesis testing, three-failed-attempts
  smart escalation, and conditional defense-in-depth/post-mortem; routes to
  `gt submit` / `/yellow-core:workflows:brainstorm` / `/yellow-core:workflows:compound`
- `git-worktree` — git worktree management for parallel development;
  injects a `.ruvector/` symlink into new worktrees so the ruvector MCP
  server reaches the shared project DB instead of silently no-op'ing on
  a missing directory
- `ideation` — generate 3 grounded approaches to a soft problem using the
  Toulmin warrant contract (evidence + linking principle + idea), filtered
  through MIDAS three-phase generation, then route the chosen approach into
  `brainstorm-orchestrator` via Task. Strict-warrant mode auto-engages for
  security/auth/data-migration domains
- `local-config` — yellow-plugins.local.md per-project config schema (internal)
- `mcp-integration-patterns` — canonical patterns for ruvector recall/remember and morph discovery integration (internal)
- `optimize` — run a metric-driven optimization pass with parallel candidate
  variants and an LLM-as-judge analytic rubric. Two-run order-swap recovers
  positional-bias variance; per-criterion scoring (1-5) outperforms holistic;
  style-bias self-check flags rationale drift. Optional `knowledge-compounder`
  hand-off writes the winner to `docs/solutions/optimizations/`
- `security-fencing` — canonical prompt-injection hardening block for agents that analyze untrusted content (source code, CI logs, workflow files); single source of truth for the inlined `CRITICAL SECURITY RULES` block (internal)
- `session-history` — cross-vendor session-history user surface — dispatches
  the `session-historian` agent against Claude Code + Devin + Codex
  backends with availability detection and graceful degradation per backend

### Shared Libraries

`lib/` contains sourceable shell helpers that consumer plugins reach via the
`${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/<name>.sh` cross-plugin pattern:

- `credential-status.sh` — credential resolution and SessionStart hook helper
  for `/setup:all` dashboards
- `compound-staging.sh` — helpers for the background-compounding pipeline
  (project-slug derivation, atomic JSONL writes, secret redaction, drain-budget
  observability counter, ANTHROPIC_API_KEY auth-route detection). Sourced by
  yellow-core's `hooks/scripts/stop.sh`, `session-start.sh`,
  `_stop-capture-subshell.sh`, and the `/compound:review-staged` command
- `validate-fs.sh` — `validate_file_path()` and `canonicalize_project_dir()`
  path-traversal validators (consumed by yellow-ci, yellow-ruvector,
  yellow-debt; yellow-debt declares it as a required dependency). Idempotent
  via `_VALIDATE_FS_LOADED` guard; safe to source twice from test setup +
  runtime hook chain. Canonical bats coverage at
  `plugins/yellow-core/tests/validate-fs.bats`

### Optional Plugin Dependencies

- **gt-workflow** — `/workflows:work` delegates to `/smart-submit` for
  commit+submit and supports stack-aware execution when a
  `## Stack Decomposition` section exists in the plan (produced by
  `/gt-stack-plan`). Without gt-workflow, falls back to inline `gt modify -m` +
  `gt submit --no-interactive` and stack features are unavailable.
- **yellow-codex** — `/workflows:work` offers Codex rescue
  (`codex-executor`) when tests fail during stack execution. Without
  yellow-codex, the rescue option is silently omitted.
- **yellow-review** — `/workflows:work` invokes `/review:pr` after submission;
  `/workflows:review` falls back to `/review:pr` redirect for PR
  number/URL/branch arguments. Without yellow-review, the redirect fallback
  shows an install notice.
- **yellow-linear** — `/workflows:work` can invoke `/linear:sync --after-submit`
  as a fallback when native Linear GitHub automation is unavailable or needs
  repair. `/workflows:plan` detects Linear issue context in brainstorm docs and
  includes a `## Linear Issues` metadata section. Without yellow-linear, both
  features skip silently.
- **yellow-research** — `best-practices-researcher` prefers
  `mcp__plugin_yellow-research_ceramic__ceramic_search` (lexical web search,
  OAuth 2.1) as its primary general-web source when yellow-research is
  installed. Detected via ToolSearch at runtime; falls back to built-in
  `WebSearch` silently when yellow-research is absent. This avoids
  duplicating the Ceramic MCP registration across plugins (single OAuth
  session).

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

**Architecture (see `plans/background-compounding-triggers.md` for full
detail):**

- Stop hook (pure shell, < 500ms) writes a JSONL pending entry to
  `~/.claude/projects/<slug>/compound-staging/pending/<session_id>.jsonl`.
  Secrets are redacted before write; transcript_tail capped at 100 lines.
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

- **`/workflows:*`** — end-to-end workflows that produce new artifacts.
  `/workflows:plan` writes a new plan file from a feature description;
  `/workflows:work` executes one. Plan creation lives here because it is
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
