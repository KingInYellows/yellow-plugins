---
name: devin:setup
description: "Validate Devin V3 credentials and permissions. Use when first installing the plugin, after rotating the service user token, or when other commands return 401 or 403 errors."
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# Set Up Devin V3 Credentials

Validate that `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` are correctly set,
then verify permissions with live API calls (required org-scoped and optional
enterprise-scoped).

## Workflow

### Step 1: Check Prerequisites

Run all prerequisite checks in a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v curl >/dev/null 2>&1 && printf 'curl: ok\n' || printf 'curl: NOT FOUND\n'
command -v jq  >/dev/null 2>&1 && printf 'jq:   ok\n' || printf 'jq:   NOT FOUND\n'

printf '\n=== Credentials ===\n'
# Duplication note: has_userconfig() is intentionally copy-pasted into
# all.md, devin/setup.md, research/setup.md, and semgrep/setup.md — no
# shared-sourceable lib infrastructure exists for command-embedded bash.
# The function is tiny and identical across copies; divergence cost is low.
# Tracked for future centralization; do not extract to a shared lib in this PR.
#
# 2-arg has_userconfig: mirror the canonical definition in
# plugins/yellow-core/commands/setup/all.md. Keep these in sync manually —
# if you change one, change all copies (search for "has_userconfig()" across
# plugins/). `grep -qF` (fixed-string) fallback guards against regex
# metacharacters; jq path is preferred and path-scoped.
has_userconfig() {
  local plugin="$1" option="$2" jq_exit
  local settings="${HOME}/.claude/settings.json"
  [ -r "$settings" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -e --arg p "$plugin" --arg o "$option" \
      '.pluginConfigs[$p].options[$o] // empty' \
      "$settings" >/dev/null 2>/dev/null
    jq_exit=$?
    # exit 0 = key present; 1 = key absent; >=2 = parse error (warn).
    if [ "$jq_exit" -ge 2 ]; then
      printf '[has_userconfig] Warning: jq could not parse %s (exit %d)\n' \
        "$settings" "$jq_exit" >&2
    fi
    return "$jq_exit"
  else
    printf '[has_userconfig] Warning: jq not installed; using fixed-string grep fallback (may produce false positives across pluginConfigs)\n' >&2
    grep -qF "\"$plugin\"" "$settings" 2>/dev/null \
      && grep -qF "\"$option\"" "$settings" 2>/dev/null
  fi
}

if [ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ]; then
  TOKEN_SRC=shell
  printf '%-28s set (shell env)\n' 'DEVIN_SERVICE_USER_TOKEN:'
elif has_userconfig yellow-devin devin_service_user_token; then
  TOKEN_SRC=userconfig
  printf '%-28s set (userConfig, keychain)\n' 'DEVIN_SERVICE_USER_TOKEN:'
else
  TOKEN_SRC=none
  printf '%-28s NOT SET\n' 'DEVIN_SERVICE_USER_TOKEN:'
fi
if [ -n "${DEVIN_ORG_ID:-}" ]; then
  ORG_SRC=shell
  printf '%-28s set (shell env)\n' 'DEVIN_ORG_ID:'
elif has_userconfig yellow-devin devin_org_id; then
  ORG_SRC=userconfig
  printf '%-28s set (userConfig)\n' 'DEVIN_ORG_ID:'
else
  ORG_SRC=none
  printf '%-28s NOT SET\n' 'DEVIN_ORG_ID:'
fi

# Dual-source drift warnings: /devin:* commands invoke curl with shell env.
# If only userConfig is set, Claude Code prompted for the credential at plugin
# enable and stored it in the keychain, but the curl commands will fail
# because they read shell env vars which are empty.
if [ "$TOKEN_SRC" = userconfig ] && [ -z "${DEVIN_SERVICE_USER_TOKEN:-}" ]; then
  printf '\nWARNING: userConfig is set but shell DEVIN_SERVICE_USER_TOKEN is unset.\n'
  printf '         /devin:* commands use curl directly and will return 401 until\n'
  printf '         you also add:\n'
  printf '           export DEVIN_SERVICE_USER_TOKEN="<your-cog-token>"\n'
  printf '         to ~/.zshrc or ~/.bashrc.\n'
fi
if [ "$ORG_SRC" = userconfig ] && [ -z "${DEVIN_ORG_ID:-}" ]; then
  printf '\nWARNING: userConfig is set but shell DEVIN_ORG_ID is unset.\n'
  printf '         /devin:* commands use curl directly and will fail until\n'
  printf '         you also add:\n'
  printf '           export DEVIN_ORG_ID="<your-org-id>"\n'
  printf '         to ~/.zshrc or ~/.bashrc.\n'
fi
```

If **any** of the following are true, report **all** that apply and stop (do not
continue to Step 2):

- `curl` not found: "curl is required. Install via your system package manager."
- `jq` not found: "jq is required. Install from [jqlang.github.io](https://jqlang.github.io/jq/download/)"
- Neither shell env var nor userConfig set for `DEVIN_SERVICE_USER_TOKEN`:
  show the Setup Instructions block below.
- Neither shell env var nor userConfig set for `DEVIN_ORG_ID`: show the
  Setup Instructions block below.

Note: shell env vars take precedence over userConfig for command invocations
(curl calls in Steps 3-4 read `$DEVIN_SERVICE_USER_TOKEN` and `$DEVIN_ORG_ID`
directly). Configuring userConfig alone is sufficient for Claude Code to prompt
the user at plugin-enable time and prevents the "missing env var" failure on
fresh installs. When only userConfig is present (no shell env var), Step 2
skips shell-side format validation (format was already validated at plugin
enable) and Steps 3-4 skip the live API curl probes (MCP tool visibility is
the credential validation signal instead). Users who want curl-based probes
must also export the shell env var.

If all pass, continue to Step 2.

### Step 2: Validate Token Format

`TOKEN_SRC` and `ORG_SRC` are shell-local variables set in the Step 1 block.
Each ```bash``` block runs in a fresh subprocess, so by default these
variables will be unset here. **Run Steps 1 and 2 in the same Bash
invocation** so the source classification carries over. If you must split
them (e.g., re-running Step 2 after fixing a credential), re-detect the
source by repeating the Step 1 logic at the top of the Step 2 block.

```bash
# Re-define has_userconfig() in case Step 2 runs in a fresh Bash subprocess
# separate from Step 1 — each Bash tool call is a new shell, and the function
# definition from Step 1 does not survive across blocks. Mirror of the
# canonical definition above; if you change one, change all copies.
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
    printf '[has_userconfig] Warning: jq not installed; using fixed-string grep fallback (may produce false positives across pluginConfigs)\n' >&2
    grep -qF "\"$plugin\"" "$settings" 2>/dev/null \
      && grep -qF "\"$option\"" "$settings" 2>/dev/null
  fi
}

