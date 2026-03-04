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

- **`--severity high,critical`:** Comma-separated severity filter (allowed
  values: `critical`, `high`, `medium`, `low` — reject unknown values)
- **`--repo org/name`:** Override auto-detected repository name (validate format:
  `^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$`)

If no `--repo` specified, auto-detect from git remote. See
`semgrep-conventions` skill for `repo_name_extraction` pattern.

### Step 3: Detect Deployment Slug

Hit `GET /api/v1/deployments` to get the deployment slug. Use the first
deployment if only one exists.

### Step 4: Fetch Findings by Triage State

For each triage state (`open`, `reviewing`, `fixing`, `ignored`, `fixed`),
fetch one page with `page_size=100` and count the `findings` array length.
Use `dedup=true`. The API does not return a total count field — use the
array length as the count (approximate for states with >100 findings).

```bash
SEMGREP_API="https://semgrep.dev/api/v1"

for state in open reviewing fixing ignored fixed; do
  response=$(curl -s --connect-timeout 5 --max-time 15 \
    -w "\n%{http_code}" \
    -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
    "${SEMGREP_API}/deployments/${SLUG}/findings?triage_state=${state}&repos=${REPO_NAME}&dedup=true&page=0&page_size=100")
  # Three-layer error check per skill
  # Count: jq '.findings | length' — append "+" if count == 100 (more pages exist)
done
```

### Step 5: Fetch To-Fix Details

Paginate through all `fixing` findings to build the severity breakdown and
top rules table:

```bash
PAGE=0
ALL_FINDINGS="[]"
MAX_PAGES=100
while [ "$PAGE" -lt "$MAX_PAGES" ]; do
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
