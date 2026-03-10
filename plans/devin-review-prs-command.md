# Feature: `/devin:review-prs` Command

## Problem Statement

When Devin works on tasks in a repository, it creates PRs that need human
review, bot comment triage, and often remediation. Currently, the user must
manually discover which Devin sessions have PRs, check each PR for review
feedback, decide whether to fix issues locally or message Devin, and manage
Graphite tracking -- all as separate operations across multiple commands.

This command automates the full lifecycle: discover, adopt, review, triage, and
remediate Devin PRs in a single on-demand workflow.

## Current State

- `/devin:status` discovers sessions and shows PR counts but doesn't review them
- `/devin:message` messages a session but doesn't compose fix instructions
- `/review:pr` and `/review:resolve` review PRs but don't know about Devin
- `/review:all` does sequential multi-PR review but only for user's own PRs
- No command bridges the Devin discovery → review → remediation pipeline

## Proposed Solution

A new `/devin:review-prs` composition command in yellow-devin that:

1. **Discovers** Devin sessions with PRs targeting the current repo
2. **Adopts** those PRs into Graphite with stack detection
3. **Delegates** review to yellow-review via Skill tool (graceful degradation)
4. **Presents** per-PR remediation choices to the user
5. **Executes** chosen remediation (local fix or message Devin)

### Key Design Decisions

1. **Skill tool delegation (not inline reimplementation).** Invoke `/review:pr`
   and `/review:resolve` via Skill tool rather than reimplementing their flows.
   This avoids CLAUDE_PLUGIN_ROOT path issues, stays in sync with yellow-review
   updates, and gets graceful degradation for free.

2. **Per-PR remediation choice.** User chooses fix locally / message Devin /
   skip for each PR as a whole. Keeps interaction manageable (N decisions for N
   PRs, not M decisions for M findings).

3. **Session-to-PR mapping preserved.** Deduplication removes duplicate PR URLs
   but preserves which session(s) created each PR. "Message Devin" uses the most
   recent non-terminal session for that PR.

4. **Draft PRs excluded.** Consistent with `review:all scope=all` which skips
   drafts. Devin drafts indicate work-in-progress.

5. **Branch recovery on completion/error.** Records original branch at start,
   returns to it at the end (including on error).

## Implementation Plan

### Phase 1: Command File

- [ ] 1.1: Create command at
  `plugins/yellow-devin/commands/devin/review-prs.md`
- [ ] 1.2: Define frontmatter with correct `allowed-tools` list
- [ ] 1.3: Write workflow steps (detailed below)

### Phase 2: Documentation Updates

- [ ] 2.1: Update `plugins/yellow-devin/CLAUDE.md` — add command to list
  (Commands 8 → 9), add to "When to Use What" table
- [ ] 2.2: Update `plugins/yellow-devin/commands/devin/README.md` — add row to
  command table

### Phase 3: Validation and Changeset

- [ ] 3.1: Run `pnpm validate:schemas` to verify command passes validation
- [ ] 3.2: Run `pnpm changeset` — minor bump for yellow-devin (new command)

## Technical Specifications

### Command File: `review-prs.md`

#### Frontmatter

```yaml
---
name: devin:review-prs
description: Discover Devin PRs for current repo, review with multi-agent pipeline, and remediate. Use when user says "review Devin PRs", "check Devin's work", "babysit PRs", or wants to process all Devin-created PRs.
argument-hint: '[--tag TAG] [--session SESSION_ID]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
  - Write
  - Task
  - Skill
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---
```

<!-- deepen-plan: codebase -->
> **Codebase:** Description collapsed to single-line as required by MEMORY.md.
> Commands use `allowed-tools:` (not `tools:`), and do NOT use `skills:`
> preloading (that is agent-only). The `Skill` tool in `allowed-tools` enables
> cross-plugin invocation of `review:pr` and `review:resolve` at runtime, and
> loading `devin-workflows` context. This matches the pattern in `workflows:work`
> and `workflows:review`.
<!-- /deepen-plan -->