# Re-detect TOKEN_SRC / ORG_SRC if they were not carried from Step 1.
# Sentinel "unknown" disambiguates "missing" from a legitimate "shell"/"userconfig"
# detection result, so the validator can produce a precise diagnostic instead
# of falsely reporting "format invalid" on an empty shell var.
TOKEN_SRC="${TOKEN_SRC:-unknown}"
ORG_SRC="${ORG_SRC:-unknown}"

if [ "$TOKEN_SRC" = unknown ]; then
  if [ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ]; then
    TOKEN_SRC=shell
  elif has_userconfig yellow-devin devin_service_user_token; then
    TOKEN_SRC=userconfig
  else
    printf 'ERROR: TOKEN_SRC could not be re-detected and no credential source found.\n' >&2
    printf '       Run Steps 1 and 2 in the same Bash invocation, or set\n' >&2
    printf '       DEVIN_SERVICE_USER_TOKEN in your shell first.\n' >&2
    exit 1
  fi
fi
if [ "$ORG_SRC" = unknown ]; then
  if [ -n "${DEVIN_ORG_ID:-}" ]; then
    ORG_SRC=shell
  elif has_userconfig yellow-devin devin_org_id; then
    ORG_SRC=userconfig
  else
    ORG_SRC=none
  fi
fi

