# Devin V3 API Migration Brainstorm

**Date:** 2026-02-18
**Status:** Decided — ready for planning
**Plugin:** yellow-devin

## What We're Building

Full migration of the yellow-devin plugin from Devin V1 API to V3 API (beta), plus new
commands for V3-exclusive features. This is a breaking change — V1 support will be dropped
entirely.

## Why V3 Only

- V3 is Devin's recommended path for production automation
- Full RBAC with service user authentication replaces personal/service API keys
- Avoids dual-codepath complexity of supporting both V1 and V3
- V3 adds features our users want: session archiving, tagging, ACU tracking, scheduled sessions
- Clean break means simpler validation, clearer error messages, no legacy baggage

## Key Decisions

### 1. Authentication

- **Token:** `DEVIN_SERVICE_USER_TOKEN` env var (matches Devin docs convention)
- **Token prefix:** `cog_` (service user credential)
- **Validation:** Strict `cog_` prefix check. If `apk_` detected, show migration error:
  "V1 API key detected. V3 requires a service user token (cog\_). Create one at
  Enterprise Settings > Service Users."
- **Org ID:** `DEVIN_ORG_ID` env var, validated on every API call

### 2. Base URL Change

- **V1:** `https://api.devin.ai/v1/`
- **V3:** `https://api.devin.ai/v3beta1/organizations/{org_id}/`
- All endpoints now require `org_id` as a path segment

### 3. Session Status Values (Use V3 Directly)

| V3 Status  | Meaning                           | Terminal? |
| ---------- | --------------------------------- | --------- |
| `new`       | Session created, not yet claimed  | No        |
| `claimed`   | Session picked up, initializing   | No        |
| `running`   | Actively working                  | No        |
| `suspended` | Paused (cost saving)              | No        |
| `resuming`  | Waking from suspended             | No        |
| `exit`      | Completed successfully            | Yes       |
| `error`     | Failed with error                 | Yes       |

### 4. Session ID Naming

- V3 uses `devin_id` instead of `session_id` in paths and responses
- Validation regex update: TBD (need to verify V3 ID format from actual API responses)
- Display as "Session ID" to users regardless

### 5. PR Display (Table Format)

V3 returns `pull_requests` array instead of single `pull_request_url` string. Display as:

```
PRs:
  #  | Status | URL
  1  | open   | github.com/org/repo/pull/42
  2  | merged | github.com/org/repo/pull/43
```

### 6. Command Structure

**Existing commands (migrated to V3):**

- `/devin:delegate` — POST `/organizations/{org_id}/sessions`
- `/devin:status` — GET `/organizations/{org_id}/sessions/{devin_id}` or list
- `/devin:message` — POST `/organizations/{org_id}/sessions/{devin_id}/messages`
- `/devin:cancel` — DELETE `/organizations/{org_id}/sessions/{devin_id}`
- `/devin:wiki` — MCP-based (investigate `cog_` token support)

**New commands (V3 features):**

- `/devin:archive` — POST `/organizations/{org_id}/sessions/{devin_id}/archive`
- `/devin:tag` — Manage session tags (add/remove/list)
- `/devin:schedule` — Create scheduled sessions

### 7. ACU Tracking

Show `acus_consumed` in `/devin:status` output automatically. No separate command needed —
it's a field on the session response.

### 8. MCP Investigation Scope

Test whether `mcp.devin.ai` accepts `cog_` tokens. If yes, update `/devin:wiki` to use V3
auth. If not, document the limitation and track for follow-up.

## What Changes Per File

### Files to Rewrite

| File | Changes |
| ---- | ------- |
| `skills/devin-workflows/SKILL.md` | New base URL, token format, status values, validation patterns |
| `skills/devin-workflows/api-reference.md` | Complete rewrite for V3 endpoints |
| `skills/devin-workflows/error-codes.md` | Update HTTP error patterns, add V3-specific errors |
| `commands/devin/delegate.md` | V3 session creation, org_id in path, new request/response |
| `commands/devin/status.md` | V3 get/list, new status values, PR table, ACU display |
| `commands/devin/message.md` | V3 message endpoint, updated messageable states |
| `commands/devin/cancel.md` | V3 uses DELETE instead of POST cancel, updated states |
| `commands/devin/wiki.md` | Test MCP with cog_ token, update auth references |
| `agents/workflow/devin-orchestrator.md` | V3 endpoints, new status terminal states, PR array handling |
| `CLAUDE.md` | Update all references: token format, env vars, API version |
| `.claude-plugin/plugin.json` | Version bump, update description |

### New Files

| File | Purpose |
| ---- | ------- |
| `commands/devin/archive.md` | Archive/unarchive sessions |
| `commands/devin/tag.md` | Manage session tags |
| `commands/devin/schedule.md` | Create scheduled sessions |

## Open Questions

1. **V3 session ID format:** What does `devin_id` look like? Still `ses_` prefix or different?
   Need to test with actual API response to set validation regex.
2. **MCP auth:** Does `mcp.devin.ai` accept `cog_` tokens? Need empirical test.
3. **V3 cancel endpoint:** Docs suggest DELETE but V1 used POST. Need to verify exact method.
4. **Scheduled sessions endpoint:** Not fully documented yet — may need to defer if beta
   endpoint isn't stable.
5. **Tag management:** Are tags set at creation only, or can they be modified after? Need to
   check V3 session update endpoint.
6. **Rate limits:** Do V3 rate limits differ from V1? Important for polling in orchestrator.

## Approach

Since this is a full V3 rewrite (not incremental migration):

1. Update shared skill first (devin-workflows) — all commands and agents depend on it
2. Rewrite each existing command sequentially
3. Add new commands (archive, tag, schedule)
4. Update orchestrator agent last (depends on all commands being stable)
5. Update CLAUDE.md and plugin.json
6. Test MCP auth as a parallel investigation

## Risk Assessment

- **V3 is beta** — endpoints may change. Mitigate by keeping API reference centralized in
  skill so updates only need one file.
- **No deprecation timeline** — V1 could remain viable indefinitely. But V3 is the clear
  direction from Devin's docs.
- **Scheduled sessions** — may be too unstable for beta. Can defer to follow-up PR if needed.
