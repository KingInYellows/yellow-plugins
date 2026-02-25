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

### Commands (3)

- `/review:pr` — Adaptive multi-agent review of a single PR with automatic fix
  application
- `/review:resolve` — Parallel resolution of unresolved PR review comments via
  GraphQL
- `/review:all` — Sequential review of multiple PRs (Graphite stack, all open,
  or single PR)

### Agents (8)

**Review** — parallel code analysis specialists (report findings, do NOT edit):

- `code-reviewer` — General code review, CLAUDE.md compliance, conventions
  (always selected)
- `pr-test-analyzer` — Test coverage and behavioral completeness
- `comment-analyzer` — Comment accuracy and rot detection
- `code-simplifier` — Simplification preserving functionality (runs as final
  pass)
- `type-design-analyzer` — Type design, encapsulation, invariants
- `silent-failure-hunter` — Silent failure and error handling analysis

**Workflow** — orchestration helpers:

- `pr-comment-resolver` — Implements fix for a single review comment (spawned in
  parallel)
- `learning-compounder` — Captures review patterns to memory and solution docs

### Skills (1)

- `pr-review-workflow` — Internal reference for adaptive selection, output
  format, error handling, and Graphite integration (not user-invokable)

### Scripts (2)

- `get-pr-comments` — Fetch unresolved, non-outdated PR review threads via
  GitHub GraphQL API
- `resolve-pr-thread` — Resolve a single review thread via GitHub GraphQL
  mutation

## When to Use What

- **`/review:pr`** — Review a single PR with adaptive agent selection. Best for
  focused reviews of individual changes.
- **`/review:resolve`** — Address pending review comments. Run after receiving
  feedback to fix and mark threads resolved.
- **`/review:all scope=stack`** — Review entire Graphite stack in dependency
  order (base → tip). Best before submitting a stack for review.
- **`/review:all scope=all`** — Batch-review all your open non-draft PRs. Best
  for catching up on review backlog.

## Cross-Plugin Agent References

When conditions warrant, commands spawn these agents via Task tool (using
`yellow-core:review:<name>` subagent_type):

- `security-sentinel` — for auth, crypto, and shell script changes
- `architecture-strategist` — for large (10+ file) cross-module changes
- `performance-oracle` — for query-heavy or high-line-count PRs
- `pattern-recognition-specialist` — for new pattern introductions and plugin
  authoring convention checks
- `code-simplicity-reviewer` — additional simplification pass for large PRs

yellow-review requires yellow-core for full review coverage. Without it,
cross-plugin agents (security-sentinel, architecture-strategist,
performance-oracle, pattern-recognition-specialist) silently degrade — only
yellow-review's own agents run.

## Known Limitations

- GraphQL scripts require `gh` and `jq` to be installed
- Cross-plugin agents require Compound Engineering plugin to be installed
- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs are excluded from `/review:all scope=all` by default
- `gt track` may fail on non-Graphite PRs — falls back to raw git (degraded
  mode)