if [ "$TOKEN_SRC" = shell ]; then
  token="${DEVIN_SERVICE_USER_TOKEN:-}"

  if printf '%s' "$token" | grep -qE '^apk_'; then
    printf 'ERROR: V1 API key detected (apk_ prefix).\n'
    printf 'V3 requires a service user token (cog_ prefix).\n'
    printf 'Migration:\n'
    printf '  1. Go to Enterprise Settings > Service Users\n'
    printf '  2. Create a new service user with UseDevinSessions + ViewOrgSessions + ManageOrgSessions\n'
    printf '  3. export DEVIN_SERVICE_USER_TOKEN="cog_your_new_token"\n'
    printf '  4. Remove the old DEVIN_API_TOKEN export\n'
    exit 1
  fi

  if ! printf '%s' "$token" | grep -qE '^cog_[a-zA-Z0-9_-]{20,128}$'; then
    printf 'ERROR: DEVIN_SERVICE_USER_TOKEN format invalid.\n'
    printf 'Expected: cog_ followed by 20-128 alphanumeric/dash/underscore characters.\n'
    printf 'Check Enterprise Settings > Service Users for the correct token.\n'
    exit 1
  fi

  printf '%-18s valid (cog_ prefix confirmed, length ok)\n' 'Token format:'
else
  # TOKEN_SRC=userconfig: format was validated at plugin enable time (keychain).
  # Shell var is empty — skip shell-side format check to avoid false "format invalid".
  printf '%-18s stored in userConfig (Claude Code keychain) — format already validated\n' \
    'DEVIN_SERVICE_USER_TOKEN:'
  printf '%-18s at plugin enable. Skipping shell-side format check.\n' ''
fi
```

Never echo the token value in any output. Only describe format mismatches.

If the Bash call exits non-zero (apk_ detected or invalid cog_ format), stop
here — display the error message above and do not proceed to Step 3.

Then validate `DEVIN_ORG_ID` in the same Bash call (so `ORG_SRC` is in scope):

```bash
if [ "$ORG_SRC" = shell ]; then
  org="${DEVIN_ORG_ID:-}"

  if ! printf '%s' "$org" | grep -qE '^[a-zA-Z0-9_-]{4,64}$'; then
    printf 'ERROR: DEVIN_ORG_ID format invalid.\n'
    printf 'Expected: 4-64 alphanumeric/dash/underscore characters.\n'
    printf 'Find your Org ID at Enterprise Settings > Organizations.\n'
    exit 1
  fi

  printf '%-18s valid (%s)\n' 'Org ID format:' "$org"
else
  # ORG_SRC=userconfig: stored in keychain, shell var is empty — skip format check.
  printf '%-18s stored in userConfig (Claude Code keychain) — skipping shell-side format check.\n' \
    'DEVIN_ORG_ID:'
fi
```

If the Bash call exits non-zero (invalid org ID format), stop here — display
the error message above and do not proceed to Step 3.

### Step 3: Probe Org-Scoped Permissions

**Skip guard:** If both `TOKEN_SRC` and `ORG_SRC` were `userconfig` in Step 1
(no shell env vars set), skip Steps 3–4 entirely and proceed to Step 5.
Print: "Skipping live API probes — credentials are in userConfig only (no shell
env vars). MCP tool visibility is the credential validation signal. To enable
curl-based permission probes, also export DEVIN_SERVICE_USER_TOKEN and
DEVIN_ORG_ID in your shell profile." Record all permissions as UNKNOWN in the
Step 5 table.

Probe the org-scoped API to check `ViewOrgSessions` (list) and
`ManageOrgSessions` (message).

```bash
DEVIN_API_BASE="https://api.devin.ai/v3"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