#### Workflow Steps

**Step 0: Record Original Branch**

```bash
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
```

Store for cleanup/recovery at the end.

**Step 1: Validate Prerequisites**

Check in order (fail fast):

1. `DEVIN_SERVICE_USER_TOKEN` — validate `cog_` prefix per `devin-workflows`
2. `DEVIN_ORG_ID` — validate format per `devin-workflows`
3. `jq` — required for JSON parsing
4. `gh` — required for PR operations
5. `gt` — soft prerequisite (warn if missing, note degraded Graphite mode)
6. Clean working directory — `git status --porcelain` must be empty

Extract `owner/repo` from git remote:

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null)
# Handle both SSH and HTTPS formats (two-regex strategy)
# Format 1: https://github.com/owner/repo.git or https://host:port/owner/repo
# Format 2: git@github.com:owner/repo.git (SCP-style)
REPO=$(echo "$REMOTE_URL" | sed -E \
  -e 's#^[a-z+]+://([^@]+@)?[^/:]+(:[:digit:]+)?/##' \
  -e 's#^git@[^:]+:##' \
  -e 's/\.git$//' \
  -e 's#/$##')
```

<!-- deepen-plan: external -->
> **Research:** The Devin V3 API has no `repository` field on session objects.
> Repo matching must be done by parsing `pull_requests[].pr_url`. The proven
> approach (per `dgoguerra/parse-repo`, 10.9k npm dependents) is a two-regex
> strategy: one for protocol URLs (`https://`, `ssh://`, `git://`), one for
> SCP-style SSH (`git@host:owner/repo`). Edge cases to handle: enterprise
> GitHub hosts, port numbers, trailing slashes, no `.git` suffix, `git+https://`
> prefix. For matching against `pr_url`, extract `owner/repo` from both the
> remote and the PR URL using the same pattern.
> See: https://github.com/dgoguerra/parse-repo
<!-- /deepen-plan -->

**Step 2: Discover Devin Sessions**

Parse `$ARGUMENTS` for flags:

- `--tag TAG` → use server-side filter: `&tags=TAG`
- `--session SESSION_ID` → skip discovery, fetch single session

Default discovery:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions?first=200" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

<!-- deepen-plan: external -->
> **Research:** The V3 API supports `first` values up to 200 (not just 50).
> Using `first=200` reduces pagination needs. Supported query params for
> narrowing results: `tags` (server-side), `created_after`/`updated_after`
> (Unix timestamps), `origins` (e.g., `api`, `slack`), `user_ids`,
> `service_user_ids`. No `repository` or `pr_url` filter exists -- repo matching
> must be client-side. Pagination uses cursor-based `after` + `has_next_page`.
> See: https://docs.devin.ai/api-reference/v3/sessions/organizations-sessions
<!-- /deepen-plan -->

Three-layer error handling per `devin-workflows` skill (curl exit → HTTP status
→ jq parse).

Client-side repo filtering using jq:

```bash
# Extract PR URLs from each session's pull_requests array
printf '%s' "$body" | jq -r '.items[] | select(.pull_requests | length > 0) |
  {session_id, status, pull_requests, tags, acus_consumed, updated_at}'
```

For each session, check if any `pr_url` contains the target `owner/repo`. Skip
sessions with empty `pull_requests` arrays silently.

<!-- deepen-plan: codebase -->
> **Codebase:** The established jq pattern for extracting PR URLs from session
> responses is `jq -r '.pull_requests[].pr_url'` (from V3 migration plan at
> `docs/plans/2026-02-18-feat-devin-v3-api-migration-plan.md:760`). The
> `devin-orchestrator` agent confirms the array entry structure as
> `{ "pr_url": "https://github.com/...", "pr_state": "open" }` with exactly
> two fields per entry. No `number`, `html_url`, `title`, or `repo_url` fields
> exist -- PR number must be parsed from the URL.
<!-- /deepen-plan -->

