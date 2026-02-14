---
name: debt:status
description: "Dashboard of current technical debt levels. Use when you want to check debt status, see aggregated metrics, or export debt data."
allowed-tools:
  - Bash
  - Read
---

# Technical Debt Status Command

Display a dashboard of current technical debt levels aggregated by status, category, severity, and effort.

## Arguments

- `--json` — Output machine-readable JSON instead of formatted dashboard

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Parse arguments
JSON_OUTPUT=false

while [ $# -gt 0 ]; do
  case "$1" in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    *)
      printf 'ERROR: Unknown argument "%s"\n' "$1" >&2
      exit 1
      ;;
  esac
done

# Scan todos/debt/ for all todo files with corruption handling
declare -A by_status
declare -A by_category
declare -A by_severity
declare -A by_effort

# Initialize counters
for status in pending ready in-progress deferred complete; do
  by_status["$status"]=0
done

for category in ai-patterns complexity duplication architecture security; do
  by_category["$category"]=0
done

for severity in critical high medium low; do
  by_severity["$severity"]=0
done

for effort in quick small medium large; do
  by_effort["$effort"]=0
done

# Scan all todo files
TODO_COUNT=0
ERROR_COUNT=0

if [ -d todos/debt ]; then
  while IFS= read -r -d '' todo_file; do
    # Validate file exists and is readable
    if [ ! -f "$todo_file" ] || [ ! -r "$todo_file" ]; then
      printf '[status] WARNING: Skipping corrupted file: %s\n' "$todo_file" >&2
      ERROR_COUNT=$((ERROR_COUNT + 1))
      continue
    fi

    # Extract metadata using yq
    STATUS=$(yq -r '.status // "unknown"' "$todo_file" 2>/dev/null)
    CATEGORY=$(yq -r '.category // "unknown"' "$todo_file" 2>/dev/null)
    SEVERITY=$(yq -r '.severity // "unknown"' "$todo_file" 2>/dev/null)
    EFFORT=$(yq -r '.effort // "unknown"' "$todo_file" 2>/dev/null)

    # Validate and increment status counter
    case "$STATUS" in
      pending|ready|in-progress|complete|deferred)
        val_status=${by_status["$STATUS"]:-0}
        by_status["$STATUS"]=$((val_status + 1))
        ;;
      *)
        printf '[status] WARNING: Unknown status "%s" in %s\n' "$STATUS" "$todo_file" >&2
        ERROR_COUNT=$((ERROR_COUNT + 1))
        ;;
    esac

    # Validate and increment category counter
    case "$CATEGORY" in
      ai-patterns|complexity|duplication|architecture|security)
        val_category=${by_category["$CATEGORY"]:-0}
        by_category["$CATEGORY"]=$((val_category + 1))
        ;;
      *)
        printf '[status] WARNING: Unknown category "%s" in %s\n' "$CATEGORY" "$todo_file" >&2
        ;;
    esac

    # Validate and increment severity counter
    case "$SEVERITY" in
      critical|high|medium|low)
        val_severity=${by_severity["$SEVERITY"]:-0}
        by_severity["$SEVERITY"]=$((val_severity + 1))
        ;;
      *)
        printf '[status] WARNING: Unknown severity "%s" in %s\n' "$SEVERITY" "$todo_file" >&2
        ;;
    esac

    # Validate and increment effort counter
    case "$EFFORT" in
      quick|small|medium|large)
        val_effort=${by_effort["$EFFORT"]:-0}
        by_effort["$EFFORT"]=$((val_effort + 1))
        ;;
      *)
        printf '[status] WARNING: Unknown effort "%s" in %s\n' "$EFFORT" "$todo_file" >&2
        ;;
    esac

    TODO_COUNT=$((TODO_COUNT + 1))
  done < <(find todos/debt -name '*.md' -print0 2>/dev/null)
fi

# Calculate estimated remaining effort
# Quick: 0.5hr avg, Small: 1hr avg, Medium: 5hr avg, Large: 20hr avg
if command -v bc >/dev/null 2>&1; then
  # Use bc for precise floating-point calculation
  EFFORT_HOURS=$(echo "(${by_effort[quick]:-0} * 0.5) + \
    (${by_effort[small]:-0} * 1) + \
    (${by_effort[medium]:-0} * 5) + \
    (${by_effort[large]:-0} * 20)" | bc)
else
  # Fallback: integer calculation that ignores quick fixes
  printf '[status] WARNING: bc not available, quick fixes ignored in effort calculation\n' >&2
  EFFORT_HOURS=$((
    ${by_effort[small]:-0} * 1 +
    ${by_effort[medium]:-0} * 5 +
    ${by_effort[large]:-0} * 20
  ))
fi

