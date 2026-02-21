---
name: devin:tag
description: Manage session tags. Use when user wants to tag a session, says "tag session", "add tag to Devin", "list tags", or "remove tag".
argument-hint: '<session-id> <add|remove|list> [tags...]'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Manage Devin Session Tags

Add, remove, or list tags on a Devin session.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` are set. Check `jq` is
available. See `devin-workflows` skill for validation functions.

### Step 2: Parse Arguments

Parse `$ARGUMENTS`:

- First token: session ID
- Second token: subcommand (`add`, `remove`, or `list`)
- Remaining tokens: tag names (for `add`/`remove`)

If arguments are incomplete, prompt via AskUserQuestion.

Validate session ID with `validate_session_id` from `devin-workflows` skill.

### Step 3: Validate Tags

For `add` and `remove` subcommands, validate each tag:

- Max 32 characters per tag
- Alphanumeric + dashes only: `^[a-zA-Z0-9-]{1,32}$`
- Max 10 tags per session total

Suggest lowercase-with-dashes format: `project-auth`, `sprint-42`, `bug-fix`.

### Step 4: Fetch Current Tags

Fetch session to get current tag list:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Extract current `.tags` array from response.

### Step 5: Execute Subcommand

**`list`:** Display current tags and stop.

**`add`:** Merge new tags with existing tags, deduplicate, check max 10 limit.

**`remove`:** Filter out specified tags from existing list.

### Step 6: Update Tags

Construct updated tag array and PUT to the tag endpoint. Try V3 org-scoped
endpoint first; if V3 returns 404, fall back to V1:

```bash
# Try V3 first (endpoint TBD — verify during implementation)
# Fall back to V1 if needed:
jq -n --argjson tags "$UPDATED_TAGS_JSON" '{tags: $tags}' | \
  curl -s --connect-timeout 5 --max-time 30 \
    -w "\n%{http_code}" \
    -X PUT "https://api.devin.ai/v1/sessions/${SESSION_ID}/tags" \
    -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```

**Note:** V1 tag endpoint compatibility with `cog_` tokens must be verified
during implementation. If V1 rejects `cog_` tokens, this command is limited to
setting tags at creation time via `/devin:delegate --tags`.

Check curl exit code, HTTP status, jq parse.

### Step 7: Report

Display updated tag list:

- "Tags for session {id}: tag1, tag2, tag3"

If tag update failed due to endpoint unavailability:

- Report: "Tag update endpoint not available. Tags can be set at creation time
  via `/devin:delegate --tags t1,t2`."

## Error Handling

See `devin-workflows` skill for error handling patterns. All error output must
sanitize tokens.
