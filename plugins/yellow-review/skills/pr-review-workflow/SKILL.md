---
name: pr-review-workflow
description: >
  Internal reference for PR review workflow patterns. Use when agents or commands
  need shared conventions for adaptive selection, output format, or error handling.
user-invocable: false
---

# PR Review Workflow Patterns

## What It Does

Reference patterns and conventions for PR review workflows. Loaded by commands and agents for consistent behavior.

## When to Use

Use when yellow-review plugin commands or agents need shared context for adaptive agent selection, finding output format, error handling, or Graphite integration.

## Usage

This skill is not user-invocable. It provides shared context for the yellow-review plugin's commands and agents.

## Adaptive Agent Selection

### Always Selected
- `code-reviewer` — runs on every PR
- `code-simplifier` — runs as final pass after fixes applied

### Conditional Selection

Selection is based on `git diff --stat` and `git diff` output analysis:

**pr-test-analyzer** — Selected when:
- PR contains files matching `*test*`, `*spec*`, `__tests__/*`
- OR PR adds/modifies files with testable logic (functions, classes, methods)

**comment-analyzer** — Selected when:
- Diff contains `/**`, `"""`, `'''`, or `@param`/`@returns`/`@throws` annotations
- OR diff modifies `.md` documentation files

**type-design-analyzer** — Selected when:
- Files have extensions `.ts`, `.py`, `.rb`, `.go`, `.rs`
- AND diff contains keywords: `interface`, `type`, `class`, `struct`, `enum`, `model`, `dataclass`

**silent-failure-hunter** — Selected when:
- Diff contains: `try`, `catch`, `except`, `rescue`, `recover`
- OR diff contains: `fallback`, `default`, `|| null`, `?? undefined`, `or None`

### Cross-Plugin Agents (from yellow-core)

These are spawned via Task tool when conditions match:

**security-sentinel** — Selected when:
- Files match: `auth*`, `*security*`, `*crypto*`, `*.sh`
- OR diff contains: `exec`, `eval`, `password`, `token`, `secret`, `shell`

**architecture-strategist** — Selected when:
- PR touches 10+ files across 3+ directories

**performance-oracle** — Selected when:
- Diff contains: `query`, `SELECT`, `INSERT`, `loop`, `while`, `for.*range`
- OR gross line count > 500

**pattern-recognition-specialist** — Selected when:
- PR introduces new patterns (new directories, new file type conventions)

**agent-native-reviewer** — Selected when:
- Changes to `agents/*.md`, `commands/*.md`, `skills/*/SKILL.md`, `plugin.json`

**code-simplicity-reviewer** (yellow-core) — Available as additional pass when:
- Gross line count > 300

### Line Count Calculation

Gross changes = additions + deletions from `git diff --stat | tail -1`.

```bash
git diff --numstat origin/main...HEAD | awk '
  $1 != "-" { add += $1; del += $2 }
  END { print add + del }
'
```

Binary files show `-` in numstat and are excluded.

### Size Tiers
- **Small** (< 100 lines): code-reviewer + code-simplifier only
- **Medium** (100-500 lines): + conditional agents based on content
- **Large** (> 500 lines): all applicable agents including cross-plugin

## Finding Output Format

All agents use this consistent format:

```
**[P1|P2|P3] category — file:line**
Finding: <what the issue is>
Fix: <concrete suggestion>
```

## Severity Definitions

- **P1**: Correctness bug, security vulnerability, or data loss risk. Must fix before merge.
- **P2**: Quality issue, maintainability concern, or convention violation. Should fix.
- **P3**: Style suggestion, minor improvement, or nitpick. Consider fixing.

## Error Handling

### GitHub API Errors
| HTTP Status | Category | Action |
|-------------|----------|--------|
| 401 | Authentication | Report: "Run `gh auth login` to re-authenticate" |
| 403 | Permission | Report: "Insufficient permissions for this repo" |
| 404 | Not Found | Report: "Repository or PR not found" |
| 429 | Rate Limit | Exit with: "GitHub API rate limit exceeded. Wait and retry." |
| 5xx | Server | Report: "GitHub server error. Retry in a few minutes." |

### Agent Failures
- Use partial results: if any agent succeeds, aggregate its findings
- Failed agents listed in summary with error reason
- Only abort if zero agents succeed

### Git/Graphite Errors
| Error | Action |
|-------|--------|
| Dirty working directory | Error: "Uncommitted changes detected. Commit or stash first." |
| `gt submit` failure | Report error, suggest `gt stack` to diagnose |
| Merge conflict on restack | Abort restack, report to user for manual resolution |
| `gt track` failure | Warn and proceed with raw git (degraded mode) |

## Commit Conventions

### `/review:pr`
```
fix: address review findings from <agent-list>
```

### `/review:resolve`
```
fix: resolve PR #<num> review comments
```

### `/review:all`
Same per-PR messages as above, applied to each PR in sequence.

All commits via `gt modify -c -m "<message>"`. Push via `gt submit --no-interactive`.

## Graphite Integration

### Standard Operations
- **Commit**: `gt modify -c -m "fix: ..."`
- **Push**: `gt submit --no-interactive`
- **Restack**: `gt upstack restack` (abort on conflict, report to user)
- **Checkout**: `gt checkout <branch>`
- **View stack**: `gt log`

### Non-Graphite PR Adoption
1. `gh pr checkout <PR#>` to create local branch
2. `gt track` to adopt into Graphite
3. If `gt track` fails: warn and proceed with raw git (degraded mode)

## Cross-Plugin Agent References

To spawn cross-plugin agents from yellow-review commands, use the Task tool:

```
Task(subagent_type="compound-engineering:review:security-sentinel",
     prompt="Review these files for security issues: <file-list>")
```

Agent type names follow the pattern: `compound-engineering:review:<agent-name>`.

## GraphQL Scripts

Located at `skills/pr-review-workflow/scripts/`:

- **get-pr-comments** `<owner/repo> <pr-number>` — Returns JSON array of unresolved, non-outdated review threads
- **resolve-pr-thread** `<thread-node-id>` — Resolves a single thread (idempotent)

Both require `gh` and `jq` to be installed.

## Verification Loop

After resolving threads:
1. Wait 2 seconds
2. Re-fetch comments with `get-pr-comments`
3. If unresolved threads remain, retry up to 3 times
4. Unresolved threads after retries are reported as warnings