Output discovery summary:

```
Found 3 Devin sessions with PRs for owner/repo (2 sessions skipped: no PRs)
```

If zero matching sessions: report and exit cleanly.

**Step 3: Extract and Deduplicate PRs**

From matching sessions, collect all `pr_url` values. Build a mapping:

```
PR_MAP: {
  pr_url_1: [session_id_A, session_id_B],
  pr_url_2: [session_id_C],
}
```

Extract PR numbers from URLs. For each PR, check state via `gh pr view`:

```bash
gh pr view $PR_NUM --repo "$REPO" --json state,isDraft -q '{state: .state, isDraft: .isDraft}'
```

Filter: keep only `state=OPEN` and `isDraft=false`. If a PR was closed/merged
between session listing and now, skip with a note.

If zero open non-draft PRs remain: report and exit cleanly.

**Step 4: Adopt into Graphite + Stack Detection**

For each PR not already tracked by Graphite:

```bash
gh pr checkout $PR_NUM
gt track 2>/dev/null || {
  printf 'WARN: gt track failed for PR #%s. Proceeding in degraded mode.\n' "$PR_NUM"
  DEGRADED_PRS+=("$PR_NUM")
}
```

Detect stack relationships via base/head refs:

```bash
gh pr view $PR_NUM --json baseRefName,headRefName
```

If PR A's `headRefName` equals PR B's `baseRefName`, they are stacked. Order
base-to-tip. Independent PRs (all based on main/master) are ordered by PR
number.

If stacked PRs detected, run `gt upstack restack` after adoption. On conflict:
abort restack, warn, process as independent.

**Step 5: Sequential Review Loop**

For each PR in determined order:

```
Reviewing PR 2/5: #142 'Add auth middleware' [session: abc123]
```

**5a. Checkout:**

```bash
gt checkout "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
```

**5b. Re-validate PR state (TOCTOU protection):**

```bash
gh pr view $PR_NUM --json state -q '.state'
```

If no longer `OPEN`, skip: "PR #X closed since discovery. Skipping."

**5c. Review via Skill tool:**

Invoke `/review:pr` via the Skill tool with `skill: "review:pr"` and `args`
set to the PR number.

<!-- deepen-plan: codebase -->
> **Codebase:** The canonical Skill invocation phrasing (from `workflows:work`
> lines 609-623 and `workflows:review` line 22) is natural language, not
> function-call syntax: `Invoke the Skill tool with skill: "review:pr" and args
> set to the PR number.` The graceful degradation pattern is also established:
> "If the Skill invocation fails (skill not found, yellow-review plugin not
> installed, or any error), skip this phase and inform the user."
<!-- /deepen-plan -->

**Graceful degradation:** If Skill invocation fails (yellow-review not
installed), fall back to lightweight review:

1. Show CI check status: `gh pr checks $PR_NUM`
2. Show PR comments: `gh pr view $PR_NUM --comments`
3. Show diff summary: `gh pr diff $PR_NUM --stat`
4. Note: "Full multi-agent review unavailable (yellow-review not installed)"

**5d. Resolve comments via Skill tool:**

Invoke `/review:resolve` via the Skill tool with `skill: "review:resolve"` and
`args` set to the PR number.

If Skill fails (yellow-review missing): skip comment resolution, note in
summary.

**5e. Present per-PR summary and remediation choice:**

Use AskUserQuestion:

```
PR #142 'Add auth middleware' — Review complete.
- Findings: 2 P1, 1 P2 applied by review:pr
- Comments: 3 resolved, 1 false positive dismissed
- CI: 2/3 checks passing, 1 failing (lint)
- Session: abc123 (suspended, 4.2 ACUs consumed)

How would you like to remediate?

1. [Fix locally] — Commit and push fixes via Graphite
2. [Message Devin] — Send fix instructions to session abc123
3. [Skip] — Leave PR as-is, move to next
```

