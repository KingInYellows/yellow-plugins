# Technical Debt Query API

## What It Does

Programmatic API for agents to query current debt state, filter by category/severity, and access todo file metadata. Enables cross-plugin integration where other plugins can check technical debt before taking actions.

## When to Use

- When building agents that need to check existing debt before actions
- When cross-plugin integrations need to query debt state
- When implementing automated debt tracking or dashboards
- When agents need to understand codebase health

## Usage

### Query All Debt

```bash
# Get all technical debt findings
debt-query --format json

# Returns:
{
  "total_findings": 23,
  "by_status": { ... },
  "by_category": { ... },
  "by_severity": { ... }
}
```

### Filter by Category

```bash
# Get only complexity findings
debt-query --category complexity --format json

# Returns findings matching category filter
```

### Filter by Severity

```bash
# Get critical and high severity findings
debt-query --severity high --format json

# Returns findings with high or critical severity
```

### Filter by Status

```bash
# Get only ready findings (accepted, awaiting fix)
debt-query --status ready --format json

# Returns findings in ready state
```

### Filter by File

```bash
# Get findings affecting a specific file
debt-query --file src/services/user-service.ts --format json

# Returns findings where affected_files includes the specified file
```

### Get Specific Finding

```bash
# Get finding by ID
debt-query --id 042 --format json

# Returns single finding with full details
```

## Output Format

### Summary Output (default)

```json
{
  "total_findings": 23,
  "by_status": {
    "pending": 12,
    "ready": 8,
    "in_progress": 1,
    "deferred": 3,
    "complete": 15
  },
  "by_category": {
    "complexity": 8,
    "duplication": 5,
    "ai_patterns": 4,
    "architecture": 3,
    "security": 2
  },
  "by_severity": {
    "critical": 5,
    "high": 8,
    "medium": 7,
    "low": 3
  }
}
```

### Detailed Output (with --details)

```json
{
  "findings": [
    {
      "id": "042",
      "status": "ready",
      "category": "complexity",
      "severity": "high",
      "effort": "small",
      "title": "High Cyclomatic Complexity in UserService",
      "affected_files": [
        "src/services/user-service.ts:45-89"
      ],
      "linear_issue_id": null,
      "todo_path": "todos/debt/042-ready-high-complexity.md"
    },
    ...
  ]
}
```

## Implementation

The query API reads todo files from `todos/debt/` and aggregates based on frontmatter:

```bash
#!/usr/bin/env bash

# Parse arguments
CATEGORY_FILTER=""
SEVERITY_FILTER=""
STATUS_FILTER=""
FILE_FILTER=""
ID_FILTER=""
FORMAT="json"
DETAILS=false

# Scan todos/debt/ directory
for todo_file in todos/debt/*.md; do
  # Extract frontmatter
  id=$(yq '.id' "$todo_file")
  status=$(yq '.status' "$todo_file")
  category=$(yq '.category' "$todo_file")
  severity=$(yq '.severity' "$todo_file")

  # Apply filters
  [ -n "$CATEGORY_FILTER" ] && [ "$category" != "$CATEGORY_FILTER" ] && continue
  [ -n "$SEVERITY_FILTER" ] && ! severity_matches "$severity" "$SEVERITY_FILTER" && continue
  [ -n "$STATUS_FILTER" ] && [ "$status" != "$STATUS_FILTER" ] && continue
  [ -n "$FILE_FILTER" ] && ! file_affected "$todo_file" "$FILE_FILTER" && continue
  [ -n "$ID_FILTER" ] && [ "$id" != "$ID_FILTER" ] && continue

  # Include in results
  findings+=("$todo_file")
done

# Output in requested format
if [ "$DETAILS" = true ]; then
  output_detailed_findings "${findings[@]}"
else
  output_summary "${findings[@]}"
fi
```

## Example Use Cases

### Cross-Plugin Integration: yellow-review

```markdown
# In yellow-review PR review agent

Before approving PR, check if modified files have existing technical debt:

```bash
# Get debt findings for files changed in PR
for file in $(git diff --name-only origin/main...HEAD); do
  debt=$(debt-query --file "$file" --status ready --format json)

  if [ "$(echo "$debt" | jq '.total_findings')" -gt 0 ]; then
    echo "⚠️  $file has $(echo "$debt" | jq '.total_findings') existing debt finding(s)"
  fi
done
```

Include debt warnings in PR review comments.
```

### Automated Dashboard

```markdown
# Generate daily debt report

```bash
debt-query --format json --details > daily-debt-report.json

# Send to monitoring dashboard
curl -X POST https://dashboard.example.com/api/metrics \
  -H "Content-Type: application/json" \
  -d @daily-debt-report.json
```
```

### Pre-Commit Hook

```markdown
# Warn if committing changes to files with critical debt

```bash
for file in $(git diff --cached --name-only); do
  critical=$(debt-query --file "$file" --severity critical --format json)

  if [ "$(echo "$critical" | jq '.total_findings')" -gt 0 ]; then
    echo "WARNING: $file has critical technical debt findings"
    echo "Run /debt:status for details"
  fi
done
```
```

## API Stability

This is a v1 API. Breaking changes will increment version:

- `debt-query-v1` — Current API
- `debt-query-v2` — Future breaking changes

Always specify version when building against this API.

## Performance

- Query scans `todos/debt/` directory
- For large codebases (1000+ findings), queries may take 1-2 seconds
- Results are not cached (always live data)
- Consider caching results if querying frequently

## Error Handling

**No findings match filters**: Returns empty results, not error
**todos/debt/ doesn't exist**: Returns zero findings
**Corrupted todo files**: Skipped, logged to stderr
**Invalid filter values**: Returns error with valid options
