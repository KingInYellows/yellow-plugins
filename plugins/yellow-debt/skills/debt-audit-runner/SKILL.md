# Technical Debt Audit Runner API

## What It Does

Programmatic API for agents to trigger technical debt audits with custom parameters and receive structured results. Enables cross-plugin integration where other plugins can initiate scans as part of larger workflows.

## When to Use

- When building agents that need to run audits as part of workflows
- When cross-plugin integrations need to trigger scans
- When implementing automated audit schedules
- When agents need to assess codebase health before actions

## Usage

### Run Full Audit

```bash
# Trigger full codebase audit
debt-audit-runner --format json

# Returns:
{
  "status": "success",
  "audit_date": "2026-02-13",
  "total_findings": 23,
  "scanners": {
    "ai-patterns": "success",
    "complexity": "success",
    "duplication": "failed",
    "architecture": "success",
    "security": "success"
  },
  "outputs": {
    "report": "docs/audits/2026-02-13-audit-report.md",
    "todos": "todos/debt/001-pending-*.md"
  }
}
```

### Run Targeted Audit

```bash
# Audit specific directory
debt-audit-runner --path src/services --format json

# Audit for specific category only
debt-audit-runner --category complexity --format json

# Audit with severity filter
debt-audit-runner --severity high --format json
```

### Wait for Completion

```bash
# Block until audit completes
debt-audit-runner --wait --format json

# Async mode (default) returns immediately
debt-audit-runner --async --format json
```

## Output Format

### Success Response

```json
{
  "status": "success",
  "audit_id": "audit-2026-02-13-10-30-00",
  "audit_date": "2026-02-13T10:30:00Z",
  "total_findings": 23,
  "scanners": {
    "ai-patterns": {
      "status": "success",
      "findings": 4,
      "duration_seconds": 45
    },
    "complexity": {
      "status": "success",
      "findings": 8,
      "duration_seconds": 62
    },
    "duplication": {
      "status": "failed",
      "error": "timeout",
      "duration_seconds": 300
    },
    "architecture": {
      "status": "success",
      "findings": 5,
      "duration_seconds": 38
    },
    "security": {
      "status": "success",
      "findings": 7,
      "duration_seconds": 51
    }
  },
  "summary": {
    "critical": 5,
    "high": 8,
    "medium": 7,
    "low": 3
  },
  "outputs": {
    "report": "docs/audits/2026-02-13-audit-report.md",
    "todos_generated": 23,
    "todos_path": "todos/debt/"
  }
}
```

### Partial Success Response

```json
{
  "status": "partial",
  "audit_id": "audit-2026-02-13-10-30-00",
  "warnings": [
    "Scanner 'duplication' failed (timeout)",
    "Results incomplete for duplication category"
  ],
  "total_findings": 19,
  "scanners": { ... }
}
```

### Failure Response

```json
{
  "status": "error",
  "error": "All scanners failed",
  "details": "File enumeration failed: path not tracked by git"
}
```

## Implementation

The audit runner API invokes `/debt:audit` command programmatically:

```bash
#!/usr/bin/env bash

# Parse arguments
PATH_FILTER="${1:-.}"
CATEGORY_FILTER=""
SEVERITY_FILTER=""
WAIT_MODE=false
FORMAT="json"

# Execute audit command
if [ "$WAIT_MODE" = true ]; then
  # Blocking mode: wait for all scanners + synthesis
  /debt:audit "$PATH_FILTER" \
    ${CATEGORY_FILTER:+--category "$CATEGORY_FILTER"} \
    ${SEVERITY_FILTER:+--severity "$SEVERITY_FILTER"}

  # Parse results and return JSON
  synthesize_results
else
  # Async mode: launch scanners and return immediately
  /debt:audit "$PATH_FILTER" \
    ${CATEGORY_FILTER:+--category "$CATEGORY_FILTER"} \
    ${SEVERITY_FILTER:+--severity "$SEVERITY_FILTER"} &

  AUDIT_PID=$!

  # Return audit ID and status
  echo '{"status":"in_progress","audit_pid":'$AUDIT_PID',"audit_id":"audit-'$(date +%Y-%m-%d-%H-%M-%S)'"}'
fi
```

