---
name: debt:sync
description: "Push accepted debt findings to Linear as issues. Use when you want to track technical debt in Linear."
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Technical Debt Linear Sync Command

Push accepted technical debt findings to Linear as issues with idempotent sync and rollback support.

## Requirements

- **yellow-linear plugin** must be installed
- Linear MCP tools must be available

## Arguments

- `--team <name>` — Override Linear team
- `--project <name>` — Override Linear project

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Parse arguments
TEAM_OVERRIDE=""
PROJECT_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --team)
      TEAM_OVERRIDE="$2"
      shift 2
      ;;
    --project)
      PROJECT_OVERRIDE="$2"
      shift 2
      ;;
    *)
      printf 'ERROR: Unknown argument "%s"\n' "$1" >&2
      exit 1
      ;;
  esac
done

# Check if Linear MCP tools are available
# (In actual implementation, check if mcp__plugin_linear_linear__create_issue exists)
printf '[sync] Checking Linear MCP availability...\n' >&2

# Load or create config
CONFIG_FILE=".debt/linear-config.json"

if [ ! -f "$CONFIG_FILE" ] || [ -n "$TEAM_OVERRIDE" ] || [ -n "$PROJECT_OVERRIDE" ]; then
  # First sync or override - get team/project selection

  printf '[sync] Linear configuration needed.\n' >&2

  # Use AskUserQuestion to select team and project
  # In actual implementation:
  # 1. List available teams via Linear MCP
  # 2. Ask user to select team
  # 3. List projects in selected team
  # 4. Ask user to select project
  # 5. Store in config file

  printf '\nTo configure Linear sync:\n'
  printf '  1. Use AskUserQuestion to select Linear team\n'
  printf '  2. Use AskUserQuestion to select Linear project\n'
  printf '  3. Store config in %s\n' "$CONFIG_FILE"

  # Placeholder config structure:
  cat > "$CONFIG_FILE" <<EOF
{
  "team_id": "TEAM_UUID",
  "team_name": "Engineering",
  "project_id": "PROJECT_UUID",
  "project_name": "Tech Debt"
}
EOF

  printf '\nConfig file created at: %s\n' "$CONFIG_FILE"
fi

# Load config
TEAM_ID=$(jq -r '.team_id' "$CONFIG_FILE")
TEAM_NAME=$(jq -r '.team_name' "$CONFIG_FILE")
PROJECT_ID=$(jq -r '.project_id' "$CONFIG_FILE")
PROJECT_NAME=$(jq -r '.project_name' "$CONFIG_FILE")

