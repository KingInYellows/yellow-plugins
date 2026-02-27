---
name: ci:diagnose
description: Diagnose CI failure and suggest fixes. Use when user wants to analyze a failed GitHub Actions run, understand why CI broke, or get actionable fix suggestions.
argument-hint: '[run-id] [--repo owner/name]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Task
model: sonnet
---

<!--
Usage: /ci:diagnose [run-id]
       /ci:diagnose --repo owner/name
Examples:
  /ci:diagnose                    # Latest failure
  /ci:diagnose 123456789          # Specific run
  /ci:diagnose --repo user/repo   # Override repo

Requires: gh CLI authenticated (gh auth status)
-->

# Diagnose CI Failure

## Step 1: Validate Prerequisites

Check GitHub CLI authentication:

```bash
gh auth status 2>&1 | head -n 3
```

If not authenticated, report error:

> GitHub CLI not authenticated. Run: `gh auth login`

Check repository context:

```bash
git remote get-url origin 2>&1 | grep -o '[^:/]*\/[^/]*\.git$' | sed 's/\.git$//' || echo "NO_REMOTE"
```

If no remote found, report error:

> Not in a Git repository with a GitHub remote. Navigate to your project root.

## Step 2: Resolve Run ID

If `$ARGUMENTS` contains a run ID (digits only):

- Validate: must match `^[1-9][0-9]{0,19}$` (no leading zeros,
  max 9007199254740991)
- If invalid, report: "Invalid run ID. Must be a positive integer (e.g.,
  123456789)"

If `$ARGUMENTS` contains `--repo`:

- Extract owner/repo from arguments
- Validate format: must contain exactly one `/`, alphanumeric + hyphens + dots

If no arguments:

- Fetch latest failed run:

```bash
gh run list --status failure --limit 1 --json databaseId,displayTitle,headBranch,conclusion -q '.[0]'
```

- If no failed runs found, report:
  > No recent CI failures found. Use `/ci:status` to see recent runs.

## Step 3: Fetch Run Details

```bash
gh run view "$RUN_ID" --json status,conclusion,jobs,headBranch,displayTitle,url,createdAt
```

If run is still in progress:

> Run $RUN_ID is still in progress. Wait for completion or use `/ci:status` to
> monitor.

If run succeeded:

> Run $RUN_ID succeeded. No failure to diagnose.

## Step 4: Launch Failure Analyst

Use the Task tool to spawn the `failure-analyst` agent with context:

- Run ID
- Run URL
- Branch name
- Failed job names

The failure-analyst agent handles log fetching, pattern matching, redaction, and
generating the diagnosis report.

## Error Handling

If `gh` command fails with rate limit (HTTP 429):

> GitHub API rate limited. Resets at [time from `gh api rate_limit`]. Wait or
> use a different token.

If `gh` command fails with auth error:

> GitHub CLI authentication expired. Run: `gh auth login`

If run not found (404):

> Run $RUN_ID not found. Verify the ID with `/ci:status` or check the GitHub
> Actions tab.
