# Feature: Fix Devin Message 403 + PR Comment Fallback

> **Status: Implemented (PR #216, merged)** —
> `Step 3b: Probe ManageOrgSessions` shipped in
> `plugins/yellow-devin/commands/devin/setup.md:136`. `gh pr comment`
> PR-comment fallback shipped in `message.md` and `review-prs.md`.

## Problem Statement

The `/devin:review-prs` and `/devin:message` commands fail with 403 on both
org-scoped and enterprise message endpoints. The service user token has
`ViewOrgSessions` and `UseDevinSessions` but lacks `ManageOrgSessions`.

**Why this isn't caught earlier:** `/devin:setup` (Step 3, line 94-96) explicitly
notes that `ManageOrgSessions` "cannot be probed non-destructively" and assumes
it's granted if `ViewOrgSessions` passes. This assumption is wrong — the
permissions are independently grantable.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — `setup.md` lines 94-96 read: *"UseDevinSessions and
> ManageOrgSessions cannot be probed non-destructively — they are assumed granted
> alongside ViewOrgSessions."* All line references in this plan have been
> verified accurate against the current source.
<!-- /deepen-plan -->

**User impact:** The "Message Devin" remediation path in `review-prs` is
completely broken when the permission is missing. There is no fallback — the user
gets an error and must switch to "Fix locally" or "Skip".

## Current State

- `setup.md` only probes `ViewOrgSessions` (read-only list call) and
  `ViewAccountSessions` (enterprise read-only list). `ManageOrgSessions` is
  assumed but never verified.
- `message.md` and `review-prs.md` both try org-scoped POST, fall back to
  enterprise POST on 403, then report failure with no alternative.
- No PR comment fallback exists anywhere in the plugin — `gh pr comment` is
  never used.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — `gh pr comment` is not used anywhere across all
> plugins. The closest patterns are `yellow-review` scripts using `gh api graphql`
> for reading/resolving PR threads. The plan introduces a novel pattern.
<!-- /deepen-plan -->

## Proposed Solution

Two complementary fixes:

1. **Probe `ManageOrgSessions` in setup** by POSTing a message to a known-bad
   session ID. The API returns 404 (session not found) or 422 (validation) if the
   permission is present, and 403 if it's missing. This is non-destructive — no
   session is modified.

<!-- deepen-plan: external -->
> **Research:** The Devin V3 API uses FastAPI/Starlette (evidenced by
> `HTTPValidationError` in their OpenAPI spec). Standard middleware ordering means
> RBAC permission checks run **before** resource existence checks. This confirms
> the probe logic: 403 = permission missing (checked first), 404 = permission
> present but session not found (checked second). Confidence: high (80-90%).
> Add a code comment noting this is empirically validated. If the API ever
> changes to check existence first, the probe would give false positives — but
> that would be a non-standard API change.
> See: [Devin API Auth](https://docs.devin.ai/api-reference/authentication.md),
> [Devin API Overview](https://docs.devin.ai/api-reference/overview.md)
<!-- /deepen-plan -->

1. **Add PR comment fallback** when API messaging fails. Devin automatically
   responds to PR comments as long as the session hasn't been archived (per
   [Devin docs](https://docs.devin.ai/integrations/gh)). Comments prefixed with
   `@devin` ensure delivery even when mention-only filtering is enabled.

<!-- deepen-plan: external -->
> **Research:** Devin's PR comment response is gated by **session archival**, not
> PR state (open/closed). From docs: *"Devin automatically responds to PR
> comments as long as the session has not been archived."* For mention-only mode,
> `@devin` must be at the **start** of the comment (prefix match, not contains).
> The bot comment filter only applies to bot-authored comments — `gh pr comment`
> posts as the human GitHub user, so the bot filter is bypassed entirely.
> See: [Devin Bot Comment Settings](https://docs.devin.ai/product-guides/bot-comment-settings.md)
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Setup Permission Probe

- [x] **1.1: Add Step 3b to `setup.md` — probe ManageOrgSessions**

  File: `plugins/yellow-devin/commands/devin/setup.md`

  After the existing Step 3 (ViewOrgSessions probe), add a new sub-step that
  probes message-send permission:

  ```bash
  # Probe ManageOrgSessions by sending to a dummy session ID
  # 404 or 422 = permission present, 403 = permission missing
  # Note: Devin API (FastAPI) checks RBAC before resource existence — empirically validated
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
  - HTTP 404 or 422: `ManageOrgSessions` confirmed (PASS). The session doesn't
    exist but the permission check passed.
  - HTTP 403: Record `ManageOrgSessions` as MISSING. Continue to collect.
  - HTTP 401: Token rejected entirely — stop.
  - curl non-zero: Network error — stop.

<!-- deepen-plan: codebase -->
> **Codebase:** The dummy session ID `00000000000000000000000000000000` (32 chars)
> passes the existing `validate_session_id` regex `^[a-zA-Z0-9_-]{8,64}$`. Add a
> catch-all for unexpected HTTP status codes (e.g., 400) — record as UNKNOWN with
> a redacted body preview rather than silently ignoring.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Rate limiting is not a concern for the probe — Devin documents 429
> as a possible response but does not publish specific limits. A single POST per
> setup run will not trigger rate limiting even at aggressive thresholds.
<!-- /deepen-plan -->

- [x] **1.2: Update Step 5 report table to show ManageOrgSessions status**

  Add a row to the "Permissions (required)" section:

  ```text
  Permissions (required — org-scoped)
    ViewOrgSessions (list)       [OK | MISSING]
    ManageOrgSessions (message)  [OK | MISSING]
  ```

- [x] **1.3: Add ManageOrgSessions-specific remediation guidance**

  When `ViewOrgSessions` is OK but `ManageOrgSessions` is MISSING:

  ```text
  Overall: PARTIAL PASS

  ManageOrgSessions is missing — session messaging, cancellation, and archival
  will fail with 403. Session listing and creation work normally.

  To fix:
    1. Go to Enterprise Settings > Service Users in the Devin web app
    2. Select your service user
    3. Grant: ManageOrgSessions — Send messages, terminate, archive
    4. Re-run /devin:setup to verify
  ```

  When both are MISSING, merge into the existing combined remediation block.

- [x] **1.4: Remove the stale assumption comment**

  Delete or rewrite `setup.md` lines 94-96 that say ManageOrgSessions "cannot be
  probed non-destructively". It can now, via the dummy-session POST.

### Phase 2: PR Comment Fallback in message.md

- [x] **2.1: Add PR-aware fallback after 403 failure in `message.md`**

  File: `plugins/yellow-devin/commands/devin/message.md`

  After the existing enterprise 403 fallback (line 107), when both endpoints
  return 403, check if the session has associated PRs. If so, offer a PR comment
  fallback:

  **Logic flow:**
  1. After both org and enterprise return 403, fetch session details via the list
     endpoint (which uses `ViewOrgSessions` — known to work).
  1. Extract `pull_requests` array from the session response.
  1. If PRs exist in the current repo, offer via AskUserQuestion:
     ```text
     API message failed (403 — ManageOrgSessions may be missing).

     This session has PR #N in this repo. Devin monitors PR comments
     and will pick up instructions posted there.

     Options:
     - Comment on PR — Post as PR comment with @devin prefix
     - Run /devin:setup — Check and fix permissions
     - Cancel
     ```
  1. If "Comment on PR" chosen, use `gh pr comment`:
     ```bash
     gh pr comment "$PR_NUMBER" --body "$(printf '@devin %s' "$MESSAGE" | \
       sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g')"
     ```
  1. If no PRs found on the session, skip the fallback and show the existing
     error with a note to run `/devin:setup`.

<!-- deepen-plan: codebase -->
> **Codebase (gap — HIGH):** `message.md` does **not** currently extract
> `owner/repo` from `git remote`. The PR comment fallback needs this to match
> session PRs against the current repo. Add repo detection (same pattern as
> `review-prs.md` lines 78-87: `git remote get-url origin` + parse owner/repo).
> `message.md` Step 4 already fetches session details including `pull_requests`
> — no extra API call needed, just add repo matching logic.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase (gap — MEDIUM):** `message.md` does not validate `gh` CLI
> availability in its prerequisites (Step 1 only checks `DEVIN_SERVICE_USER_TOKEN`,
> `DEVIN_ORG_ID`, `jq`). Check `gh` availability inline at fallback time with
> `command -v gh` and `gh auth status` — disable the "Comment on PR" option if
> either fails. This is a soft prerequisite (only needed for fallback, not core
> functionality).
<!-- /deepen-plan -->

  **Important:** The `gh pr comment` posts as the authenticated GitHub user (not
  the Devin service user). This is fine — Devin responds to human comments by
  default. The `@devin` prefix ensures delivery even if mention-only filtering
  is enabled.

<!-- deepen-plan: codebase -->
> **Codebase (gap — LOW):** Apply token sanitization to the PR comment body
> before posting: `sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'`. If review
> findings contain error output with `cog_` tokens, posting unsanitized via
> `gh pr comment` would leak credentials publicly.
<!-- /deepen-plan -->

### Phase 3: PR Comment Fallback in review-prs.md

- [x] **3.1: Add "Comment on PR" as 4th remediation option**

  File: `plugins/yellow-devin/commands/devin/review-prs.md`

  In Step 5e (remediation choice, around line 371), add a new option:

  ```text
  Options:
  - Fix locally — Commit and push fixes via Graphite
  - Message Devin — Send fix instructions to session
  - Comment on PR — Post review feedback as PR comment (@devin prefix)
  - Skip — Leave PR as-is, move to next
  ```

  "Comment on PR" should always be available (it only needs `gh` CLI, which is
  already validated in Step 1). Unlike "Message Devin", it doesn't depend on
  session state — it works even for terminal sessions.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — `review-prs.md` Step 1 (line 55) validates `gh` via
> `command -v gh`. The "Comment on PR" option can rely on this without adding a
> new check. This also fills a real gap: when all sessions are terminal (line 357
> disables "Message Devin"), the only current options are "Fix locally" or "Skip".
> "Comment on PR" provides a middle ground for terminal sessions.
<!-- /deepen-plan -->

- [x] **3.2: Implement "Comment on PR" option (new Option 2b)**

  Compose the comment from review findings using the same structure as the
  message composer (Step 5f Option 2, item 2), but:
  - Prefix with `@devin` instead of a session context line — must be at the
    very start of the comment body (no leading whitespace/newline)
  - No 2000-char API limit — GitHub comments support up to 65536 chars, but
    truncate at 4000 chars for readability
  - Include PR-specific context (file paths, line numbers) since Devin can
    map these to the PR diff
  - Apply token sanitization before posting

  ```bash
  COMMENT_BODY=$(printf '@devin\nReview found %d issues in PR #%s:\n\n' "$FINDING_COUNT" "$PR_NUMBER")
  # ... append P1/P2 findings ...
  # Sanitize before posting
  COMMENT_BODY=$(printf '%s' "$COMMENT_BODY" | sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g')
  gh pr comment "$PR_NUMBER" --body "$COMMENT_BODY"
  ```

<!-- deepen-plan: external -->
> **Research:** `@devin` must be at the **start** of the comment (prefix match).
> From Devin docs: *"bot comments must also mention Devin (starting with DevinAI
> or @devin) to be processed."* The `printf '@devin\n...'` pattern above is
> correct. Ensure no heredoc or variable expansion adds leading whitespace.
<!-- /deepen-plan -->

- [x] **3.3: Add 403 auto-escalation from "Message Devin" to "Comment on PR"**

  In Step 5f Option 2 (line 473-475), when API messaging fails with 403, instead
  of just offering "Fix locally", also offer "Comment on PR" as an alternative:

  ```text
  Failed to send message to Devin session {id}: 403 Forbidden
  (ManageOrgSessions permission may be missing)

  Alternative:
  - Comment on PR — Post the same feedback as a PR comment (@devin prefix)
  - Fix locally — Apply changes yourself
  - Run /devin:setup — Check and fix permissions
  - Skip
  ```

### Phase 4: Testing & Documentation

- [x] **4.1: Update CLAUDE.md Known Limitations**

  Add note about PR comment fallback (Known Limitations section starts at
  line 122):
  ```text
  - **PR comment fallback** — When API messaging fails (403), review feedback
    can be posted as PR comments with @devin prefix. Requires gh CLI auth and
    Devin's GitHub integration enabled on the repo.
  ```

- [x] **4.2: Update devin-workflows skill API reference**

  In `skills/devin-workflows/api-reference.md`, add a "PR Comment Fallback"
  section documenting:
  - When it's used (403 on both message endpoints)
  - How Devin picks up PR comments (automatic, mention-only mode needs @devin
    at the start)
  - Character limits (4000 for readability, 65536 max)
  - Requirement: gh CLI authenticated, Devin GitHub integration on repo
  - Token sanitization applied before posting

- [x] **4.3: Create changeset**

  ```bash
  pnpm changeset
  ```

  Declare a `patch` bump for `yellow-devin` — this is a bug fix (403 handling)
  with a new fallback mechanism, not a breaking change or new feature.

<!-- deepen-plan: codebase -->
> **Codebase (gap — MEDIUM):** Per repo conventions (MEMORY.md), every PR that
> changes a plugin must include a `.changeset/*.md` file. The original plan
> omitted this step.
<!-- /deepen-plan -->

- [x] **4.4: Validate with `pnpm validate:schemas`**

  Run validators to ensure no frontmatter or manifest regressions.

## Technical Details

### Files to Modify

- `plugins/yellow-devin/commands/devin/setup.md` — Add ManageOrgSessions probe
  (Step 3b), update report (Step 5), remove stale assumption comment (line 94-96)
- `plugins/yellow-devin/commands/devin/message.md` — Add repo detection, PR
  comment fallback after 403, inline `gh`/`gh auth` check
- `plugins/yellow-devin/commands/devin/review-prs.md` — Add "Comment on PR"
  option + 403 auto-escalation
- `plugins/yellow-devin/CLAUDE.md` — Update Known Limitations
- `plugins/yellow-devin/skills/devin-workflows/api-reference.md` — Add PR
  comment fallback docs

### No New Files

All changes are modifications to existing files (plus one changeset).

### Dependencies

- `gh` CLI — already validated as a prerequisite in review-prs Step 1;
  needs inline check in message.md fallback path
- Devin GitHub integration — must be enabled on the repo (org-level setting)

<!-- deepen-plan: codebase -->
> **Codebase:** `message.md` has `Bash`, `Skill`, and `AskUserQuestion` in its
> `allowed-tools` — sufficient for `gh pr comment` (Bash) and the fallback
> prompt (AskUserQuestion). No tool additions needed.
<!-- /deepen-plan -->

## Acceptance Criteria

1. `/devin:setup` reports `ManageOrgSessions` status (PASS/MISSING) separately
   from `ViewOrgSessions`
1. `/devin:setup` provides specific remediation guidance when ManageOrgSessions
   is missing but ViewOrgSessions passes
1. `/devin:message` offers PR comment fallback when both API endpoints return 403
   and the session has PRs in the current repo
1. `/devin:review-prs` shows "Comment on PR" as a remediation option alongside
   "Fix locally" and "Message Devin"
1. `/devin:review-prs` auto-escalates from "Message Devin" to "Comment on PR"
   when API messaging fails with 403
1. PR comments are prefixed with `@devin` (at the start, no leading whitespace)
   to ensure delivery with mention-only filtering
1. All PR comment bodies are sanitized for `cog_` token leakage before posting
1. `pnpm validate:schemas` passes with no regressions
1. Changeset included in PR

## Edge Cases

- **No PRs on session:** If the session has no pull_requests in the current repo,
  the PR comment fallback is unavailable — show error + suggest `/devin:setup`
- **gh not authenticated:** If `gh auth status` fails, disable PR comment
  fallback with a note
- **Devin GitHub integration not enabled:** Comment will be posted but Devin won't
  respond — document this as a known limitation
- **Session archived:** Devin docs say it won't respond to PR comments on archived
  sessions — warn user if session status is archived
- **Mention-only filtering off:** `@devin` prefix is redundant but harmless — it
  does not interfere with delivery when mention-only is disabled
- **Unexpected HTTP status from probe:** If the ManageOrgSessions probe returns
  an unexpected status (e.g., 400), record as UNKNOWN with redacted body preview

<!-- deepen-plan: external -->
> **Research:** Devin's PR comment gate is session archival, not PR state. The
> existing `review-prs.md` already filters for `state=OPEN` PRs in Step 3, so
> posting comments on closed/merged PRs is a non-issue for that command. For
> `message.md`, the user explicitly provides a session ID — if they target an
> archived session, the PR comment would be posted but Devin won't respond.
> Warn in this case.
<!-- /deepen-plan -->

## References

- `plugins/yellow-devin/commands/devin/setup.md` — Current setup probes
- `plugins/yellow-devin/commands/devin/message.md:80-107` — Current message send
- `plugins/yellow-devin/commands/devin/review-prs.md:78-87` — Repo detection
  pattern (reuse in message.md)
- `plugins/yellow-devin/commands/devin/review-prs.md:417-480` — Current message
  remediation
- `plugins/yellow-devin/CLAUDE.md` — Permission table, conventions
- [Devin GitHub Integration](https://docs.devin.ai/integrations/gh) — PR comment
  response behavior, session archival gate
- [Devin Bot Comment Settings](https://docs.devin.ai/product-guides/bot-comment-settings.md) — Mention-only filtering, `@devin` prefix requirement
- [Devin V3 Message API](https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions-messages) — Requires ManageOrgSessions
- [Devin API Authentication](https://docs.devin.ai/api-reference/authentication.md) — Error semantics (403 vs 404)
- [Devin API Overview](https://docs.devin.ai/api-reference/overview.md) — Rate limiting (429)
