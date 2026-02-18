---
name: smart-submit
description: "Stage, audit, commit, and submit changes via Graphite with parallel code review agents"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Smart Submit (Graphite Edition)

Conducts a systematic code quality audit of all uncommitted changes using specialized agents, then creates a conventional commit and submits via Graphite. Ensures no anti-patterns, secrets, or silent failures enter the codebase.

## Input

Optional arguments:
- `--amend` — Amend the current branch commit instead of creating a new branch
- `--dry-run` — Run the audit but skip the actual submission
- `--no-verify` — Skip the audit and submit directly (use with caution)

#$ARGUMENTS

## Phase 1: Understand Current State

### 1. Check for Changes

Run these commands in parallel to understand the working tree and stack position:

```bash
git status --short
```

```bash
git diff --stat
```

```bash
gt log short
```

```bash
gt trunk
```

If there are no uncommitted changes, tell the user and exit.

### 2. Determine Branch Context

Check whether the current branch is trunk or a feature branch:

```bash
current=$(git branch --show-current)
trunk=$(gt trunk)
echo "current=$current trunk=$trunk"
```

- If `current == trunk` → will use `gt create <branch-name> -m "message"` to create a new branch
- If `current != trunk` → will use `gt commit create -m "message"` to add to the current branch
- If `--amend` argument was passed and on a feature branch → will use `gt commit amend` instead

## Phase 2: Audit (skip if `--no-verify`)

### 0. Capture the Diff Once

Before spawning auditors, capture the full diff so all three agents can use it without redundant calls:

```bash
git diff
```

Store this output as `$DIFF_OUTPUT` (pass it as context to each agent below).

### 1. Spawn Parallel Auditors

Use the Task tool to launch all three agents in parallel in a **single message**, passing `$DIFF_OUTPUT` as context to each:

**code-reviewer** (subagent_type: `general-purpose`):
> Analyze the following uncommitted diff for:
> 1. Mock/stub code in production paths
> 2. Placeholder or TODO implementations that shouldn't be committed
> 3. Commented-out code blocks
> 4. Obvious logic errors
>
> Diff:
> ```
> $DIFF_OUTPUT
> ```
>
> Report findings as a list with file:line references. If nothing found, say "CLEAN".

**security-sentinel** (subagent_type: `general-purpose`):
> Scan the following uncommitted diff for:
> 1. Hardcoded credentials, API keys, tokens, or secrets
> 2. Private keys or certificates
> 3. PII exposure (emails, passwords in plaintext)
> 4. .env files or sensitive config being committed
>
> Diff:
> ```
> $DIFF_OUTPUT
> ```
>
> Be extremely strict. Report findings with file:line references. If nothing found, say "CLEAN".

**silent-failure-hunter** (subagent_type: `general-purpose`):
> Analyze the following uncommitted diff for:
> 1. Empty catch/except blocks
> 2. Swallowed errors (caught but not logged or re-thrown)
> 3. Fallback values without logging
> 4. Missing error boundaries or error handling
>
> Diff:
> ```
> $DIFF_OUTPUT
> ```
>
> Report findings with file:line references. If nothing found, say "CLEAN".

### 2. Gate Check

First, verify all three agents completed successfully. If any agent failed to run or timed out, inform the user which audit is missing and ask whether to proceed with partial results or abort.

Synthesize findings from all three agents.

**IF CRITICAL ISSUES** (secrets, production mocks, silent failures):
1. Display blocking issues with file:line references
2. Use AskUserQuestion to ask:
   - "Fix issues before submitting (Recommended)"
   - "Submit anyway"
   - "Abort"
3. If "Fix issues" → stop and let the user fix them
4. If "Abort" → stop entirely

**IF MINOR ISSUES** (TODOs, style, minor logic):
1. Display warnings
2. Proceed but note them in the output

**IF CLEAN**: Proceed automatically.

## Phase 3: Stage & Commit

### 1. Stage Specific Files

**IMPORTANT**: Do NOT use `git add .` or `git add -A`. Instead, stage only the specific changed files to avoid accidentally committing secrets, binaries, or unrelated files.

```bash
# Get the list of changed/untracked files
git diff --name-only
git ls-files --others --exclude-standard
```

Review the file list. Exclude any files that look like:
- `.env*` files
- Credential/key files
- Large binaries
- Build artifacts

Stage the appropriate files by name:
```bash
git add -- "<file1>" "<file2>"
```

### 2. Generate Conventional Commit Message

Analyze the staged diff to determine the commit type and scope:

```bash
git diff --cached --stat
git diff --cached
```

Generate a conventional commit message following this format:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring
- `docs:` — documentation changes
- `test:` — test additions/changes
- `chore:` — maintenance, config, dependencies

The message should be concise (under 72 chars for the subject line). Include a body if the changes are complex.

### 3. Create Commit via Graphite

**If on trunk** (creating new branch):
```bash
gt create "<branch-name>" -m "<conventional commit message>"
```
The branch name should be derived from the commit type and a short slug (e.g., `feat/add-user-auth`, `fix/null-pointer-crash`).

**If on feature branch** (adding to existing):
```bash
gt commit create -m "<conventional commit message>"
```

**If `--amend`** (modifying current branch):
```bash
gt commit amend -m "<conventional commit message>"
```

## Phase 4: Submit

### 1. Push to GitHub

If `--dry-run` was provided, skip this step and do not run `gt submit`; instead, only simulate the submission and proceed to the result summary without making any remote changes.

```bash
gt submit --no-interactive
```

After submitting, confirm the new stack state:

```bash
gt log short
```

```bash
gt pr
```

Output a summary:
- Commit message used
- Branch created/amended
- PR link
- Stack visualization
- Any audit warnings that were noted

## Success Criteria

- All uncommitted code audited by 3 specialized agents (unless `--no-verify`)
- No critical issues committed
- Files staged individually (no blanket `git add .`)
- Conventional commit message generated from diff analysis
- Graphite stack created/updated and submitted (or a dry-run summary produced when `--dry-run` is used)
- User provided with PR link and stack context