**5f. Execute remediation:**

**Option 1 — Fix locally:**

If PR is Graphite-tracked:
```bash
gt modify -m "fix: address review findings"
gt submit --no-interactive
```

If PR is in degraded mode (gt track failed):
```bash
git add -- <specific-changed-files>
git commit -m "fix: address review findings"
git push
```

<!-- deepen-plan: codebase -->
> **Codebase:** The degraded-mode push deviates from the repo convention
> ("ALWAYS use `gt submit --no-interactive` -- NEVER raw `git push`"). This is
> a documented exception: when `gt track` fails, `gt submit` is unavailable.
> Use `git add -- <specific-files>` instead of `git add -A` to avoid
> accidentally staging sensitive files (`.env`, credentials). This matches the
> safety guidance from `review:all`'s degraded mode pattern at
> `plugins/yellow-review/commands/review/review-all.md:72`.
<!-- /deepen-plan -->

**Option 2 — Message Devin:**

1. Re-fetch session status (TOCTOU protection). If terminal (`exit`/`error`),
   inform user and offer to fix locally instead.
2. Compose fix message from review findings. Truncate to 2000 chars (Devin
   message limit). Prioritize P1 findings, then P2.
3. Show composed message to user: "Send this to Devin session abc123?
   [Send / Edit / Cancel]"
4. On Send: POST to `${ORG_URL}/sessions/${SESSION_ID}/messages`
   with org-scoped + enterprise 403 fallback (per `devin:message` pattern).
5. On Edit: let user modify via AskUserQuestion, then send.
6. On Cancel: treat as Skip.

When multiple sessions reference the same PR, use the most recent non-terminal
session. If all sessions are terminal, disable "Message Devin" and note why.

**Option 3 — Skip:**

No action. Note in final report.

**5g. Post-remediation stack maintenance:**

If PR is part of a stack and changes were made:
```bash
gt upstack restack
```

On conflict: abort restack, report to user, continue to next PR.

**Step 6: Return to Original Branch**

```bash
gt checkout "$ORIGINAL_BRANCH" 2>/dev/null || git checkout "$ORIGINAL_BRANCH"
```

**Step 7: Final Summary**

```
=== Devin PR Review Summary ===

Processed: 5 PRs from 3 Devin sessions
- Fixed locally: 2 (#142, #145)
- Messaged Devin: 1 (#148 → session abc123)
- Skipped: 2 (#150, #151)

Findings: 8 total (4 P1, 3 P2, 1 P3)
Comments: 12 resolved, 3 false positives dismissed
CI: 4/5 PRs passing
```

### Files to Modify

- `plugins/yellow-devin/commands/devin/review-prs.md` — **New file** (command)
- `plugins/yellow-devin/CLAUDE.md` — Update component counts and tables
- `plugins/yellow-devin/commands/devin/README.md` — Add command to table

<!-- deepen-plan: codebase -->
> **Codebase:** Both files confirmed to exist. `CLAUDE.md` lists "Commands (8)"
> and needs updating to 9. The README at
> `plugins/yellow-devin/commands/devin/README.md` has a command table with 8
> entries. No `plugin.json` changes needed -- commands are auto-discovered from
> the `commands/` directory. Also consider updating
> `plugins/yellow-devin/skills/devin-workflows/api-reference.md` to document
> the `pull_requests` entry schema (`{ pr_url, pr_state }`) -- currently it
> only shows `"pull_requests": []` without entry structure.
<!-- /deepen-plan -->

### Dependencies

No new package dependencies. Cross-plugin runtime dependency on yellow-review
(optional, graceful degradation).

## Testing Strategy

- Manual test: run `/devin:review-prs` in a repo with active Devin sessions
- Validate with `pnpm validate:schemas` (frontmatter, agent refs)
- Test degraded mode by running without yellow-review installed
- Test `--tag` and `--session` argument parsing

