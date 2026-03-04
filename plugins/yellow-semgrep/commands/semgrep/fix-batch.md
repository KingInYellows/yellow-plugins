---
name: semgrep:fix-batch
description: "Fix multiple 'to-fix' Semgrep findings with human approval between each fix. Use when user says 'fix all findings', 'batch fix', 'remediate everything', or wants to work through the to-fix queue."
argument-hint: '[--severity critical,high] [--max N] [--rule check-id]'
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Skill
  - AskUserQuestion
  - Task
  - mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
---

# Batch Fix Semgrep Findings

Iteratively fix multiple "to-fix" findings with human approval between each
fix. Uses the same per-finding workflow as `/semgrep:fix` but manages ordering,
progress tracking, and batch-level reporting.

**Reference:** Follow conventions in the `semgrep-conventions` skill. See
`fix-patterns` reference for batch ordering strategy.

## Workflow

### Step 1: Validate Prerequisites

Check `SEMGREP_APP_TOKEN` is set and valid. Detect deployment slug and repo
name per skill patterns.

### Step 2: Parse Arguments

Parse `$ARGUMENTS` for:

- **`--severity critical,high`:** Comma-separated severity filter
- **`--max N`:** Maximum findings to process (default: 10)
- **`--rule check-id`:** Filter to a specific rule ID

Validate `--max` is a positive integer, capped at 50.

### Step 3: Fetch All To-Fix Findings

Paginate through REST API to get all `fixing` findings:

```bash
SEMGREP_API="https://semgrep.dev/api/v1"
PAGE=0
ALL_FINDINGS="[]"

while true; do
  response=$(curl -s --connect-timeout 5 --max-time 30 \
    -w "\n%{http_code}" \
    -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
    "${SEMGREP_API}/deployments/${SLUG}/findings?triage_state=fixing&repos=${REPO_NAME}&dedup=true&page=${PAGE}&page_size=100")
  # Three-layer error check per skill
  # Append findings to ALL_FINDINGS
  # Break if findings array is empty
  PAGE=$((PAGE + 1))
  sleep 1  # Rate limiting
done
```

Apply `--severity` and `--rule` filters. Truncate to `--max`.

If zero findings after filtering: "No findings match the specified filters."

### Step 4: Order and Group

Per `fix-patterns` reference:

1. Group findings by file path
2. Within each file, sort by line number descending (fix bottom-up)
3. Between files, sort by severity (critical first)

### Step 5: Present Summary

```
Batch Fix Plan — {repo_name}
══════════════════════════════

{total} findings to process (max: {max}):

  File: src/auth/login.py
    [CRITICAL] #12345  dangerous-eval      line 42
    [HIGH]     #12346  sql-injection        line 78

  File: src/api/handler.js
    [HIGH]     #12350  xss-innerHTML        line 15

Proceed with batch fix?
```

AskUserQuestion: [Start batch] [Cancel]

### Step 6: Process Each Finding

For each finding, execute the per-finding workflow from `/semgrep:fix`:

1. Check file exists
2. Pre-fix scan (verify finding still present)
3. Check git state
4. Read context
5. Determine fix strategy (autofix → syntax check → LLM fallback)
6. Apply fix (with user approval)
7. Verify fix (spawn scan-verifier)
8. Update triage state
9. Commit

After each fix, present AskUserQuestion:
- "Finding {id} fixed. {remaining} remaining."
- Options: [Continue to next] [Skip next] [Abort batch]

**Same-file handling:** After fixing a finding in a file, if the next finding
is in the same file, re-run the pre-fix scan to get updated line numbers
(prior fixes may have shifted them).

**Rate limiting:** 1-second delay between REST API calls.

### Step 7: Batch Summary

After all findings are processed (or batch is aborted):

```
Batch Results — {repo_name}
════════════════════════════

  Fixed:     {n}
  Skipped:   {n}
  Failed:    {n}
  Aborted:   {n} (remaining when user stopped)

Fixed findings:
  #{id1}  {check_id}  {path}:{line}  autofix
  #{id2}  {check_id}  {path}:{line}  llm

Skipped findings:
  #{id3}  {reason}

{If any remaining:}
Run /semgrep:fix-batch to continue with remaining findings.
```

## Error Handling

| Condition | Action |
|---|---|
| Zero findings after filter | Report and exit |
| Network failure mid-batch | Report progress, suggest re-running |
| User aborts | Report progress, list remaining |
| Individual fix fails | Log failure, ask [Skip] [Abort batch] |
| Triage POST partial failure | Report per-finding, continue batch |
| Rate limit (429) | Wait 60s, retry once, continue |
