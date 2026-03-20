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

Conducts a systematic code quality audit of all uncommitted changes using
specialized agents, then creates a conventional commit and submits via Graphite.
Ensures no anti-patterns, secrets, or silent failures enter the codebase.

## Input

Optional arguments:

- `--amend` — Amend the current branch commit instead of creating a new branch
- `--dry-run` — Run the audit but skip the actual submission
- `--no-verify` — Skip the audit and submit directly (use with caution)

#$ARGUMENTS

## Phase 0: Read Convention File

Before any other work, check for a `.graphite.yml` convention file and parse
repo-level settings. Run a single Bash call:

```bash
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
GW_DRAFT=""
GW_MERGE_WHEN_READY=""
GW_RESTACK_BEFORE=""
GW_AUDIT_AGENTS=""
GW_SKIP_ON_DRAFT=""
GW_BRANCH_PREFIX=""

if command -v yq >/dev/null 2>&1 && \
   yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk' && \
   [ -f "$REPO_TOP/.graphite.yml" ]; then
  yq_err=""
  GW_DRAFT=$(yq -r '.submit.draft // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="submit.draft"
  GW_MERGE_WHEN_READY=$(yq -r '.submit.merge_when_ready // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="${yq_err:+$yq_err, }merge_when_ready"
  GW_RESTACK_BEFORE=$(yq -r '.submit.restack_before // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="${yq_err:+$yq_err, }restack_before"
  GW_AUDIT_AGENTS=$(yq -r '.audit.agents // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="${yq_err:+$yq_err, }audit.agents"
  GW_SKIP_ON_DRAFT=$(yq -r '.audit.skip_on_draft // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="${yq_err:+$yq_err, }skip_on_draft"
  GW_BRANCH_PREFIX=$(yq -r '.branch.prefix // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="${yq_err:+$yq_err, }branch.prefix"
  if [ -n "$yq_err" ]; then
    printf '[gt-workflow] Warning: yq failed to parse fields: %s. Using defaults for those.\n' "$yq_err" >&2
  else
    printf '[gt-workflow] Convention file loaded: %s/.graphite.yml\n' "$REPO_TOP" >&2
  fi
elif [ -f "$REPO_TOP/.graphite.yml" ]; then
  printf '[gt-workflow] Warning: .graphite.yml exists but yq (kislyuk) is not installed. Using defaults.\n' >&2
  printf '[gt-workflow] Install yq: pip install yq\n' >&2
fi

# Validate and clamp audit.agents to 1-3 range
if [ -n "$GW_AUDIT_AGENTS" ]; then
  case "$GW_AUDIT_AGENTS" in
    *[!0-9]*) printf '[gt-workflow] Warning: audit.agents value "%s" is not an integer. Using default 3.\n' "$GW_AUDIT_AGENTS" >&2; GW_AUDIT_AGENTS=3 ;;
  esac
  if [ "$GW_AUDIT_AGENTS" -lt 1 ] 2>/dev/null; then
    printf '[gt-workflow] Warning: audit.agents=%s is below minimum. Using 1.\n' "$GW_AUDIT_AGENTS" >&2
    GW_AUDIT_AGENTS=1
  elif [ "$GW_AUDIT_AGENTS" -gt 3 ] 2>/dev/null; then
    printf '[gt-workflow] Warning: audit.agents=%s exceeds maximum. Using 3.\n' "$GW_AUDIT_AGENTS" >&2
    GW_AUDIT_AGENTS=3
  fi
fi

# Validate branch.prefix against allow-list
if [ -n "$GW_BRANCH_PREFIX" ]; then
  if ! printf '%s' "$GW_BRANCH_PREFIX" | grep -qE '^[a-z0-9][a-z0-9/_-]*$'; then
    printf '[gt-workflow] Error: branch.prefix "%s" contains invalid characters. Using empty prefix.\n' "$GW_BRANCH_PREFIX" >&2
    GW_BRANCH_PREFIX=""
  fi
fi
```

Store these values for use in subsequent phases. When a value is empty, use the
hardcoded default (draft=false, merge_when_ready=false, restack_before=true,
audit_agents=3, skip_on_draft=false, branch_prefix="").

## Phase 1: Understand Current State

### 1. Check for Changes

Run these commands in parallel to understand the working tree and stack
position:

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

- If `current == trunk` → will use `gt create <branch-name> -m "message"` to
  create a new branch
- If `current != trunk` → will use `gt modify -m "message"` to update the
  current branch