## Acceptance Criteria

1. Command discovers Devin sessions with PRs targeting the current repo
2. PRs are adopted into Graphite with `gt track` (degraded mode on failure)
3. Stacked PRs are detected and processed in dependency order
4. Full multi-agent review runs when yellow-review is installed
5. Lightweight review (CI checks + comments + diff stats) when yellow-review
   is absent
6. User is prompted per-PR for remediation choice
7. "Fix locally" commits and pushes via Graphite
8. "Message Devin" composes, previews, and sends fix instructions
9. "Skip" moves to next PR without action
10. Original branch is restored on completion and on error
11. Final summary shows aggregate results across all PRs
12. `pnpm validate:schemas` passes

## Edge Cases

- No Devin sessions for this repo → clean exit with message
- All PRs are drafts → clean exit with message
- Session in terminal state when "Message Devin" chosen → fallback to local fix
- `gt track` fails → degraded mode with raw git
- PR closed between discovery and review → skip with TOCTOU note
- Multiple sessions reference same PR → use most recent non-terminal session
- Findings exceed 2000-char Devin message limit → truncate with priority order
- Restack conflict after fixes → abort, warn, continue
- git remote is SSH vs HTTPS → handle both URL formats

<!-- deepen-plan: external -->
> **Research:** Additional edge cases from V3 API schema: (1) Sessions have
> `child_session_ids` and `parent_session_id` fields -- if Devin spawns child
> sessions, their PRs may also target the same repo. Consider traversing child
> sessions in v2. (2) The `status_detail` field provides finer-grained state
> (`working`, `blocked`, `expired`, `finished`) which could enrich the per-PR
> summary. (3) The `is_archived` flag -- archived sessions are still returned
> by the list endpoint unless explicitly filtered. Consider adding
> `is_archived=false` filter if the API supports it, or filter client-side.
> See: https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session
<!-- /deepen-plan -->

## Open Questions (Deferred to v2)

1. **Session tagging after processing** — add `reviewed-YYYY-MM-DD` tag for
   idempotency. Blocked on V1 tag endpoint `cog_` token compatibility.
2. **`--wait` flag** — poll Devin after messaging and re-review when it pushes.
   Better handled by running the command again later.
3. **`--include-drafts` flag** — review draft PRs. YAGNI for v1.
4. **`--remediate=local|devin|skip` flag** — auto-apply same choice to all PRs.
   Add when users report prompt fatigue.
5. **CI re-verification** — wait for CI after pushing fixes. CI runs
   automatically; user can check with `/ci:status`.

## References

<!-- deepen-plan: external -->
> **Research:** External API documentation references:
> - Devin V3 Session Schema: https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session
> - Devin V3 List Sessions: https://docs.devin.ai/api-reference/v3/sessions/organizations-sessions
> - Devin V3 List Repositories: https://docs.devin.ai/api-reference/v3/repositories/list-indexed-repositories
> - Devin API Release Notes: https://docs.devin.ai/api-reference/release-notes
> - Git remote URL parsing patterns: https://github.com/dgoguerra/parse-repo
<!-- /deepen-plan -->

- Brainstorm: `docs/brainstorms/2026-03-10-devin-pr-review-and-remediation-command-brainstorm.md`
- Devin status command: `plugins/yellow-devin/commands/devin/status.md`
- Devin message command: `plugins/yellow-devin/commands/devin/message.md`
- Devin workflows skill: `plugins/yellow-devin/skills/devin-workflows/SKILL.md`
- Review PR command: `plugins/yellow-review/commands/review/review-pr.md`
- Review resolve command: `plugins/yellow-review/commands/review/resolve-pr.md`
- Review all command: `plugins/yellow-review/commands/review/review-all.md`
- Plugin CLAUDE.md: `plugins/yellow-devin/CLAUDE.md`
