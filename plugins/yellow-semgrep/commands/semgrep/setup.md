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

### Step 0: Install or upgrade semgrep CLI

The MCP server is built into the semgrep binary (`semgrep mcp`) and requires
version **1.146.0 or later**. This step ensures semgrep is installed and meets
the minimum version.

Check if `semgrep` is already installed:

```bash
command -v semgrep >/dev/null 2>&1 && printf '[yellow-semgrep] semgrep: ok (%s)\n' "$(semgrep --version 2>/dev/null)"
```

If `semgrep` is NOT found, use AskUserQuestion:

> "semgrep CLI not found. Install it now? (Required for scanning, fixing, and
> MCP tools)"
>
> Options: "Yes, install semgrep" / "No, I'll install manually"

If the user chooses **Yes**: run the install script (handles both fresh install
and upgrade to minimum version):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-semgrep.sh"
```

If the install script exits non-zero, print a warning with manual instructions
and continue to Step 1:

```
[yellow-semgrep] Warning: semgrep installation failed. Some features will be
unavailable. Install semgrep manually using one of:
  pipx install semgrep          (recommended — install pipx: brew install pipx)
  pip install semgrep           (requires Python 3.9+)
  brew install semgrep          (macOS only)
Then re-run /semgrep:setup
```

If the user chooses **No**: show manual install instructions and continue:

```
Install semgrep manually using one of:
  pipx install semgrep          (recommended — install pipx: brew install pipx)
  pip install semgrep           (requires Python 3.9+)
  brew install semgrep          (macOS only)