printf '\n=== Permission Checks ===\n'
printf 'Probing ViewOrgSessions (list)...\n'

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions?first=1" \
  -H "Authorization: Bearer ${DEVIN_SERVICE_USER_TOKEN}")
curl_exit=$?
http_status=${response##*$'\n'}
body=${response%$'\n'*}
```

Outcome mapping:

- **curl non-zero exit:**
  - Exit 6: "Could not resolve api.devin.ai — check DNS or internet connectivity." Stop.
  - Exit 7: "Could not connect to Devin API — the API may be temporarily down." Stop.
  - Exit 28: "Request timed out — check network connectivity and try again." Stop.
  - Other: "Network error (curl exit $curl_exit)." Stop.
- **HTTP 200:** `ViewOrgSessions` confirmed. Record as PASS. Verify response
  uses `items` array (not `sessions`).
- **HTTP 401:** "Authentication failed (401). DEVIN_SERVICE_USER_TOKEN was rejected. Rotate the token at Enterprise Settings > Service Users." Stop immediately.
- **HTTP 403:** Record `ViewOrgSessions` as MISSING. Continue to collect all
  permission failures before reporting.
- **HTTP 404:** "Organization not found (404). Verify DEVIN_ORG_ID matches the ID shown at Enterprise Settings > Organizations." Stop.
- **HTTP 5xx:** "Devin API server error ($http_status). Try again in a few minutes." Stop.
- **Other:** "Unexpected HTTP status $http_status." Redact and show first 200 chars of body:
  `printf '%s' "$body" | sed 's/\(cog\|apk\)_[a-zA-Z0-9_-]*/***REDACTED***/g' | head -c 200`
  Stop.

All error output must sanitize tokens:
`sed 's/\(cog\|apk\)_[a-zA-Z0-9_-]*/***REDACTED***/g'`

Never use `curl -v`, `--trace`, or `--trace-ascii` — they leak auth headers.

### Step 3b: Probe ManageOrgSessions

If Step 3 returned HTTP 403 (ViewOrgSessions MISSING), skip this step —
ManageOrgSessions requires ViewOrgSessions as a prerequisite.

If Step 3 returned HTTP 200 (ViewOrgSessions PASS), probe ManageOrgSessions by
POSTing a message to a known-invalid session ID. The API checks permissions
before resource existence, so 403 means the permission is missing while 404/422
means it's present (the session doesn't exist but the permission check passed).

```bash
DEVIN_API_BASE="https://api.devin.ai/v3"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

# Probe ManageOrgSessions by sending to a dummy session ID
# Note: Devin API (FastAPI) checks RBAC before resource existence — empirically
# validated as of 2026-03. This is undocumented behavior; if probe returns
# unexpected results, the "Other" outcome treats them as UNKNOWN.
printf 'Probing ManageOrgSessions (message)...\n'
dummy_session="00000000000000000000000000000000"
response=$(jq -n --arg msg "probe" '{message: $msg}' | \
  curl -s --connect-timeout 5 --max-time 10 \
    -w "\n%{http_code}" \
    -X POST "${ORG_URL}/sessions/${dummy_session}/messages" \
    -H "Authorization: Bearer ${DEVIN_SERVICE_USER_TOKEN}" \
    -H "Content-Type: application/json" \
    -d @-)
curl_exit=$?
http_status=${response##*$'\n'}
body=${response%$'\n'*}
```

Outcome mapping:

- **curl non-zero exit:** Same as Step 3. Stop.
- **HTTP 404 or 422:** `ManageOrgSessions` confirmed (PASS). The session doesn't
  exist but the permission check passed.
- **HTTP 401:** "Authentication failed (401). Token rejected." Stop immediately.
- **HTTP 403:** Record `ManageOrgSessions` as MISSING. Continue to collect all
  permission failures before reporting.
- **HTTP 5xx:** "Devin API server error ($http_status). Try again later." Stop.
- **Other:** Record as UNKNOWN. Redact and show first 200 chars of body:
  `printf '%s' "$body" | sed 's/\(cog\|apk\)_[a-zA-Z0-9_-]*/***REDACTED***/g' | head -c 200`
  Continue to Step 4.

### Step 4: Probe ViewAccountSessions (Optional)

Make a read-only call to the enterprise sessions endpoint. This permission is
optional — the plugin works without it (org-scoped messaging is preferred).

```bash
DEVIN_API_BASE="https://api.devin.ai/v3"
printf 'Probing ViewAccountSessions (enterprise list)...\n'

org_param=$(jq -rn --arg o "${DEVIN_ORG_ID}" '@uri "\($o)"')
if [ $? -ne 0 ] || [ -z "$org_param" ]; then
  printf 'ERROR: jq failed — cannot URL-encode DEVIN_ORG_ID. Ensure jq is installed.\n'
  exit 1
fi

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${DEVIN_API_BASE}/enterprise/sessions?org_ids=${org_param}&first=1" \
  -H "Authorization: Bearer ${DEVIN_SERVICE_USER_TOKEN}")
curl_exit=$?
http_status=${response##*$'\n'}
body=${response%$'\n'*}
```

Outcome mapping:

- **curl non-zero exit:** Same as Step 3. Stop.
- **HTTP 200:** Enterprise endpoint accessible (`ViewAccountSessions` confirmed).
  Record as PASS.
- **HTTP 401:** "Authentication failed (401). Token rejected." Stop immediately.
- **HTTP 403:** Record `ViewAccountSessions` as MISSING. Continue to Step 5.
  This is not a critical failure — org-scoped messaging works without it.
- **HTTP 404:** "Enterprise sessions endpoint not found (404)." Stop.
- **HTTP 5xx:** "Devin API server error ($http_status). Try again later." Stop.
- **Other:** "Unexpected HTTP status $http_status." Redact body. Stop.

### Step 5: Report Results

Collect results from Steps 3, 3b, and 4 and display a unified status table:

```text
Devin V3 Setup Check
====================

Prerequisites
  curl                         OK
  jq                           OK

Credentials
  DEVIN_SERVICE_USER_TOKEN     OK  (cog_ format confirmed, token not echoed)
  DEVIN_ORG_ID                 OK  ([DEVIN_ORG_ID value])

Permissions (required — org-scoped)
  ViewOrgSessions (list)       [OK | MISSING]
  ManageOrgSessions (message)  [OK | MISSING | UNKNOWN]

Permissions (optional — enterprise-scoped)
  ViewAccountSessions          [OK | MISSING]

Overall: [PASS | PARTIAL | FAIL]
```

**Note:** `UseDevinSessions` (create) cannot be probed non-destructively. If
the list endpoint (ViewOrgSessions) passes, create is typically also granted. If
session creation later fails with 403, the user should verify this permission.

**If ViewOrgSessions is MISSING**, display:

```text
Required permission ViewOrgSessions is missing.

To fix:
  1. Go to Enterprise Settings > Service Users in the Devin web app
  2. Select your service user
  3. Grant these org-scoped permissions:
       UseDevinSessions    — Create sessions
       ViewOrgSessions     — List and get sessions
       ManageOrgSessions   — Send messages, terminate, archive
  4. Re-run /devin:setup to verify
```

**If ViewOrgSessions is OK but ManageOrgSessions is MISSING**, display:

```text
Overall: PARTIAL PASS

ManageOrgSessions is missing — session messaging, cancellation, and archival
will fail with 403. Session listing and creation work normally.

A PR comment fallback is available: review feedback can be posted as GitHub PR
comments with @devin prefix instead of using the API message endpoint.

To fix:
  1. Go to Enterprise Settings > Service Users in the Devin web app
  2. Select your service user
  3. Grant: ManageOrgSessions — Send messages, terminate, archive
  4. Re-run /devin:setup to verify
```

**If ViewOrgSessions is OK but ViewAccountSessions is MISSING**, display:

```text
Overall: PARTIAL PASS

ViewAccountSessions is missing — enterprise-scope session listing unavailable.
Org-scoped messaging (the primary path) will still work as normal.

Note: ManageAccountSessions (enterprise-scope messaging) cannot be probed
non-destructively. If enterprise messaging fails with 403 later, grant it at
Enterprise Settings > Service Users.

To enable enterprise-scope features:
  1. Go to Enterprise Settings > Service Users
  2. Grant: ViewAccountSessions — Enterprise-scope session listing
  3. Grant: ManageAccountSessions — Enterprise-scope messaging (optional)
  4. Re-run /devin:setup to verify
```

**If all checks pass**, display:

```text
All checks passed. The yellow-devin plugin is ready to use.

Next steps:
  /devin:delegate — Delegate a task to Devin
  /devin:status   — List recent sessions
  /devin:wiki     — Query repository documentation
```

Then ask via AskUserQuestion: "What would you like to do next?" with options:
`/devin:delegate`, `/devin:status`, `/devin:wiki`, `Done`.

## Setup Instructions

Show this block when `DEVIN_SERVICE_USER_TOKEN` or `DEVIN_ORG_ID` is not set:

```text
DEVIN_SERVICE_USER_TOKEN and/or DEVIN_ORG_ID are not set.

To configure:
  1. Create a service user:
       Enterprise Settings > Service Users > Create new user
       Required permissions:
         - UseDevinSessions
         - ViewOrgSessions
         - ManageOrgSessions
       Optional permissions:
         - ViewAccountSessions
         - ManageAccountSessions
       Token format: cog_<...>

  2. Find your Org ID:
       Enterprise Settings > Organizations

  3. Add to your shell profile (~/.zshrc or ~/.bashrc):
       export DEVIN_SERVICE_USER_TOKEN="cog_your_token_here"
       export DEVIN_ORG_ID="your-org-id"

  4. Reload your shell profile:
       source ~/.zshrc   (or ~/.bashrc)

  5. Restart Claude Code and re-run /devin:setup

Never commit tokens to version control.
```

## Error Handling

| Error | Message | Action |
|---|---|---|
| `curl` not found | "curl is required. Install via system package manager." | Stop |
| `jq` not found | "jq is required. Install from [jqlang.github.io](https://jqlang.github.io/jq/download/)" | Stop |
| Token not set | Show Setup Instructions block | Stop |
| Org ID not set | Show Setup Instructions block | Stop |
| `apk_` token detected | Show V1→V3 migration steps | Stop |
| Token format invalid | "Expected: cog_ + 20-128 alphanumeric/dash/underscore chars" | Stop |
| Org ID format invalid | "Expected: 4-64 alphanumeric/dash/underscore chars" | Stop |
| curl exit 6 | "Could not resolve api.devin.ai — check DNS/internet" | Stop |
| curl exit 7 | "Could not connect to Devin API" | Stop |
| curl exit 28 | "Request timed out" | Stop |
| curl exit other | "Network error (curl exit N)" | Stop |
| HTTP 401 | "Token rejected. Rotate at Enterprise Settings > Service Users." | Stop |
| HTTP 403 | Record permission as MISSING, continue to next check | Collect |
| HTTP 404 | "Org not found. Verify DEVIN_ORG_ID." | Stop |
| HTTP 404/422 (Step 3b) | ManageOrgSessions confirmed (permission present) | Record PASS |
| HTTP 5xx | "Devin API server error. Try again later." | Stop |
| Other HTTP status | "Unexpected HTTP status N." + redacted body preview | Stop |
| jq exit non-zero (Step 4) | "jq failed — cannot URL-encode DEVIN_ORG_ID." | Stop |

See `devin-workflows` skill for token sanitization patterns and curl error
handling conventions.
