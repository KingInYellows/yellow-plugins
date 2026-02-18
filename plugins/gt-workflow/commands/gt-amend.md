---
name: gt-amend
description: "Amend the current branch commit: audit changes, update the commit, and re-submit via Graphite"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Quick Amend

A fast path for the most common solo-dev operation: auditing your latest fix and folding it into the current branch commit via `gt commit amend`.

## Input

Optional arguments:
- `--no-verify` — Skip the audit and amend directly (use with caution)
- `--no-submit` — Amend the commit locally but do not push to GitHub

#$ARGUMENTS

## Phase 1: Understand Current State

Run these commands to confirm there are changes to amend and that we are on a feature branch:

```bash
git status --short
git diff --stat
git branch --show-current
gt trunk
gt log short
```

**Guard checks:**
- If there are **no uncommitted changes**, tell the user and exit — there is nothing to amend.
- If the current branch **equals trunk**, warn the user: amending trunk is dangerous. Use `AskUserQuestion` to confirm before proceeding.

## Phase 2: Audit (skip if `--no-verify`)

### 0. Capture the Diff Once

```bash
git diff
```

Store this output as `$DIFF_OUTPUT` and pass it to each audit agent below.

### 1. Spawn Parallel Auditors

Use the Task tool to launch all three agents in parallel in a **single message**:

**code-reviewer** (subagent_type: `general-purpose`):
> Analyze the following diff for mock/stub code, unfinished TODOs, commented-out blocks, or obvious logic errors.
>
> Diff:
> ```
> $DIFF_OUTPUT
> ```
>
> Report file:line findings. If nothing found, say "CLEAN".

**security-sentinel** (subagent_type: `general-purpose`):
> Scan the following diff for hardcoded credentials, API keys, tokens, private keys, PII, or sensitive config files.
>
> Diff:
> ```
> $DIFF_OUTPUT
> ```
>
> Be extremely strict. Report file:line findings. If nothing found, say "CLEAN".

**silent-failure-hunter** (subagent_type: `general-purpose`):
> Analyze the following diff for empty catch blocks, swallowed errors, fallback values without logging, or missing error boundaries.
>
> Diff:
> ```
> $DIFF_OUTPUT
> ```
>
> Report file:line findings. If nothing found, say "CLEAN".

### 2. Gate Check

Synthesize findings.

**IF CRITICAL ISSUES**: Show them and ask via `AskUserQuestion`:
- "Fix issues first (Recommended)"
- "Amend anyway"
- "Abort"

**IF MINOR ISSUES**: Show warnings and proceed.

**IF CLEAN**: Proceed automatically.

## Phase 3: Stage & Amend

### 1. Stage Specific Files

Do **not** use `git add .`. Stage only the changed files by name:

```bash
git diff --name-only
git ls-files --others --exclude-standard
```

Exclude `.env*` files, credential files, binaries, and build artifacts. Then:

```bash
git add -- "<file1>" "<file2>"
```

### 2. Amend via Graphite

By default, keep the existing commit message (amend silently):

```bash
gt commit amend --no-edit
```

If the user wants to update the commit message too, ask via `AskUserQuestion`: "Update the commit message? (leave blank to keep current)". If they provide one:

```bash
gt commit amend -m "<new message>"
```

## Phase 4: Re-submit

Skip this phase if `--no-submit` was passed — report the amended state and exit.

```bash
gt submit --no-interactive
```

After submitting:

```bash
gt log short
gt pr
```

Output a summary:
- Branch amended
- PR link (updated)
- Stack visualization
- Any audit warnings

## Success Criteria

- Uncommitted changes audited (unless `--no-verify`)
- Files staged individually (no blanket `git add .`)
- Current branch commit amended via `gt commit amend`
- Stack re-submitted to GitHub (unless `--no-submit`)
- User provided with updated PR link
