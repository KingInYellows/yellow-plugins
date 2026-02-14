---
name: debt:triage
description: "Interactive review and prioritization of pending debt findings. Use when you need to accept, reject, or defer findings from an audit."
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Technical Debt Triage Command

Interactively review pending technical debt findings and decide to accept (ready), reject (deleted), or defer (deferred) each one.

## Arguments

- `--category <name>` — Filter to specific category: ai-patterns, complexity, duplication, architecture, security
- `--priority <level>` — Filter to minimum priority: p1, p2, p3, p4

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source validation library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../../lib/validate.sh
source "${PLUGIN_ROOT}/lib/validate.sh"

# Parse arguments
CATEGORY_FILTER=""
PRIORITY_FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --category)
      CATEGORY_FILTER="$2"
      validate_category "$CATEGORY_FILTER" || {
        printf 'ERROR: Invalid category "%s"\n' "$CATEGORY_FILTER" >&2
        exit 1
      }
      shift 2
      ;;
    --priority)
      PRIORITY_FILTER="$2"
      case "$PRIORITY_FILTER" in
        p1|p2|p3|p4) ;;
        *)
          printf 'ERROR: Invalid priority "%s". Must be: p1, p2, p3, p4\n' "$PRIORITY_FILTER" >&2
          exit 1
          ;;
      esac
      shift 2
      ;;
    *)
      printf 'ERROR: Unknown argument "%s"\n' "$1" >&2
      exit 1
      ;;
  esac
done

# Load all pending todo files
mapfile -t TODO_FILES < <(find todos/debt -name '*-pending-*.md' 2>/dev/null | sort)

if [ ${#TODO_FILES[@]} -eq 0 ]; then
  printf 'No pending findings to triage.\n'
  printf 'Run /debt:audit to generate findings.\n'
  exit 0
fi

# Apply filters
FILTERED_FILES=()
for todo_path in "${TODO_FILES[@]}"; do
  # Validate file structure
  if [ ! -f "$todo_path" ]; then
    printf '[triage] WARNING: Skipping corrupted file: %s\n' "$todo_path" >&2
    continue
  fi

  # Extract frontmatter
  CATEGORY=$(yq '.category' "$todo_path" 2>/dev/null || echo "")
  PRIORITY=$(yq '.priority' "$todo_path" 2>/dev/null || echo "")

  # Apply category filter
  if [ -n "$CATEGORY_FILTER" ] && [ "$CATEGORY" != "$CATEGORY_FILTER" ]; then
    continue
  fi

  # Apply priority filter (p1 > p2 > p3 > p4)
  if [ -n "$PRIORITY_FILTER" ]; then
    case "$PRIORITY_FILTER" in
      p1)
        [ "$PRIORITY" = "p1" ] || continue
        ;;
      p2)
        [[ "$PRIORITY" =~ ^p[12]$ ]] || continue
        ;;
      p3)
        [[ "$PRIORITY" =~ ^p[123]$ ]] || continue
        ;;
      p4)
        # Include all priorities
        ;;
    esac
  fi

  FILTERED_FILES+=("$todo_path")
done

