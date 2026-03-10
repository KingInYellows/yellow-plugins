# Brainstorm: Devin PR Review and Remediation Command

**Date:** 2026-03-10
**Status:** Draft
**Plugin:** yellow-devin

## What We're Building

A new `/devin:review-prs` command that discovers Devin sessions working on the
current repository, finds their PRs, tracks them in Graphite, reviews them using
the full yellow-review multi-agent pipeline, addresses all PR feedback (CI
failures, review bot comments, manual reviewer comments, false positives), and
lets the user choose per-PR whether to fix locally in Claude Code or message
Devin to apply fixes.

### Command Shape

```
/devin:review-prs [--tag TAG] [--session SESSION_ID]
```

- Default: discover all Devin sessions with open PRs targeting the current repo
- `--tag TAG`: narrow discovery to sessions with a specific tag
- `--session SESSION_ID`: skip discovery, review PRs from a specific session

### Workflow Steps

1. **Discover** -- Query Devin V3 API for recent sessions (`GET
   ${ORG_URL}/sessions?first=50`). Client-side filter by matching
   `pull_requests` URLs against the current repo's `owner/repo` (extracted from
   `git remote get-url origin`). The API does not support server-side repo
   filtering, so this must be done post-fetch. Paginate if needed.

2. **Extract PRs** -- From matching sessions, collect all PR URLs. Deduplicate
   (a session may have multiple PRs, or multiple sessions may touch the same
   PR). Filter to open PRs only by checking state via `gh pr view`.

3. **Adopt into Graphite** -- For each PR not already tracked by Graphite:
   - `gh pr checkout <PR#>` to create local branch
   - `gt track` to adopt into Graphite
   - On `gt track` failure: warn and proceed in degraded mode (raw git)

4. **Stack Management** -- Detect relationships between PRs:
   - Check if PRs share a base branch or if one PR's head is another's base
   - If related, order them base-to-tip for proper stack processing
   - If unrelated (independent PRs off main), process in PR number order
   - After adopting related PRs, run `gt upstack restack` to align the stack

5. **Sequential Review Loop** -- For each PR in order:
   a. Checkout: `gt checkout <branch>` (or `git checkout` in degraded mode)
   b. Review: Run the inline `review:pr` flow (adaptive multi-agent review,
      P1/P2 fix application, code simplifier pass)
   c. Resolve: Run the inline `review:resolve` flow (fetch unresolved comments
      via GraphQL, spawn parallel resolvers, apply fixes, mark threads resolved)
   d. False-positive handling: During comment resolution, the resolver agents
      assess each comment for validity. Bot comments identified as false
      positives are marked resolved with a dismissal note. CI check false
      positives are noted in the summary for the user.
   e. Present per-PR summary with remediation choice via AskUserQuestion:
      - **[Fix locally]** -- Apply fixes in Claude Code, commit via `gt modify`,
        push via `gt submit --no-interactive`
      - **[Message Devin]** -- Compose fix instructions from review findings,
        send via `POST ${ORG_URL}/sessions/${SESSION_ID}/messages` (the existing
        `/devin:message` pattern with org-scoped + enterprise fallback)
      - **[Skip]** -- Leave PR as-is, report findings only
   f. If stack: run `gt upstack restack` after changes. On conflict: abort
      restack, report to user, continue to next PR.

6. **Final Summary** -- Present aggregate report across all processed PRs.

### Tools Required

```yaml
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
  - Write
  - Task
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
```

The command spawns yellow-review agents via Task tool for the review pass. If
yellow-review is not installed, the command degrades to a lightweight single-pass
review (diff analysis without subagents).

### Skills Preloading

```yaml
skills:
  - devin-workflows
```

The `devin-workflows` skill provides API patterns, validation functions, error
handling, and session status conventions needed for Devin API interactions.

## Why This Approach

