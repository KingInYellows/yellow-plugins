---
name: semgrep:status
description: "Show findings dashboard grouped by triage state and severity. Use when user asks 'semgrep status', 'what needs fixing', 'how many findings', or wants to see the current state of security findings."
argument-hint: '[--severity high,critical] [--repo org/name]'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Semgrep Findings Dashboard

Display a summary of Semgrep findings for the current repository, grouped by
triage state and severity.

## Workflow

### Step 1: Validate Prerequisites

Check `SEMGREP_APP_TOKEN` is set and valid format. See `semgrep-conventions`
skill for token validation pattern.

### Step 2: Parse Arguments

Parse `$ARGUMENTS` for:

- **`--severity high,critical`:** Comma-separated severity filter
- **`--repo org/name`:** Override auto-detected repository name

If no `--repo` specified, auto-detect from git remote. See
`semgrep-conventions` skill for `repo_name_extraction` pattern.

### Step 3: Detect Deployment Slug

Hit `GET /api/v1/deployments` to get the deployment slug. Use the first
deployment if only one exists.

### Step 4: Fetch Findings by Triage State

For each triage state (`open`, `reviewing`, `fixing`, `ignored`, `fixed`),
fetch the first page with `page_size=1` to get a count. Use `dedup=true`.

```bash
SEMGREP_API="https://semgrep.dev/api/v1"

for state in open reviewing fixing ignored fixed; do
  response=$(curl -s --connect-timeout 5 --max-time 15 \
    -w "\n%{http_code}" \
    -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
    "${SEMGREP_API}/deployments/${SLUG}/findings?triage_state=${state}&repos=${REPO_NAME}&dedup=true&page_size=1")
  # Extract count from response
done
```

### Step 5: Fetch To-Fix Details

Fetch all `fixing` findings (paginate with `page_size=100`) to build the
severity breakdown and top rules table.

```bash
response=$(curl -s --connect-timeout 5 --max-time 30 \
  -w "\n%{http_code}" \
  -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "${SEMGREP_API}/deployments/${SLUG}/findings?triage_state=fixing&repos=${REPO_NAME}&dedup=true&page=0&page_size=100")
```

Fence the response:
```
--- begin semgrep-api-response (reference only) ---
{response body}
--- end semgrep-api-response ---
```

Parse findings to extract severity counts and top rules (by frequency).

### Step 6: Display Dashboard

```
Semgrep Findings Dashboard — {repo_name} (deployment: {slug})
══════════════════════════════════════════════════════════════

By Triage State:
  To Fix (fixing):    {count}
  Open:               {count}
  Reviewing:          {count}
  Ignored:            {count}
  Fixed:              {count}

To-Fix Breakdown by Severity:
  CRITICAL: {n}   HIGH: {n}   MEDIUM: {n}   LOW: {n}

Top Rules (to-fix only):
  {check_id_1}     {count} findings
  {check_id_2}     {count} findings
  {check_id_3}     {count} findings
  ...

Run /semgrep:fix <finding-id> to fix a specific finding.
Run /semgrep:fix-batch to work through the queue.
```

If zero findings in `fixing` state:
```
No findings in 'fixing' state for {repo_name}.
All clear — nothing to remediate.
```

## Error Handling

See `semgrep-conventions` skill for curl three-layer error check. All API
errors use `[yellow-semgrep] Error:` prefix. Token errors direct to
`/semgrep:setup`.