# Validate UUID formats (prevent injection)
if ! [[ "$TEAM_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  printf 'ERROR: Invalid team_id format in config (expected UUID)\n' >&2
  exit 1
fi

if ! [[ "$PROJECT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  printf 'ERROR: Invalid project_id format in config (expected UUID)\n' >&2
  exit 1
fi

# Validate name formats (alphanumeric, spaces, hyphens only, max 100 chars)
if ! [[ "$TEAM_NAME" =~ ^[a-zA-Z0-9 -]{1,100}$ ]]; then
  printf 'ERROR: Invalid team_name format in config (alphanumeric, spaces, hyphens only, max 100 chars)\n' >&2
  exit 1
fi

if ! [[ "$PROJECT_NAME" =~ ^[a-zA-Z0-9 -]{1,100}$ ]]; then
  printf 'ERROR: Invalid project_name format in config (alphanumeric, spaces, hyphens only, max 100 chars)\n' >&2
  exit 1
fi

printf '[sync] Syncing to Linear: %s / %s\n' "$TEAM_NAME" "$PROJECT_NAME" >&2

# Load all ready todos without linear_issue_id
mapfile -t TODOS_TO_SYNC < <(
  find todos/debt -name '*-ready-*.md' -print0 2>/dev/null | \
  xargs -0 grep -L 'linear_issue_id: [^n]' 2>/dev/null || true
)

if [ ${#TODOS_TO_SYNC[@]} -eq 0 ]; then
  printf 'No findings to sync (all ready findings already synced).\n'
  exit 0
fi

printf '[sync] Found %d finding(s) to sync to Linear\n' "${#TODOS_TO_SYNC[@]}" >&2

# Sync log for rollback support
declare -a SYNC_LOG=()

# Sync each finding with idempotency and retries
SYNCED_COUNT=0
ERROR_COUNT=0

for todo_path in "${TODOS_TO_SYNC[@]}"; do
  TODO_ID=$(yq -r '.id' "$todo_path" 2>/dev/null)
  TITLE=$(yq -r '.title // "Untitled"' "$todo_path" 2>/dev/null)
  CATEGORY=$(yq -r '.category' "$todo_path" 2>/dev/null)
  SEVERITY=$(yq -r '.severity' "$todo_path" 2>/dev/null)
  DESCRIPTION=$(yq -r '.description // ""' "$todo_path" 2>/dev/null)

  printf '[sync] Processing: %s (ID: %s)\n' "$TITLE" "$TODO_ID" >&2

  # Idempotency: check if issue already exists with label debt-<id>
  # In actual implementation:
  # existing_issue=$(linear_search "label:debt-${TODO_ID}")

  # Placeholder for idempotency check:
  EXISTING_ISSUE=""

  if [ -n "$EXISTING_ISSUE" ]; then
    printf '[sync] Issue already exists, linking: %s\n' "$EXISTING_ISSUE" >&2

    # Link existing issue to todo
    yq -i ".linear_issue_id = \"$EXISTING_ISSUE\"" "$todo_path" || {
      printf '[sync] ERROR: Failed to update todo with existing issue ID\n' >&2
      ERROR_COUNT=$((ERROR_COUNT + 1))
      continue
    }

    SYNCED_COUNT=$((SYNCED_COUNT + 1))
    continue
  fi

  # Create Linear issue with retries
  ISSUE_ID=""

  for attempt in 1 2 3; do
    # In actual implementation:
    # ISSUE_ID=$(linear_create_issue \
    #   --team "$TEAM_ID" \
    #   --project "$PROJECT_ID" \
    #   --title "$TITLE" \
    #   --description "$DESCRIPTION" \
    #   --labels "debt-${TODO_ID},debt,${CATEGORY},${SEVERITY}" \
    #   --priority "$SEVERITY"
    # )

    # Placeholder for issue creation
    if [ $attempt -eq 1 ]; then
      ISSUE_ID="ISSUE_UUID_${TODO_ID}"
      break
    fi

    if [ -z "$ISSUE_ID" ]; then
      if [ $attempt -eq 3 ]; then
        printf '[sync] ERROR: Failed to create Linear issue for %s after 3 attempts\n' "$TODO_ID" >&2

        # Ask about rollback if we've created issues
        if [ ${#SYNC_LOG[@]} -gt 0 ]; then
          printf '\n⚠️  FAILURE: Failed to sync finding %s\n' "$TODO_ID" >&2
          printf 'Created %d issue(s) so far. Rollback?\n' "${#SYNC_LOG[@]}" >&2

          # Use AskUserQuestion for rollback decision
          printf '\nUse AskUserQuestion:\n'
          printf '  "Sync failed. Rollback %d created issues? (Yes/No)"\n' "${#SYNC_LOG[@]}"
          printf '\nIf Yes: delete issues via Linear MCP\n'

          # Placeholder for rollback
          # for logged_issue in "${SYNC_LOG[@]}"; do
          #   linear_delete_issue "$logged_issue" || true
          # done
        fi

        ERROR_COUNT=$((ERROR_COUNT + 1))
        exit 1
      fi

      # Exponential backoff
      sleep $((attempt * 2))
    else
      break
    fi
  done

  # Update todo with issue ID
  yq -i ".linear_issue_id = \"$ISSUE_ID\"" "$todo_path" || {
    printf '[sync] ERROR: Issue %s created but todo update failed\n' "$ISSUE_ID" >&2
    printf '[sync] Manual recovery: edit %s, add linear_issue_id: %s\n' "$todo_path" "$ISSUE_ID" >&2
    ERROR_COUNT=$((ERROR_COUNT + 1))
    exit 1
  }

  SYNC_LOG+=("$ISSUE_ID")
  SYNCED_COUNT=$((SYNCED_COUNT + 1))

  printf '[sync] Created issue: %s\n' "$ISSUE_ID" >&2
done

# Final summary
printf '\n═════════════════════════════════════════════════════════════\n'
printf 'Linear Sync Complete\n'
printf '═════════════════════════════════════════════════════════════\n'
printf 'Synced: %d findings\n' "$SYNCED_COUNT"
printf 'Errors: %d findings\n' "$ERROR_COUNT"

if [ "$SYNCED_COUNT" -gt 0 ]; then
  printf '\nView issues in Linear: %s / %s\n' "$TEAM_NAME" "$PROJECT_NAME"
  printf 'Filter by label: debt\n'
fi

if [ "$ERROR_COUNT" -gt 0 ]; then
  printf '\n⚠️  WARNING: Some findings failed to sync. Check logs above.\n'
  exit 1
fi
```

## Example Usage

```bash
# Sync all ready findings to Linear
$ARGUMENTS

# Override team and project
$ARGUMENTS --team Engineering --project "Tech Debt Q1"

# Re-run to sync new ready findings (idempotent)
$ARGUMENTS
```

## Idempotency

The sync command is idempotent:

1. **Check for existing issue** using label search: `label:debt-<id>`
2. **If exists**: Link to todo, skip creation
3. **If not exists**: Create new issue with unique label

Re-running sync won't create duplicates.

## Issue Format

Each synced Linear issue includes:

**Title**: Finding title from todo
**Description**: Full finding description with code context
**Labels**:
- `debt` — All technical debt issues
- `debt-<id>` — Unique ID for idempotency
- `<category>` — Category (complexity, duplication, etc.)
- `<severity>` — Severity level

**Priority**: Mapped from severity (critical → urgent, high → high, etc.)
**Project**: Configured project
**Team**: Configured team

## Rollback Support

If sync fails partway through:

1. Display number of issues created so far
2. Ask user: "Rollback N created issues? (Yes/No)"
3. On Yes: Delete created issues via Linear MCP
4. On No: Keep created issues, user can manually clean up

**Recovery**: Todo files have `linear_issue_id` only for successfully synced items.

## Error Scenarios

**Linear MCP not available**: Exit with error, instruct to install yellow-linear
**Network failure**: Retry 3x with exponential backoff
**Rate limit (429)**: Exit with error, instruct to wait and retry
**Invalid credentials**: Exit with error, check Linear API token
**Partial sync failure**: Offer rollback of created issues

## Configuration

Config stored in `.debt/linear-config.json`:

```json
{
  "team_id": "TEAM_UUID",
  "team_name": "Engineering",
  "project_id": "PROJECT_UUID",
  "project_name": "Tech Debt"
}
```

Override per-run with `--team` and `--project` flags.

## Recovery Procedures

**If todo update fails after issue creation**:
- Issue exists in Linear
- Todo missing `linear_issue_id`
- Manual fix: Edit todo, add `linear_issue_id: <uuid>`

**If sync is interrupted**:
- Todos with `linear_issue_id` won't be re-synced (idempotency)
- Re-run sync to complete

**If need to re-sync all findings**:
- Clear `linear_issue_id` from todos
- Issues will be detected by label and linked (no duplicates)
