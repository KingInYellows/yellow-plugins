# yellow-review Plugin

Multi-agent PR review with adaptive agent selection, parallel comment
resolution, and sequential stack review. Graphite-native workflow.

## Conventions

- Use Graphite (`gt`) for all branch management and PR creation — never raw
  `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Agents report findings — they do NOT edit project files directly. The
  `memory: project` frontmatter auto-enables Read/Write/Edit per Claude Code
  docs (so agents can persist learnings to `.claude/agent-memory/<name>/`),
  but the prompt-level "report findings only" rule remains in force; the
  orchestrating command applies all fixes
- Orchestrating commands apply fixes sequentially to avoid conflicts
- All shell scripts follow POSIX security patterns (quoted variables, input
  validation, `set -eu`)
- Working directory must be clean before running any review command
- Commit messages: `fix: address review findings from <agents>` or
  `fix: resolve PR #<num> review comments`
- Always confirm with user via `AskUserQuestion` before pushing changes — never
  auto-push without human approval. **Exceptions** (commands that intentionally
  run unattended and suppress every push gate by design):
  - `/review:resolve-stack` — walks a Graphite stack invoking
    `/review:resolve --non-interactive` per PR
  - `/review:sweep` — invokes `/review:pr --non-interactive` then
    `/review:resolve --non-interactive` on a single PR with no gates
  - `/review:sweep-all` — loops `/review:sweep` over every open non-draft PR
    you authored; only the one upfront M3 confirmation is interactive
  
  The default `/review:pr` and `/review:resolve` paths (no flag) keep every
  gate. The `--non-interactive` flag opts a single invocation in to the
  unattended behavior.

## Plugin Components

### Commands (7)

- `/review:setup` — Validate GitHub, jq, Graphite, and optional yellow-core
  integration before reviewing PRs
- `/review:pr` — Adaptive multi-agent review of a single PR with automatic fix
  application. Accepts `--non-interactive` to suppress its Step 9
  push-confirmation prompt and its Step 9b "save learnings" prompt (used by
  `/review:sweep`)
- `/review:resolve` — Parallel resolution of unresolved PR review comments via
  GraphQL. Accepts `--non-interactive` to suppress its spawn-cap, CONFLICT, and
  push-confirmation gates (used by `/review:resolve-stack` and `/review:sweep`)
- `/review:resolve-stack` — Walk the current Graphite stack bottom-up and run
  `/review:resolve --non-interactive` on every open PR fully autonomously (no
  prompts), pushing and restacking as it goes
- `/review:all` — Sequential review of multiple PRs (Graphite stack, all open,
  or single PR)
- `/review:sweep` — Wrapper that runs `/review:pr --non-interactive` then
  `/review:resolve --non-interactive` on the same PR with no gates in
  between — fully unattended
- `/review:sweep-all` — Run `/review:sweep` on every open non-draft PR you
  authored sequentially, with one upfront confirmation, skip-and-continue per
  PR, end-of-loop summary, and a single `/flow:compound` pass at the end

### Agents (16)

**Review** — parallel code analysis specialists (report findings, do NOT edit):

- `project-compliance-reviewer` — CLAUDE.md/AGENTS.md compliance, naming,
  project-pattern adherence (always selected; renamed from `code-reviewer`
  in Wave 2)
- `correctness-reviewer` — Logic errors, edge cases, state bugs, error
  propagation (always selected; new in Wave 2)
- `maintainability-reviewer` — Premature abstraction, dead code, coupling,
  naming (always selected; new in Wave 2)
- `reliability-reviewer` — Production reliability: error handling, retries,
  timeouts, cascades (selected when diff touches I/O/async; new in Wave 2)
- `project-standards-reviewer` — Frontmatter, references, cross-platform
  portability (always selected; new in Wave 2; complements
  `project-compliance-reviewer`)
