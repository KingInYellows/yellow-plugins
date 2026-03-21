---
name: gt-amend
description:
  'Amend the current branch commit: audit changes, update the commit, and
  re-submit via Graphite'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Quick Amend

A fast path for the most common solo-dev operation: auditing your latest fix and
folding it into the current branch commit via `gt commit amend`.

## Input

Optional arguments:

- `--no-verify` — Skip the audit and amend directly (use with caution)
- `--no-submit` — Amend the commit locally but do not push to GitHub
- `--publish` — Override draft mode: submit as published even if
  `submit.draft: true` in `.graphite.yml`

#$ARGUMENTS

## Phase 0: Read Convention File

Check for a `.graphite.yml` convention file and parse audit settings. Run:

```bash
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
GW_AUDIT_AGENTS=""
GW_SKIP_ON_DRAFT=""
GW_DRAFT=""

if command -v yq >/dev/null 2>&1 && \
   yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk' && \
   [ -f "$REPO_TOP/.graphite.yml" ]; then
  yq_err=""
  GW_AUDIT_AGENTS=$(yq -r '.audit.agents // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="audit.agents"
  GW_SKIP_ON_DRAFT=$(yq -r '.audit.skip_on_draft // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="${yq_err:+$yq_err, }skip_on_draft"
  GW_DRAFT=$(yq -r '.submit.draft // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null) || yq_err="${yq_err:+$yq_err, }submit.draft"
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
```

Store these values for use in Phase 2. Default: 3 agents, skip_on_draft=false.

## Phase 1: Understand Current State

Run these commands to confirm there are changes to amend and that we are on a
feature branch:

```bash
git status --short
git diff --stat
git branch --show-current
gt trunk
gt log short
```

**Guard checks:**

- If there are **no uncommitted changes**, tell the user and exit — there is
  nothing to amend.
- If the current branch **equals trunk**, warn the user: amending trunk is
  dangerous. Use `AskUserQuestion` to confirm before proceeding.

## Phase 2: Audit (skip if `--no-verify`)

**Skip-on-draft check:** If `$GW_SKIP_ON_DRAFT` is `true` and `$GW_DRAFT` is
`true` (from `.graphite.yml`), skip the entire audit phase and proceed to
Phase 3. This matches the same logic used in `/smart-submit`.

> **Note:** `$GW_DRAFT` reflects the `submit.draft` flag in `.graphite.yml` (the
> repo-level config intent for _new_ submits), **not** the live PR draft state.
> A PR that has already been promoted out of draft will still trigger the skip
> if `submit.draft: true` is set in the config. This is intentional — performing
> a `gh pr view --json isDraft` lookup on every amend would add a network
> roundtrip. If you need audit enforcement, do not use `--no-verify` because it
> bypasses checks entirely. Instead, keep `audit.skip_on_draft: false` or set
> `submit.draft: false` in repo config so the amend path never skips audit
> because of draft-mode config.

### 0. Capture the Diff Once

```bash
git diff
```

Store this output as `$DIFF_OUTPUT` and pass it to each audit agent below.

### 1. Spawn Parallel Auditors

Determine the number of audit agents to spawn: use `$GW_AUDIT_AGENTS` if set
(1-3), otherwise default to 3. If the count is 1, spawn only
**quick-code-review**. If 2, spawn **quick-code-review** and
**quick-security-scan**. If 3, spawn all three.

Use the Task tool to launch agents in parallel in a **single message**:

**quick-code-review** (subagent_type: `general-purpose`):

> Analyze the following diff for mock/stub code, unfinished TODOs, commented-out
> blocks, or obvious logic errors.
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Report file:line findings. If nothing found, say "CLEAN".

**quick-security-scan** (subagent_type: `general-purpose`):

> Scan the following diff for hardcoded credentials, API keys, tokens, private
> keys, PII, or sensitive config files.
>
> Diff:
>
> ```
> $DIFF_OUTPUT
> ```
>
> Be extremely strict. Report file:line findings. If nothing found, say "CLEAN".

**quick-error-check** (subagent_type: `general-purpose`):

> Analyze the following diff for empty catch blocks, swallowed errors, fallback
> values without logging, or missing error boundaries.
>
> Diff:
>
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

If the user wants to update the commit message too, ask via `AskUserQuestion`:
"Update the commit message? (leave blank to keep current)". If they provide one:

```bash
gt commit amend -m "<new message>"
```

## Phase 4: Re-submit

Skip this phase if `--no-submit` was passed — report the amended state and exit.

Build the submit command with convention file flags:

```bash
gt submit --no-interactive
```

Append flags to the submit command (only if set and non-empty):

- If `$GW_DRAFT` is `true` (and no explicit `--publish` argument): add `--draft`

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