if [ "$JSON_OUTPUT" = true ]; then
  # Machine-readable JSON output
  cat <<EOF
{
  "total_findings": $TODO_COUNT,
  "errors": $ERROR_COUNT,
  "by_status": {
    "pending": ${by_status[pending]},
    "ready": ${by_status[ready]},
    "in_progress": ${by_status[in-progress]},
    "deferred": ${by_status[deferred]},
    "complete": ${by_status[complete]}
  },
  "by_category": {
    "ai_patterns": ${by_category[ai-patterns]},
    "complexity": ${by_category[complexity]},
    "duplication": ${by_category[duplication]},
    "architecture": ${by_category[architecture]},
    "security": ${by_category[security]}
  },
  "by_severity": {
    "critical": ${by_severity[critical]},
    "high": ${by_severity[high]},
    "medium": ${by_severity[medium]},
    "low": ${by_severity[low]}
  },
  "estimated_effort_hours": $EFFORT_HOURS
}
EOF
else
  # Human-readable dashboard
  cat <<EOF
Technical Debt Dashboard
========================

By Status:
  Pending:     ${by_status[pending]} findings
  Ready:       ${by_status[ready]} findings
  In Progress: ${by_status[in-progress]} finding
  Deferred:    ${by_status[deferred]} findings
  Complete:    ${by_status[complete]} findings (resolved)

By Category:
  Complexity:    ${by_category[complexity]}
  Duplication:   ${by_category[duplication]}
  AI Patterns:   ${by_category[ai-patterns]}
  Architecture:  ${by_category[architecture]}
  Security:      ${by_category[security]}

By Severity:
  Critical: ${by_severity[critical]}
  High:     ${by_severity[high]}
  Medium:   ${by_severity[medium]}
  Low:      ${by_severity[low]}

Estimated Remaining Effort: ~${EFFORT_HOURS} hours
  Quick fixes:  ${by_effort[quick]} items
  Small:        ${by_effort[small]} items
  Medium:       ${by_effort[medium]} items
  Large:        ${by_effort[large]} items

EOF

  if [ $ERROR_COUNT -gt 0 ]; then
    printf 'WARNING: %d corrupted todo file(s) skipped\n\n' "$ERROR_COUNT"
  fi

  # Next steps based on current state
  if [ "${by_status[pending]}" -gt 0 ]; then
    printf 'Next Steps:\n'
    printf '  - Run /debt:triage to review %d pending finding(s)\n' "${by_status[pending]}"
  elif [ "${by_status[ready]}" -gt 0 ]; then
    printf 'Next Steps:\n'
    printf '  - Run /debt:fix to remediate %d ready finding(s)\n' "${by_status[ready]}"
  elif [ "${by_status[in-progress]}" -gt 0 ]; then
    printf 'Next Steps:\n'
    printf '  - Complete %d in-progress finding(s)\n' "${by_status[in-progress]}"
  else
    printf 'All findings have been triaged and completed!\n'
    printf 'Run /debt:audit to scan for new technical debt.\n'
  fi
fi
```

## Example Usage

```bash
# View dashboard
$ARGUMENTS

# Export as JSON
$ARGUMENTS --json
```

## Output Format

### Human-Readable Dashboard

```
Technical Debt Dashboard
========================

By Status:
  Pending:     12 findings
  Ready:        8 findings
  In Progress:  1 finding
  Deferred:     3 findings
  Complete:    15 findings (resolved)

By Category:
  Complexity:    8 (3 critical, 5 high)
  Duplication:   5 (2 high, 3 medium)
  AI Patterns:   4 (4 medium)
  Architecture:  3 (1 critical, 2 high)
  Security:      2 (2 critical)

Estimated Remaining Effort: ~32 hours
  Quick fixes:  5 items (~2.5 hrs)
  Small:        8 items (~12 hrs)
  Medium:       3 items (~15 hrs)

Next Steps:
  - Run /debt:triage to review 12 pending finding(s)
```

### JSON Output

```json
{
  "total_findings": 23,
  "errors": 0,
  "by_status": {
    "pending": 12,
    "ready": 8,
    "in_progress": 1,
    "deferred": 3,
    "complete": 15
  },
  "by_category": {
    "ai_patterns": 4,
    "complexity": 8,
    "duplication": 5,
    "architecture": 3,
    "security": 2
  },
  "by_severity": {
    "critical": 6,
    "high": 10,
    "medium": 5,
    "low": 2
  },
  "estimated_effort_hours": 32
}
```

## Error Handling

**Corrupted todo files**: Skipped with warning, counted in error total
**Missing todos/debt/ directory**: Shows zeros for all metrics
**Malformed YAML frontmatter**: File skipped, error logged

## Use Cases

**Team dashboards**: Export as JSON and visualize in monitoring tools
**Progress tracking**: Compare status over time
**Prioritization**: See high-severity items at a glance
**Effort planning**: Use estimated hours for sprint planning
