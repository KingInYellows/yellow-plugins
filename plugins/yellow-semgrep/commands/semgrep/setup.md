---
name: semgrep:setup
description: "Validate SEMGREP_APP_TOKEN, test MCP connection, detect deployment slug, and cache configuration. Use when first installing the plugin, after token rotation, or on auth errors."
allowed-tools:
  - Bash
  - Skill
  - ToolSearch
  - AskUserQuestion
---

# Set Up yellow-semgrep

Validate prerequisites, authenticate with the Semgrep AppSec Platform, detect
the deployment slug and repository name, and verify MCP tool availability.

## Workflow

### Step 1: Validate Prerequisites

Check required CLI tools are available:

```bash
for cmd in curl jq semgrep; do
  command -v "$cmd" >/dev/null 2>&1 || {
    printf '[yellow-semgrep] Error: %s is required but not found.\n' "$cmd" >&2
    exit 1
  }
done
printf '[yellow-semgrep] Prerequisites: curl, jq, semgrep ✓\n'
```

### Step 2: Validate Token

See `semgrep-conventions` skill for the `validate_token` pattern.

Check `SEMGREP_APP_TOKEN` is set. Validate format matches `^sgp_[a-zA-Z0-9]{20,}$`.
Never echo the token value. Redact with
`sed 's/sgp_[a-zA-Z0-9]*/***REDACTED***/g'`.

Hit `GET /api/v1/me` to validate Web API scope. Use the three-layer error check
from the `semgrep-conventions` skill.

```bash
SEMGREP_API="https://semgrep.dev/api/v1"

response=$(curl -s --connect-timeout 5 --max-time 15 \
  -w "\n%{http_code}" \
  -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "${SEMGREP_API}/me")
curl_exit=$?
http_status="${response##*$'\n'}"
body="${response%$'\n'*}"
```

Handle errors per skill patterns:
- curl exit 6/7/28: network failure
- 401: invalid or expired token
- 404: token has CI scope — show: "Token appears to have CI scope. Create a
  new token with **Web API** scope at Organization Settings > API Tokens."
- 200: extract user email from response

### Step 3: Detect Deployment Slug

```bash
response=$(curl -s --connect-timeout 5 --max-time 15 \
  -w "\n%{http_code}" \
  -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "${SEMGREP_API}/deployments")
```

Parse the `deployments` array. If empty: "No Semgrep deployments found for this
token."

If multiple deployments returned, present AskUserQuestion:
- "Multiple Semgrep deployments found. Which one should this plugin use?"
- Options: one per deployment showing `{name} (slug: {slug})`

Store the selected slug for use by subsequent commands.

### Step 4: Detect Repository Name

See `semgrep-conventions` skill for the `repo_name_extraction` pattern.

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null) || {
  printf '[yellow-semgrep] Warning: No git remote configured.\n' >&2
  printf 'Some commands will require --repo flag.\n' >&2
  REPO_NAME=""
}
if [ -n "$REMOTE_URL" ]; then
  REPO_NAME=$(printf '%s' "$REMOTE_URL" | sed -E 's#.+[:/]([^/]+/[^/.]+)(\.git)?$#\1#')
fi
```

### Step 5: Verify MCP Tools

Use ToolSearch to discover available Semgrep MCP tools:

Call ToolSearch with query `"+semgrep"` to find all Semgrep MCP tools.

Expected tools:
- `semgrep_scan`
- `semgrep_findings`
- `semgrep_scan_with_custom_rule`
- `get_abstract_syntax_tree`
- `semgrep_rule_schema`
- `get_supported_languages`
- `semgrep_scan_supply_chain`
- `semgrep_whoami`

Count discovered tools. If fewer than 2 core tools (`semgrep_scan`,
`semgrep_findings`) are found, warn: "MCP server may not be running. Check that
`uvx semgrep-mcp` is available."

### Step 6: Report Results

Display a summary table:

```
yellow-semgrep Setup Results
─────────────────────────────
Token:        valid (Web API scope)
User:         {email}
Deployment:   {name} (slug: {slug})
Repository:   {repo_name}
Semgrep CLI:  {semgrep --version output}
MCP Tools:    {count} tools verified
─────────────────────────────
Setup complete. Run /semgrep:status to see findings.
```

If any step had a warning (e.g., no git remote, fewer MCP tools than expected),
list warnings at the bottom.

## Error Handling

| Condition | Message | Action |
|---|---|---|
| `SEMGREP_APP_TOKEN` not set | "SEMGREP_APP_TOKEN not set" | Exit with setup instructions |
| Token format invalid | "Invalid token format (expected sgp_ prefix)" | Exit |
| 401 on /me | "Invalid or expired token" | Exit |
| 404 on /me | "Token has CI scope, not Web API" | Exit with instructions |
| DNS/network failure | "Cannot reach semgrep.dev" | Exit |
| No deployments | "No deployments found" | Exit |
| No git remote | Warning only — continue | Commands needing repo will prompt |
| MCP tools not found | Warning only — continue | Scan features may be limited |
