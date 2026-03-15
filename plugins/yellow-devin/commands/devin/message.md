---
name: devin:message
description: Send a follow-up message to an active Devin session. Use when user wants to give Devin additional context, says "tell Devin to...", "update Devin", or "send message to session".
argument-hint: '<session-id> <message>'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Send Message to Devin Session

Send a follow-up message to provide additional context, instructions, or course
corrections to a Devin session.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` are set. Check `jq` is
available. See `devin-workflows` skill for validation functions.

### Step 2: Parse Arguments

Parse `$ARGUMENTS`:

- First token is the session ID
- Remaining text is the message

If session ID or message is missing, prompt via AskUserQuestion.

### Step 3: Validate Inputs

- **Session ID:** Validate with `validate_session_id` from `devin-workflows`
  skill — `^[a-zA-Z0-9_-]{8,64}$`
- **Message:** Max 2000 characters. On overflow, report actual count vs maximum
  — never truncate.

### Step 4: Verify Session State (C1 Validation)

Fetch session status using the org-scoped **list** endpoint with `session_ids`
filter (see Session Lookup Pattern in `devin-workflows` skill):

```bash
DEVIN_API_BASE="https://api.devin.ai/v3"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions?session_ids=${SESSION_ID}&first=1" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Parse from `items` array: `jq '.items[0]'`. If the result is null or the array
is empty, report "Session not found."

Check session status against messageable states:

**Messageable states:**

- `running` — proceed normally
- `suspended` — inform user: "Session is suspended. Sending a message will
  auto-resume it." Then proceed.

**Not messageable:**

- `resuming` — report: "Session is resuming. Wait a moment and try again, or
  use `/devin:status {id}` to check."
- `new`, `claimed` — report: "Session is {status} — waiting to start. Try again
  shortly or use `/devin:status` to monitor."
- `exit`, `error` (terminal) — report: "Session is {status} — cannot send
  messages to a completed session."

### Step 5: Send Message

Construct JSON via `jq` and POST. Try the **org-scoped** endpoint first (requires
`ManageOrgSessions`); if it returns 403, fall back to the **enterprise** endpoint
(requires `ManageAccountSessions`):

```bash
# Try org-scoped endpoint first
response=$(jq -n --arg msg "$MESSAGE" '{message: $msg}' | \
  curl -s --connect-timeout 5 --max-time 30 \
    -w "\n%{http_code}" \
    -X POST "${ORG_URL}/sessions/${SESSION_ID}/messages" \
    -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-)
curl_exit=$?
http_status=${response##*$'\n'}
body=${response%$'\n'*}

# Fall back to enterprise endpoint on 403
if [ "$curl_exit" -eq 0 ] && [ "$http_status" = "403" ]; then
  printf 'WARN: Org-scoped message endpoint returned 403, trying enterprise scope...\n' >&2
  ENTERPRISE_URL="${DEVIN_API_BASE}/enterprise"
  response=$(jq -n --arg msg "$MESSAGE" '{message: $msg}' | \
    curl -s --connect-timeout 5 --max-time 30 \
      -w "\n%{http_code}" \
      -X POST "${ENTERPRISE_URL}/sessions/${SESSION_ID}/messages" \
      -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
      -H "Content-Type: application/json" \
      -d @-)
  curl_exit=$?
  http_status=${response##*$'\n'}
  body=${response%$'\n'*}
fi
```

**Never use the `message_as_user_id` field** — impersonation risk.

Check curl exit code, HTTP status, jq parse — see `devin-workflows` skill.

### Step 5b: PR Comment Fallback (on 403)

If both org-scoped and enterprise endpoints returned 403, offer to post the
message as a PR comment instead. Devin automatically responds to PR comments
as long as the session is not archived.

1. **Check `gh` availability inline:**

   ```bash
   if ! command -v gh >/dev/null 2>&1; then
     printf 'gh CLI not found — PR comment fallback unavailable.\n'
     # Fall through to standard error reporting
   elif ! gh auth status >/dev/null 2>&1; then
     printf 'gh not authenticated — run `gh auth login` to enable PR comment fallback.\n'
     # Fall through to standard error reporting
   fi
   ```

   If `gh` is not available or not authenticated, skip the PR comment
   fallback and report the 403 error with a note to run `/devin:setup`.

2. **Detect current repo:**

   ```bash
   REPO_SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
   ```

   If `REPO_SLUG` is empty, skip the PR comment fallback — cannot determine
   the current repo.

3. **Extract PRs from session data** (already fetched in Step 4):

   Parse `pull_requests` from the session response. Filter for PRs matching
   the current repo (`REPO_SLUG`). Extract PR number from the PR URL.

4. **Offer fallback via AskUserQuestion:**

   If matching PRs exist:

   ```text
   API message failed (403 — ManageOrgSessions may be missing).

   This session has PR #N in this repo. Devin monitors PR comments
   and will pick up instructions posted there.

   Options:
   - Comment on PR — Post as PR comment with @devin prefix
   - Run /devin:setup — Check and fix permissions
   - Cancel
   ```

   If no matching PRs: skip the fallback, show the 403 error with a note to
   run `/devin:setup`.

5. **Post comment if chosen:**

   **Check archived status first:** If the session's `is_archived` field is
   true, warn in the AskUserQuestion prompt: "Session {id} is archived — Devin
   will not respond to PR comments for archived sessions." Change the option
   label to "Comment on PR anyway — for documentation purposes".

   Compose with `@devin` prefix first, then sanitize before posting (prevent
   `cog_` and `apk_` token leakage):

   ```bash
   COMMENT_BODY="@devin ${MESSAGE}"
   SAFE_BODY=$(printf '%s' "$COMMENT_BODY" | sed 's/\(cog\|apk\)_[a-zA-Z0-9_-]*/***REDACTED***/g')
   gh pr comment "$PR_NUMBER" --repo "$REPO_SLUG" --body "$SAFE_BODY"
   ```

   `@devin` must be at the very start of the comment body (prefix match for
   mention-only filtering). The comment posts as the authenticated GitHub user,
   which Devin responds to by default. The message is already bounded by the
   2000-char input validation in Step 3, so no additional truncation is needed.

   Check the exit code of `gh pr comment`. If non-zero, report the error:
   "Failed to post PR comment: {error}. Check `gh auth status` and repo
   permissions." Do not proceed to step 6.

6. **Report result** (only on success): "Message posted as comment on PR #N.
   Devin will pick up the instructions automatically."

### Step 6: Report

Display confirmation with updated session status from the response.

If the session was `suspended` and is now `resuming`:

- "Message sent. Session is resuming from suspended state."
- Suggest: "Use `/devin:status {id}` to check when it's running."

Otherwise:

- "Message sent to session {id}."
- Show current status.
- Suggest: "Use `/devin:status {id}` to check progress."

## Error Handling

See `devin-workflows` skill for error handling patterns. All error output must
sanitize tokens.