## Example Use Cases

### Cross-Plugin Integration: yellow-review

```markdown
# In yellow-review after PR merge

Run audit on changed files to detect new technical debt introduced by PR:

```bash
# Get list of changed files
changed_files=$(git diff --name-only origin/main...HEAD)

# Run targeted audit
for file in $changed_files; do
  file_dir=$(dirname "$file")

  debt-audit-runner --path "$file_dir" --wait --format json > pr-debt-report.json

  # Compare with pre-merge baseline
  new_findings=$(jq '.total_findings' pr-debt-report.json)

  if [ "$new_findings" -gt 0 ]; then
    echo "⚠️  PR introduced $new_findings new technical debt finding(s)"
    echo "Run /debt:triage to review"
  fi
done
```
```

### Automated Nightly Scan

```markdown
# Scheduled audit via cron or GitHub Actions

```bash
#!/bin/bash
# Run nightly technical debt audit

debt-audit-runner --wait --format json > nightly-audit.json

# Extract summary
total=$(jq '.total_findings' nightly-audit.json)
critical=$(jq '.summary.critical' nightly-audit.json)

# Send notification if critical findings found
if [ "$critical" -gt 0 ]; then
  curl -X POST https://slack.webhook.example.com \
    -d "{\"text\":\"⚠️  Found $critical critical technical debt findings\"}"
fi

# Commit audit report
git add docs/audits/
git commit -m "chore: nightly technical debt audit"
git push
```
```

### Pre-Deploy Health Check

```markdown
# Before deploying to production

```bash
# Run full audit
audit_result=$(debt-audit-runner --wait --format json)

# Extract critical findings
critical=$(echo "$audit_result" | jq '.summary.critical')

if [ "$critical" -gt 0 ]; then
  echo "DEPLOYMENT BLOCKED: $critical critical technical debt findings"
  echo "Review and fix before deploying to production"
  exit 1
fi

echo "✓ No critical technical debt found"
echo "Proceeding with deployment"
```
```

### Agent-Triggered Audit

```markdown
# From yellow-ruvector learning agent

When code patterns change significantly, trigger debt audit:

```python
# In ruvector embedding analysis
code_churn_rate = calculate_churn()

if code_churn_rate > THRESHOLD:
    print("High code churn detected, triggering debt audit...")

    result = subprocess.run([
        "debt-audit-runner",
        "--category", "ai-patterns",
        "--wait",
        "--format", "json"
    ], capture_output=True, text=True)

    audit = json.loads(result.stdout)

    if audit['total_findings'] > 0:
        print(f"Found {audit['total_findings']} AI pattern debt items")
        # Store in vector memory for learning
        store_pattern_learnings(audit)
```
```

## API Stability

This is a v1 API. Breaking changes will increment version:

- `debt-audit-runner-v1` — Current API
- `debt-audit-runner-v2` — Future breaking changes

Always specify version when building against this API.

## Performance

- Full audit: 1-5 minutes depending on codebase size
- Targeted audit (single category): 30-60 seconds
- Async mode returns immediately (audit runs in background)
- Wait mode blocks until all scanners + synthesis complete

## Error Handling

**Scanner failures**: Partial success if ≤50% fail, full failure if >50% fail
**Path not found**: Error response with details
**Invalid category/severity**: Error response with valid options
**Git repository not found**: Error response
**Concurrent audits**: Not supported, second audit will fail

## Monitoring

Track audit status via:

```bash
# Check if audit is running
ps aux | grep debt-audit

# Check scanner output files
ls .debt/scanner-output/

# Tail audit logs
tail -f .debt/audit.log
```