- `adversarial-reviewer` — Constructed failure scenarios across boundaries
  (selected for diffs >200 lines or trust boundaries; new in Wave 2)
- `plugin-contract-reviewer` — Breaking changes to plugin public surface
  (subagent_type renames, command/skill/MCP-tool renames, manifest field
  changes, hook contract changes); selected when diff touches
  `plugins/*/.claude-plugin/plugin.json`, `plugins/*/agents/**/*.md`,
  `plugins/*/commands/**/*.md`, `plugins/*/skills/**/SKILL.md`, or
  `plugins/*/hooks/`. Sister to `pattern-recognition-specialist`
  (yellow-core) — pattern-rec catches new convention drift,
  plugin-contract catches breaks to existing surface. New in Wave 3.
- `cli-readiness-reviewer` — Conditional persona that reviews CLI command
  surface for autonomous-agent invocability (interactive prompts without
  bypass, missing structured output, vague errors, unsafe retries, ANSI
  in pipes). Selected on the same plugin-authoring globs as
  `plugin-contract-reviewer`; concerns are disjoint. New in Wave 3.
- `agent-cli-readiness-reviewer` — Conditional persona using a 7-principle
  Blocker/Friction/Optimization rubric for CLI agent-readiness (non-interactive
  defaults, structured output, actionable errors, safe retries, bounded
  output, composability, discoverability). Adapted from upstream CE
  v3.3.2; deeper than `cli-readiness-reviewer` for design-doc audits and
  full-CLI evaluations. New in Wave 3.
- `agent-native-reviewer` — Conditional persona reviewing agent-native
  parity: every UI action has an agent tool equivalent, agents see the
  same data users see, shared workspace, primitives over workflows,
  dynamic context injection. Adapted from upstream CE v3.3.2. New in Wave 3.
- `pr-test-analyzer` — Test coverage and behavioral completeness
- `comment-analyzer` — Comment accuracy and rot detection
- `code-simplifier` — Simplification preserving functionality (runs as final
  pass)
- `type-design-analyzer` — Type design, encapsulation, invariants
- `silent-failure-hunter` — Silent failure and error handling analysis

**Workflow** — orchestration helpers:

- `pr-comment-resolver` — Implements fix for a single review comment (spawned in
  parallel)

### Skills (2)

- `pr-review-workflow` — Internal reference for adaptive selection, output
  format, error handling, and Graphite integration (not user-invokable)
- `stack-traversal` — Internal reference for the bottom-up Graphite
  stack-traversal procedure shared by `/review:all` and
  `/review:resolve-stack` (not user-invokable)

### Scripts (2)

- `get-pr-comments` — Fetch unresolved, non-outdated PR review threads via
  GitHub GraphQL API
- `resolve-pr-thread` — Resolve a single review thread via GitHub GraphQL
  mutation

Both live at `skills/pr-review-workflow/scripts/` and are invoked as
`${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/<name>`.

## When to Use What

- **`/review:setup`** — First install, after auth issues, or when review
  commands fail before agent analysis begins.
- **`/review:pr`** — Review a single PR with adaptive agent selection. Best for
  focused reviews of individual changes.
- **`/review:resolve`** — Address pending review comments on a single PR. Run
  after receiving feedback to fix and mark threads resolved. Keeps its
  spawn-cap and push-confirmation gates for interactive use.
- **`/review:resolve-stack`** — Resolve comments across an entire Graphite
  stack in one unattended pass. Walks base → tip, runs `/review:resolve` per PR
  with gates suppressed, pushes and restacks autonomously. Best when you have
  review feedback spread across a multi-PR stack and want it all cleared
  without per-PR prompts. Distinct from `/review:all scope=stack` (which runs
  the full review + resolve pipeline per PR) — `resolve-stack` is resolve-only.
- **`/review:all scope=stack`** — Review entire Graphite stack in dependency
  order (base → tip). Best before submitting a stack for review.
