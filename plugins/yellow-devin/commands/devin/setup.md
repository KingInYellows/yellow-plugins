---
name: devin:setup
description: "Validate Devin V3 credentials and permissions. Use when first installing the plugin, after rotating the service user token, or when other commands return 401 or 403 errors."
argument-hint: ''
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
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

printf '\n=== Environment ===\n'
[ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ] && printf '%-28s set\n' 'DEVIN_SERVICE_USER_TOKEN:' || printf '%-28s NOT SET\n' 'DEVIN_SERVICE_USER_TOKEN:'
[ -n "${DEVIN_ORG_ID:-}" ]            && printf '%-28s set\n' 'DEVIN_ORG_ID:' || printf '%-28s NOT SET\n' 'DEVIN_ORG_ID:'
```

If **any** of the following are true, report **all** that apply and stop (do not
continue to Step 2):

- `curl` not found: "curl is required. Install via your system package manager."
- `jq` not found: "jq is required. Install from [jqlang.github.io](https://jqlang.github.io/jq/download/)"
- `DEVIN_SERVICE_USER_TOKEN` not set: show the Setup Instructions block below.
- `DEVIN_ORG_ID` not set: show the Setup Instructions block below.

If all pass, continue to Step 2.

### Step 2: Validate Token Format

```bash
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
```

Never echo the token value in any output. Only describe format mismatches.

If the Bash call exits non-zero (apk_ detected or invalid cog_ format), stop
here — display the error message above and do not proceed to Step 3.

Then validate `DEVIN_ORG_ID`:

```bash
org="${DEVIN_ORG_ID:-}"

if ! printf '%s' "$org" | grep -qE '^[a-zA-Z0-9_-]{4,64}$'; then
  printf 'ERROR: DEVIN_ORG_ID format invalid.\n'
  printf 'Expected: 4-64 alphanumeric/dash/underscore characters.\n'
  printf 'Find your Org ID at Enterprise Settings > Organizations.\n'
  exit 1
fi

printf '%-18s valid (%s)\n' 'Org ID format:' "$org"
```

If the Bash call exits non-zero (invalid org ID format), stop here — display
the error message above and do not proceed to Step 3.

### Step 3: Probe Org-Scoped Permissions

Probe the org-scoped API to check `ViewOrgSessions` (list). `UseDevinSessions`
and `ManageOrgSessions` cannot be probed non-destructively — they are assumed
granted alongside `ViewOrgSessions`.

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

Collect results from Steps 3 and 4 and display a unified status table:

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

Permissions (optional — enterprise-scoped)
  ViewAccountSessions          [OK | MISSING]

Overall: [PASS | PARTIAL | FAIL]
```

**Note:** `UseDevinSessions` (create) and `ManageOrgSessions` (message/terminate/
archive) cannot be probed non-destructively. If the list endpoint (ViewOrgSessions)
passes, the other org permissions are typically also granted. If session creation
or archival later fails with 403, the user should verify these permissions.

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
| HTTP 5xx | "Devin API server error. Try again later." | Stop |
| Other HTTP status | "Unexpected HTTP status N." + redacted body preview | Stop |
| jq exit non-zero (Step 4) | "jq failed — cannot URL-encode DEVIN_ORG_ID." | Stop |

See `devin-workflows` skill for token sanitization patterns and curl error
handling conventions.
