---
name: workflows:review
description:
  Multi-agent comprehensive code review with security, performance, and
  architecture analysis
argument-hint: '[PR number/URL/branch/latest]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Comprehensive Code Review Workflow

Execute multi-agent code review with parallel analysis from security,
performance, architecture, and code quality perspectives.

## Phase 1: Determine Review Target

**Objective:** Identify and fetch the code to review.

1. Parse `#$ARGUMENTS` to determine review target:
   - **PR number:** `123` → Fetch PR #123
   - **GitHub URL:** `https://github.com/org/repo/pull/123` → Extract PR number
   - **Branch name:** `feature-x` → Review branch against main
   - **"latest":** Review current branch or most recent PR
   - **Empty/none:** Review current working changes

2. Check current branch and status:

   ```bash
   git branch --show-current
   git status --short
   ```

3. Fetch PR metadata if reviewing a PR:

   ```bash
   gh pr view <number> --json number,title,body,headRefName,baseRefName,author,additions,deletions,files
   ```

4. Get file changes:

   ```bash
   # For PR
   gh pr diff <number>
   # For branch
   git diff main...feature-branch
   # For working changes
   git diff HEAD
   ```

5. Get list of changed files:

   ```bash
   gh pr view <number> --json files --jq '.files[].path'
   ```

6. If not on target branch, offer worktree or read-only review via
   AskUserQuestion.

7. Read each changed file into context.

## Phase 2: Parallel Agent Review

Launch ALL reviewer agents in parallel using Task tool:

- **polyglot-reviewer** — Language-specific best practices, idioms, type safety
- **code-simplicity-reviewer** — Complexity, simplifications, readability
- **security-sentinel** — Security vulnerabilities, unsafe patterns, injection
  risks
- **performance-oracle** — Performance issues, inefficiencies, scaling concerns
- **architecture-strategist** — Architectural fit, coupling, cohesion, design
  patterns
- **test-coverage-analyst** — Test coverage, quality, edge cases, brittleness
- **git-history-analyzer** — Commit structure, messages, atomic changes

Wait for all agents to complete. Collect findings by agent with severity levels
and file locations.

## Phase 3: Deep Analysis

Apply additional analysis beyond what agents cover:

1. **Stakeholder Perspectives:**
   - Developer experience (readability, maintainability, API clarity)
   - Operations (deployment, monitoring, rollback)
   - End user impact (performance, error handling, backwards compatibility)

2. **Scenario Exploration:**
   - Happy path, invalid inputs, edge cases
   - Concurrency and race conditions
   - Scale and failure modes

3. **Cross-Cutting Concerns:**
   - Logging, metrics, configuration, feature flags, documentation

## Phase 4: Synthesis

1. **Categorize findings by severity:**
   - **P1 CRITICAL:** Blocks merge (security vulnerabilities, data corruption,
     breaking changes, critical bugs)
   - **P2 IMPORTANT:** Should fix (performance issues, test gaps, design
     violations, poor error handling)
   - **P3 NICE-TO-HAVE:** Can address later (minor optimizations, style, docs,
     refactoring)

2. **Deduplicate** findings from multiple agents. Keep most detailed
   explanation.

3. **Estimate effort** for each finding: Quick (<30 min), Medium (30 min–2 hr),
   Large (>2 hr).

4. **Present summary** with:
   - Overview table (total findings, P1/P2/P3 counts)
   - Each finding: severity, type, file:line, agent source, issue description,
     suggested fix, effort
   - Architecture observations and testing assessment
   - What went well (balance criticism with recognition)

5. **Ask next steps** via AskUserQuestion:
   - Address P1 issues immediately
   - Discuss specific findings
   - Create follow-up issues for P2/P3 items
   - Export review as PR comment

## Guidelines

- Run agents in parallel for efficiency
- Be specific: include file paths, line numbers, code examples
- Suggest fixes, don't just identify problems
- Estimate effort to help prioritize
- Be constructive: balance criticism with recognition of good work
- Guide next steps: make it clear what actions are needed