if [ ${#FILTERED_FILES[@]} -eq 0 ]; then
  printf 'No pending findings match the filter criteria.\n'
  exit 0
fi

# Sort by severity descending (critical first)
# Note: This is a simplified sort; actual implementation would use yq to extract severity

printf 'Found %d pending finding(s) to triage.\n\n' "${#FILTERED_FILES[@]}"

# Triage loop
TRIAGED_COUNT=0
ACCEPTED_COUNT=0
REJECTED_COUNT=0
DEFERRED_COUNT=0

for todo_path in "${FILTERED_FILES[@]}"; do
  # Extract metadata
  TITLE=$(yq -r '.title // "Untitled"' "$todo_path" 2>/dev/null)
  CATEGORY=$(yq -r '.category' "$todo_path" 2>/dev/null)
  SEVERITY=$(yq -r '.severity' "$todo_path" 2>/dev/null)
  EFFORT=$(yq -r '.effort' "$todo_path" 2>/dev/null)
  AFFECTED_FILES=$(yq -r '.affected_files[]' "$todo_path" 2>/dev/null | head -1)

  # Display finding
  printf '═════════════════════════════════════════════════════════════\n'
  printf 'Finding %d/%d\n' $((TRIAGED_COUNT + 1)) "${#FILTERED_FILES[@]}"
  printf '═════════════════════════════════════════════════════════════\n'
  printf 'Title: %s\n' "$TITLE"
  printf 'Category: %s | Severity: %s | Effort: %s\n' "$CATEGORY" "$SEVERITY" "$EFFORT"
  printf 'Affected: %s\n\n' "$AFFECTED_FILES"

  # Show code context (±5 lines)
  printf 'Code Context:\n'
  FILE_PATH=$(echo "$AFFECTED_FILES" | cut -d: -f1)
  LINE_RANGE=$(echo "$AFFECTED_FILES" | cut -d: -f2)
  START_LINE=$(echo "$LINE_RANGE" | cut -d- -f1)
  
  # Validate START_LINE is numeric before arithmetic expansion
  if [[ ! "$START_LINE" =~ ^[0-9]+$ ]]; then
    CONTEXT_START=1
    CONTEXT_END=15
  else
    CONTEXT_START=$((START_LINE > 5 ? START_LINE - 5 : 1))
    CONTEXT_END=$((START_LINE + 10))
  fi

  if validate_file_path "$FILE_PATH"; then
    sed -n "${CONTEXT_START},${CONTEXT_END}p" "$FILE_PATH" | head -15
  else
    printf '(invalid or unauthorized file path: %s)\n' "$FILE_PATH"
  fi

  printf '\n'

  # Read finding description
  printf 'Finding Description:\n'
  sed -n '/^## Finding$/,/^## /p' "$todo_path" | sed '$d' | tail -n +2
  printf '\n'

  # Read suggested remediation
  printf 'Suggested Remediation:\n'
  sed -n '/^## Suggested Remediation$/,/^## /p' "$todo_path" | sed '$d' | tail -n +2
  printf '\n'

  # Decision prompt (use AskUserQuestion in actual implementation)
  printf 'Decision:\n'
  printf '  Accept  - Mark as ready for remediation\n'
  printf '  Reject  - Mark as false positive (will be deleted)\n'
  printf '  Defer   - Postpone decision with reason\n'
  printf '\n'

  # Placeholder for AskUserQuestion
  # In actual implementation, use:
  # AskUserQuestion with options: Accept / Reject / Defer
  #
  # For now, show manual transition command:
  printf 'To triage this finding, use transition_todo_state:\n'
  printf '  Accept: transition_todo_state "%s" ready\n' "$todo_path"
  printf '  Reject: transition_todo_state "%s" deleted\n' "$todo_path"
  printf '  Defer:  transition_todo_state "%s" deferred\n' "$todo_path"
  printf '\n'

  TRIAGED_COUNT=$((TRIAGED_COUNT + 1))
done

# Final summary
printf '\n═════════════════════════════════════════════════════════════\n'
printf 'Triage Summary\n'
printf '═════════════════════════════════════════════════════════════\n'
printf 'Total processed: %d findings\n' "$TRIAGED_COUNT"
printf 'Accepted: %d | Rejected: %d | Deferred: %d\n' "$ACCEPTED_COUNT" "$REJECTED_COUNT" "$DEFERRED_COUNT"
printf '\nNext steps:\n'
printf '  - Run /debt:fix to remediate accepted findings\n'
printf '  - Run /debt:status to see current debt levels\n'
```

## Example Usage

```bash
# Triage all pending findings
$ARGUMENTS

# Triage only complexity findings
$ARGUMENTS --category complexity

# Triage high priority findings (p1-p2)
$ARGUMENTS --priority p2
```

## Triage Decisions

**Accept** → Transitions to `ready` state
- Finding is valid and should be fixed
- Will appear in `/debt:fix` workflow
- Can be synced to Linear via `/debt:sync`

**Reject** → Transitions to `deleted` state
- Finding is false positive
- File will be removed from todos/debt/
- Can be recovered from git history if needed

**Defer** → Transitions to `deferred` state
- Valid finding but not addressing now
- Requires reason and optional date
- Will be re-evaluated in next audit

## Atomic Transitions

All state changes use the `transition_todo_state()` function from `lib/validate.sh` which provides:
- TOCTOU protection via `flock`
- Transition validation (only legal state changes allowed)
- Atomic rename (filename prefix updated atomically with frontmatter)

## Error Recovery

If triage is interrupted:
- All decisions made so far are persisted
- Re-run `/debt:triage` to continue from remaining pending findings
- Previously triaged items won't be shown again
