# yellow-review Plugin

Multi-agent PR review with adaptive agent selection, parallel comment
resolution, and sequential stack review. Graphite-native workflow.

## Conventions

- Use Graphite (`gt`) for all branch management and PR creation — never raw
  `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Agents report findings — they do NOT edit files directly
- Orchestrating commands apply fixes sequentially to avoid conflicts
- All shell scripts follow POSIX security patterns (quoted variables, input
  validation, `set -eu`)
- Working directory must be clean before running any review command
- Commit messages: `fix: address review findings from <agents>` or
  `fix: resolve PR #<num> review comments`
- Always confirm with user via `AskUserQuestion` before pushing changes — never
  auto-push without human approval

## Plugin Components

### Commands (5)

- `/review:setup` — Validate GitHub, jq, Graphite, and optional yellow-core
  integration before reviewing PRs
- `/review:pr` — Adaptive multi-agent review of a single PR with automatic fix
  application
- `/review:resolve` — Parallel resolution of unresolved PR review comments via
  GraphQL
- `/review:all` — Sequential review of multiple PRs (Graphite stack, all open,
  or single PR)
- `/review:sweep` — Wrapper that runs `/review:pr` then `/review:resolve` on
  the same PR with a user-confirmed boundary gate between them

### Agents (14)

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
- `pr-test-analyzer` — Test coverage and behavioral completeness
- `comment-analyzer` — Comment accuracy and rot detection
- `code-simplifier` — Simplification preserving functionality (runs as final
  pass)
- `type-design-analyzer` — Type design, encapsulation, invariants
- `silent-failure-hunter` — Silent failure and error handling analysis
- `code-reviewer` — DEPRECATED stub for the rename above; will be removed
  in next minor version

**Workflow** — orchestration helpers:

- `pr-comment-resolver` — Implements fix for a single review comment (spawned in
  parallel)

### Skills (1)

- `pr-review-workflow` — Internal reference for adaptive selection, output
  format, error handling, and Graphite integration (not user-invokable)

### Scripts (2)

- `get-pr-comments` — Fetch unresolved, non-outdated PR review threads via
  GitHub GraphQL API
- `resolve-pr-thread` — Resolve a single review thread via GitHub GraphQL
  mutation

## When to Use What

- **`/review:setup`** — First install, after auth issues, or when review
  commands fail before agent analysis begins.
- **`/review:pr`** — Review a single PR with adaptive agent selection. Best for
  focused reviews of individual changes.
- **`/review:resolve`** — Address pending review comments. Run after receiving
  feedback to fix and mark threads resolved.
- **`/review:all scope=stack`** — Review entire Graphite stack in dependency
  order (base → tip). Best before submitting a stack for review.
- **`/review:all scope=all`** — Batch-review all your open non-draft PRs. Best
  for catching up on review backlog.
- **`/review:sweep`** — Run `/review:pr` then `/review:resolve` sequentially
  on a single PR. Best when you want both an AI review pass and cleanup of
  any open bot/human comment threads in one invocation.
- **`/workflows:review`** (yellow-core) — Session-level review against a plan
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

## Known Limitations

- GraphQL scripts require `gh` and `jq` to be installed
- Cross-plugin agents require the `yellow-core` plugin to be installed
- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs are excluded from `/review:all scope=all` by default
- `gt track` may fail on non-Graphite PRs — falls back to raw git (degraded
  mode)