- **`/review:all scope=all`** — Batch-review all your open non-draft PRs. Best
  for catching up on review backlog.
- **`/review:sweep`** — Run `/review:pr --non-interactive` then
  `/review:resolve --non-interactive` sequentially on a single PR with no
  gates anywhere. Best when you want both an AI review pass and cleanup of
  any open bot/human comment threads in one fire-and-forget invocation.
- **`/review:sweep-all`** — Loop `/review:sweep` over every open non-draft
  PR you authored, sequentially. One upfront M3 confirmation shows the PR
  list; after Proceed, runs unattended end-to-end. Skip-and-continue on
  per-PR failure, summary table, and an end-of-loop `/flow:compound`
  pass to capture learnings. Best for clearing review + resolve backlog
  across multiple open PRs at once. Distinct from `/review:all scope=all`
  (which runs the deeper review pipeline per PR with per-PR push gates) —
  `sweep-all` is the lighter, fully-unattended batch alternative.
- **`/flow:review`** (yellow-core) — Session-level review against a plan
  file. Evaluates plan adherence, cross-PR coherence, and scope drift.
  Complementary to `/review:pr` (per-PR code quality) — use both for full
  coverage.

## Cross-Plugin Agent References

When conditions warrant, commands spawn these agents via Task tool (using
the three-segment `yellow-core:<dir>:<name>` subagent_type — e.g.
`yellow-core:review:security-reviewer`). The Wave 2 pipeline dispatches the
calibrated reviewer variants; the legacy fallback (`review_pipeline:
legacy` in `yellow-plugins.local.md`) keeps the deeper-audit variants.

- `security-reviewer` — for auth, crypto, and shell-script changes (Wave 2
  default; the deeper-audit `security-sentinel` is the legacy fallback)
- `architecture-strategist` — for large (10+ file) cross-module changes
- `performance-reviewer` — for query-heavy or high-line-count PRs (Wave 2
  default; the deeper-audit `performance-oracle` is the legacy fallback)
- `pattern-recognition-specialist` — for new pattern introductions and
  plugin authoring convention checks
- `code-simplicity-reviewer` — additional simplification pass for large PRs

Optional supplementary agent via Task tool (using the three-segment
`yellow-codex:review:codex-reviewer` subagent_type):

- `codex-reviewer` — parallel review when yellow-codex is installed AND
  diff > 100 lines. Tags findings with `[codex]`. Silently skipped when
  yellow-codex is not installed.

yellow-review requires yellow-core for full review coverage. Without it,
cross-plugin agents (security-reviewer / security-sentinel,
architecture-strategist, performance-reviewer / performance-oracle,
pattern-recognition-specialist, code-simplicity-reviewer) silently
degrade — only yellow-review's own agents run.

### MCP Tool Integration

- **ruvector** — Recall past learnings at workflow start; tiered remember at
  workflow end (Auto for P0/P1 findings, Prompted for P2). Graceful skip if
  yellow-ruvector not installed.
- **morph** — Preferred for intent-based code search (blast radius, callers,
  similar patterns) in review agents. Discovered via ToolSearch at runtime;
  falls back to built-in Grep silently.
- **ast-grep** (yellow-research) — Optional structural code search for
  silent-failure-hunter and type-design-analyzer. Discovered via ToolSearch at
  runtime; falls back to Grep if yellow-research not installed.

## Testing

`bats tests/` from the plugin directory — `get-pr-comments.bats` and
`resolve-pr-thread.bats` (GraphQL fixtures in `tests/fixtures/`, fake `gh` in
`tests/mocks/gh`) plus `skill-content.bats`.

## Known Limitations

- GraphQL scripts require `gh` and `jq` to be installed
- Cross-plugin agents require the `yellow-core` plugin to be installed
- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs are excluded from `/review:all scope=all` by default
- `gt track` may fail on non-Graphite PRs — falls back to raw git (degraded
  mode)