- If `--amend` argument was passed and on a feature branch → will use
  `gt commit amend` instead

## Phase 2: Audit (skip if `--no-verify`)

**Skip-on-draft check:** If `$GW_SKIP_ON_DRAFT` is `true` and `$GW_DRAFT` is
`true` (from `.graphite.yml`), skip the entire audit phase and proceed to
Phase 3.

### 0. Capture the Diff Once

Before spawning auditors, capture the full diff so all agents can use it
without redundant calls:

```bash
git diff
```

Store this output as `$DIFF_OUTPUT` (pass it as context to each agent below).

### 1. Spawn Parallel Auditors

Determine the number of audit agents to spawn: use `$GW_AUDIT_AGENTS` if set
(1-3), otherwise default to 3. If the count is 1, spawn only
**quick-code-review**. If 2, spawn **quick-code-review** and
**quick-security-scan**. If 3, spawn all three.

Use the Task tool to launch agents in parallel in a **single message**, passing
`$DIFF_OUTPUT` as context to each:

**quick-code-review** (subagent_type: `general-purpose`):

> Analyze the following uncommitted diff for:
>
> 1. Mock/stub code in production paths
> 2. Placeholder or TODO implementations that shouldn't be committed
> 3. Commented-out code blocks
> 4. Obvious logic errors
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Report findings as a list with file:line references. If nothing found, say
> "CLEAN".

**quick-security-scan** (subagent_type: `general-purpose`):

> Scan the following uncommitted diff for:
>
> 1. Hardcoded credentials, API keys, tokens, or secrets
> 2. Private keys or certificates
> 3. PII exposure (emails, passwords in plaintext)
> 4. .env files or sensitive config being committed
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Be extremely strict. Report findings with file:line references. If nothing
> found, say "CLEAN".

**quick-error-check** (subagent_type: `general-purpose`):

> Analyze the following uncommitted diff for:
>
> 1. Empty catch/except blocks
> 2. Swallowed errors (caught but not logged or re-thrown)
> 3. Fallback values without logging
> 4. Missing error boundaries or error handling
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Report findings with file:line references. If nothing found, say "CLEAN".

### 2. Gate Check

First, verify all spawned agents completed successfully. If any agent failed to
run or timed out, inform the user which audit is missing and ask whether to
proceed with partial results or abort.

Synthesize findings from all spawned agents.

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

**IMPORTANT**: Do NOT use `git add .` or `git add -A`. Instead, stage only the
specific changed files to avoid accidentally committing secrets, binaries, or
unrelated files.

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

The message should be concise (under 72 chars for the subject line). Include a
body if the changes are complex.

### 3. Create Commit via Graphite

**If on trunk** (creating new branch):

Derive the branch name from the commit type and a short slug (e.g.,
`feat/add-user-auth`, `fix/null-pointer-crash`). If `$GW_BRANCH_PREFIX` is set,
prepend it to the branch name:

```bash
gt create "<GW_BRANCH_PREFIX><branch-name>" -m "<conventional commit message>"
```

For example, with `branch.prefix: "agent/"` and slug `feat/add-user-auth`, the
branch name becomes `agent/feat/add-user-auth`.

**If on feature branch** (adding to existing):

```bash
gt modify -m "<conventional commit message>"
```

**If `--amend`** (modifying current branch):

```bash
gt commit amend -m "<conventional commit message>"
```

## Phase 4: Submit

### 1. Push to GitHub

If `--dry-run` was provided, skip this step and do not run `gt submit`; instead,
only simulate the submission and proceed to the result summary without making
any remote changes.

Build the submit command with convention file flags. First, if `$GW_RESTACK_BEFORE`
is `true`, run restack as a **separate preceding command**:

```bash
gt stack restack
```

Then submit with flags based on `.graphite.yml` values:

```bash
gt submit --no-interactive
```

Append flags to the submit command (only if set and non-empty):
- If `$GW_DRAFT` is `true` (and no explicit `--publish` argument): add `--draft`
- If `$GW_MERGE_WHEN_READY` is `true`: add `--merge-when-ready`

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

- All uncommitted code audited by 1-3 specialized agents (unless `--no-verify`)
- No critical issues committed
- Files staged individually (no blanket `git add .`)
- Conventional commit message generated from diff analysis
- Graphite stack created/updated and submitted (or a dry-run summary produced
  when `--dry-run` is used)
- User provided with PR link and stack context