Then re-run /semgrep:setup
```

**If semgrep IS found**, check the version meets the minimum for MCP support:

```bash
MIN_SEMGREP_VERSION="1.146.0"
semgrep_version_output=$(semgrep --version 2>/dev/null || true)
installed_version=$(printf '%s\n' "$semgrep_version_output" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || true)
version_gte() {
  local i av bv
  local -a a b
  IFS='.' read -r -a a <<< "$1"
  IFS='.' read -r -a b <<< "$2"
  for ((i=0; i<${#b[@]}; i++)); do
    av="${a[i]:-0}"
    bv="${b[i]:-0}"
    av="${av%%[^0-9]*}"
    bv="${bv%%[^0-9]*}"
    av="${av:-0}"
    bv="${bv:-0}"
    if ((av > bv)); then return 0; fi
    if ((av < bv)); then return 1; fi
  done
  return 0
}
```

If `installed_version` is empty, warn that `semgrep --version` returned an
unexpected value and suggest reinstalling with:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-semgrep.sh"
```

Otherwise, use `version_gte "$installed_version" "$MIN_SEMGREP_VERSION"` for
the semver comparison. If the installed version is below minimum, use
AskUserQuestion:

> "semgrep {version} is installed but MCP tools require >= 1.146.0. Upgrade
> now?"
>
> Options: "Yes, upgrade semgrep" / "No, continue without MCP"

If the user chooses **Yes**: run the install script (it handles upgrades):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-semgrep.sh"
```

If the user chooses **No**: warn and continue:

```text
[yellow-semgrep] Warning: semgrep < 1.146.0 — MCP tools will not be available.
Scan and fix commands will fall back to CLI-only mode.
```

### Step 1: Validate Prerequisites

Check required CLI tools are available. `curl` and `jq` are hard prerequisites
(needed for API calls). `semgrep` is a soft prerequisite — warn if missing
(Step 0 already offered installation).

```bash
for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || {
    printf '[yellow-semgrep] Error: %s is required but not found.\n' "$cmd" >&2
    exit 1
  }
done
if command -v semgrep >/dev/null 2>&1; then
  printf '[yellow-semgrep] Prerequisites: curl, jq, semgrep ✓\n'
else
  printf '[yellow-semgrep] Prerequisites: curl ✓, jq ✓, semgrep ✗ (not installed — scan features limited)\n' >&2
fi
```

### Step 2: Validate Token

See `semgrep-conventions` skill for the `validate_token` pattern.

Check that the token is configured via **either** shell `SEMGREP_APP_TOKEN`
or `userConfig.semgrep_app_token`. The MCP server reads the userConfig
value; the curl-based REST calls in this setup script and in the
`/semgrep:*` remediation commands read the shell env var. If only
userConfig is configured, skip the curl probe — the MCP's successful
startup (tool visibility) is an implicit credential validation.

```bash
# Mirror the 2-arg has_userconfig helper used in /setup:all. Kept in
# sync manually — see plugins/yellow-core/commands/setup/all.md for the
# canonical definition.
has_userconfig() {
  local plugin="$1" option="$2" jq_exit
  local settings="${HOME}/.claude/settings.json"
  [ -r "$settings" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -e --arg p "$plugin" --arg o "$option" \
      '.pluginConfigs[$p].options[$o] // empty' \
      "$settings" >/dev/null 2>/dev/null
    jq_exit=$?
    if [ "$jq_exit" -ge 2 ]; then
      printf '[has_userconfig] Warning: jq could not parse %s (exit %d)\n' \
        "$settings" "$jq_exit" >&2
    fi
    return "$jq_exit"
  else
    printf '[has_userconfig] Warning: jq not installed; using fixed-string grep fallback (may produce false positives)\n' >&2
    grep -qF "\"$plugin\"" "$settings" 2>/dev/null \
      && grep -qF "\"$option\"" "$settings" 2>/dev/null
  fi
}

have_uc=0
if has_userconfig yellow-semgrep semgrep_app_token; then have_uc=1; fi

if [ -z "${SEMGREP_APP_TOKEN:-}" ] && [ "$have_uc" = 0 ]; then
  printf 'ERROR: no Semgrep token configured.\n' >&2
  printf '  Option 1 (recommended): /plugin disable yellow-semgrep and\n' >&2
  printf '  re-enable to answer the userConfig prompt (keychain-backed).\n' >&2
  printf '  Option 2 (fallback): export SEMGREP_APP_TOKEN="<your-sgp-token>"\n' >&2
  printf '  in ~/.zshrc or ~/.bashrc, then source it.\n' >&2
  exit 1
fi

if [ "$have_uc" = 1 ] && [ -z "${SEMGREP_APP_TOKEN:-}" ]; then
  printf 'WARNING: MCP has userConfig but shell SEMGREP_APP_TOKEN is unset.\n'
  printf '         /semgrep:fix, /semgrep:status, and this /semgrep:setup\n'
  printf '         curl probe will return 401. Add to your shell profile:\n'
  printf '           export SEMGREP_APP_TOKEN="<your-sgp-token>"\n'
  printf '         Skipping the curl-based connectivity probe since the\n'
  printf '         MCP is the path of record when only userConfig is set.\n'
  printf 'Token format validation: skipped (userConfig-only).\n'
  SKIP_CURL_PROBE=1
else
  SKIP_CURL_PROBE=0
fi
```

If `SEMGREP_APP_TOKEN` **is** set, validate format matches
`^sgp_[a-zA-Z0-9]{20,}$`. Never echo the token value. Redact with
`sed 's/sgp_[a-zA-Z0-9]*/***REDACTED***/g'`.

Hit `GET /api/v1/me` to validate Web API scope — but **only if**
`$SKIP_CURL_PROBE = 0`. Otherwise, report the token as validated via
MCP startup and continue to Step 3. Use the three-layer error check
from the `semgrep-conventions` skill when the probe runs.

```bash
# SKIP_CURL_PROBE default 0 = fail-closed (probe runs when unset).
# If Step 2 detection ran in a separate Bash invocation, the variable
# is unset here; without the default, the probe would silently skip
# and no connectivity check would run.
SKIP_CURL_PROBE="${SKIP_CURL_PROBE:-0}"
SEMGREP_API="https://semgrep.dev/api/v1"

if [ "$SKIP_CURL_PROBE" = 0 ]; then
  response=$(curl -s --connect-timeout 5 --max-time 15 \
    -w "\n%{http_code}" \
    -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
    "${SEMGREP_API}/me")
  curl_exit=$?
  http_status="${response##*$'\n'}"
  body="${response%$'\n'*}"
fi
```

Handle errors per skill patterns:
- curl exit 6/7/28: network failure
- 401: invalid or expired token
- 404: token has CI scope — show: "Token appears to have CI scope. Create a
  new token with **Web API** scope at Organization Settings > API Tokens."
- 200: extract user email from response

### Step 3: Detect Deployment Slug

If `SKIP_CURL_PROBE=1`, skip the REST call entirely:

```bash
# Each Bash block is a fresh subprocess — re-establish the same
# fail-closed default and the API URL used for the curl branch.
SKIP_CURL_PROBE="${SKIP_CURL_PROBE:-0}"
SEMGREP_API="https://semgrep.dev/api/v1"

if [ "$SKIP_CURL_PROBE" = 1 ]; then
  DEPLOYMENT_SLUG=""
  printf '[yellow-semgrep] Deployment slug not detected — only userConfig is set; '
  printf 'add `export SEMGREP_APP_TOKEN=...` to your shell rc if you need REST-API features.\n'
else
  response=$(curl -s --connect-timeout 5 --max-time 15 \
    -w "\n%{http_code}" \
    -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
    "${SEMGREP_API}/deployments")
fi
```

When the curl branch runs, parse the `deployments` array. If empty: "No Semgrep
deployments found for this token."

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
  REPO_NAME=$(printf '%s' "$REMOTE_URL" | sed -E 's/\.git$//' | sed -E 's#.+[:/]([^/]+/[^/]+)$#\1#')
  if ! printf '%s' "$REPO_NAME" | grep -qE '^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$'; then
    printf '[yellow-semgrep] Warning: Could not parse repo name from remote URL.\n' >&2
    REPO_NAME=""
  fi
fi
```

### Step 5: Verify MCP Tools

The MCP server runs via `semgrep mcp` (built into the semgrep binary, v1.146.0+).
Use ToolSearch to discover available Semgrep MCP tools:

Call ToolSearch with query `"+semgrep"` to find all Semgrep MCP tools.

Expected tools (fully qualified):
- `mcp__plugin_yellow-semgrep_semgrep__semgrep_scan`
- `mcp__plugin_yellow-semgrep_semgrep__semgrep_findings`
- `mcp__plugin_yellow-semgrep_semgrep__semgrep_scan_with_custom_rule`
- `mcp__plugin_yellow-semgrep_semgrep__get_abstract_syntax_tree`
- `mcp__plugin_yellow-semgrep_semgrep__semgrep_rule_schema`
- `mcp__plugin_yellow-semgrep_semgrep__get_supported_languages`
- `mcp__plugin_yellow-semgrep_semgrep__semgrep_scan_supply_chain`
- `mcp__plugin_yellow-semgrep_semgrep__semgrep_whoami`

Count discovered tools. If fewer than 2 core tools
(`mcp__plugin_yellow-semgrep_semgrep__semgrep_scan`,
`mcp__plugin_yellow-semgrep_semgrep__semgrep_findings`) are found, diagnose:

- If semgrep version < 1.146.0: "MCP tools require semgrep >= 1.146.0.
  Upgrade with: `pipx upgrade semgrep`"
- Use the same parsed `installed_version` and `version_gte` helper from Step 0.
  Do not use lexicographic string comparison for versions.
- If semgrep version >= 1.146.0: "MCP server failed to start. Verify
  SEMGREP_APP_TOKEN is set and try restarting Claude Code."
- If semgrep not installed: "Install semgrep >= 1.146.0 for MCP support.
  Re-run /semgrep:setup to install."

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

If `SKIP_CURL_PROBE=1` (userConfig-only mode), replace the Deployment line with:

```
Deployment:   not detected (userConfig-only mode — shell SEMGREP_APP_TOKEN unset)
              REST-API features (deployment slug, findings API) are unavailable.
              To enable: add `export SEMGREP_APP_TOKEN="<your-sgp-token>"` to
              ~/.zshrc or ~/.bashrc and re-run /semgrep:setup.
```

If any step had a warning (e.g., no git remote, fewer MCP tools than expected),
list warnings at the bottom.

## Error Handling

| Condition | Message | Action |
|---|---|---|
| `semgrep` not found (Step 0) | AskUserQuestion: install now? | Offer install or show manual instructions |
| `semgrep` below v1.146.0 (Step 0) | AskUserQuestion: upgrade now? | Offer upgrade or warn MCP unavailable |
| Install script fails (Step 0) | "semgrep installation failed" | Warn, continue to Step 1 |
| `curl` or `jq` not found | "Error: {cmd} is required" | Exit |
| `semgrep` not found (Step 1) | "semgrep not installed — scan features limited" | Warn, continue |
| `SEMGREP_APP_TOKEN` not set | "SEMGREP_APP_TOKEN not set" | Exit with setup instructions |
| Token format invalid | "Invalid token format (expected sgp_ prefix)" | Exit |
| 401 on /me | "Invalid or expired token" | Exit |
| 404 on /me | "Token has CI scope, not Web API" | Exit with instructions |
| DNS/network failure | "Cannot reach semgrep.dev" | Exit |
| No deployments | "No deployments found" | Exit |
| No git remote | Warning only — continue | Commands needing repo will prompt |
| MCP tools not found (version ok) | "MCP server failed to start" | Check token, restart Claude Code |
| MCP tools not found (version low) | "Upgrade semgrep >= 1.146.0" | Warn, MCP tools unavailable |