**Composition over reimplementation.** The yellow-review plugin already has a
battle-tested multi-agent review pipeline with 7 specialized review agents,
parallel comment resolution, knowledge compounding, and ruvector memory
integration. Reimplementing any of this would be duplicative and lower quality.
The only genuinely new logic needed is Devin session discovery (filtering by
repo), PR extraction, and the remediation routing (fix locally vs message Devin).

**Follows established patterns.** The `review:all` command already does
sequential multi-PR review with Graphite adoption (`gh pr checkout` + `gt
track`), stack restacking, and inline `review:pr` + `review:resolve` flows.
This command adds a Devin-specific discovery layer on top of that same pattern.

**Per-PR user choice preserves control.** Rather than auto-deciding whether to
fix locally or message Devin, the command presents a summary and lets the user
choose. This avoids wasted ACUs from unnecessary Devin messages and prevents
local fixes that the user might not want.

**False-positive handling is built in.** The existing `pr-comment-resolver`
agents already assess whether a review comment is valid before applying fixes.
Bot comments that are false positives get identified during this process. The
command surfaces these in the summary and marks resolved with dismissal notes.

## Key Decisions

1. **Cross-plugin dependency on yellow-review**: The command depends on
   yellow-review for full review quality. Without it, it degrades to a
   lightweight single-pass review. This is acceptable because the value
   proposition of this command is the full review pipeline applied to Devin PRs
   -- without yellow-review, users can already use `/devin:status` to find PRs
   and manually review them.

2. **Client-side repo filtering**: The Devin V3 API does not support filtering
   sessions by repository. The command fetches up to 50 recent sessions and
   filters client-side by matching `pull_requests` URLs against the current
   repo. This is pragmatic but means very active Devin orgs may need pagination
   or tag-based filtering to find relevant sessions.

3. **Stack detection heuristic**: Related PRs are detected by checking GitHub
   base/head ref relationships (`gh pr view --json baseRefName,headRefName`).
   PRs whose `headRefName` matches another PR's `baseRefName` are stacked. This
   is a simple heuristic that works for linear stacks but may not catch complex
   DAG relationships.

4. **Remediation routing is per-PR, not per-finding**: The user chooses a
   remediation path for each PR as a whole, not for each individual finding.
   This keeps the interaction manageable. If 3 PRs have 15 findings total,
   the user makes 3 decisions, not 15.

5. **Devin session state validation before messaging**: Before sending fix
   instructions to Devin, the command re-fetches session status (TOCTOU
   protection). If the session is in a terminal state (`exit`, `error`), it
   falls back to local fix. If `suspended`, it notes the message will
   auto-resume the session.

6. **Write safety**: Session discovery and PR review are read-only (Low tier).
   Local fix application + push requires user confirmation (Medium tier, via
   AskUserQuestion). Messaging Devin is Low tier (non-destructive, costs ACUs
   but user explicitly chose this path). No High tier operations.

## Open Questions

1. **Should the command tag Devin sessions after processing?** Adding a
   `reviewed-by-claude` tag via `/devin:tag` would prevent re-reviewing the
   same session. But the V1 tag endpoint compatibility with `cog_` tokens is
   unverified.

2. **What happens when Devin pushes fixes after being messaged?** The current
   design does not wait for Devin to respond. Should there be a `--wait` flag
   that polls the session and re-reviews after Devin pushes? Or is that better
   handled by running `/devin:review-prs` again later?

3. **Should CI checks be re-run after local fixes?** After applying fixes and
   pushing via `gt submit`, CI will run automatically. But should the command
   wait and verify CI passes, or just report that fixes were pushed?

4. **How should the command handle draft PRs from Devin?** Devin sometimes
   creates draft PRs for work-in-progress. Should drafts be included in
   discovery (they may not be ready for review) or filtered out by default with
   a `--include-drafts` flag?

5. **Degraded mode depth**: When yellow-review is not installed, how thorough
   should the lightweight single-pass review be? Just CI check status and
   comment listing? Or should the command attempt its own diff analysis within
   the single context?
