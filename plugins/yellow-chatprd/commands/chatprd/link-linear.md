---
name: chatprd:link-linear
description: "Create Linear issues from a ChatPRD document. Use when user wants to \"link PRD to Linear\", \"create issues from spec\", \"turn PRD into Linear issues\", or bridge any ChatPRD document to Linear."
argument-hint: '[document title or search query]'
allowed-tools:
  - Read
  - Grep
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-chatprd_chatprd__search_documents
  - mcp__plugin_yellow-chatprd_chatprd__get_document
  - mcp__plugin_yellow-chatprd_chatprd__list_project_documents
  - mcp__plugin_yellow-linear_linear__create_issue
  - mcp__plugin_yellow-linear_linear__list_teams
  - mcp__plugin_yellow-linear_linear__list_issues
  - mcp__plugin_yellow-linear_linear__list_issue_statuses
  - mcp__plugin_yellow-linear_linear__get_issue
  - mcp__plugin_yellow-linear_linear__update_issue
---

# Link ChatPRD Document to Linear

Create Linear issues from a ChatPRD document with duplicate checking, team
selection, and rate-limited batch creation.

## Workflow

### Step 1: Check Linear Availability (Fail-Fast)

Call `mcp__plugin_yellow-linear_linear__list_teams` to verify the yellow-linear plugin
is available:

- **If successful:** Store the teams list for Step 8.
- **If tool not found:** Report "yellow-linear plugin not installed. Install it
  with `/plugin marketplace add KingInYellows/yellow-plugins yellow-linear`" and
  stop.

### Step 2: Read Workspace Config

```bash
# Kept inline for command self-containedness — see chatprd-conventions Workspace Config section
if [ ! -f .claude/yellow-chatprd.local.md ] || \
   ! grep -qE '^org_id: ".+"' .claude/yellow-chatprd.local.md; then
  printf '[chatprd] No workspace configured or config malformed.\n' >&2
  printf 'Run /chatprd:setup to set your default org and project.\n' >&2
  exit 1
fi
```

Read `.claude/yellow-chatprd.local.md` and parse `org_id`, `org_name`,
`default_project_id`, `default_project_name` from the YAML frontmatter.

### Step 3: Parse and Validate Input

Check `$ARGUMENTS` for a document title or search query:

- **If provided:** Validate per `chatprd-conventions` skill input validation
  rules (max 500 chars, reject path traversal, trim whitespace, strip HTML).
- **If empty:** Ask via AskUserQuestion: "Which ChatPRD document should be
  linked to Linear?"

### Step 4: Find Document

Call `search_documents` with the query.

- If multiple matches: present results, let user confirm which document via
  AskUserQuestion.
- If no matches: suggest `/chatprd:search` or `/chatprd:list` to find the
  document. Stop.

### Step 5: Read Document Content

Call `get_document` to retrieve the full document content.

Extract requirement sections:

- User stories
- Acceptance criteria
- Features
- Technical tasks

Organize into a proposed issue breakdown with titles and descriptions.

### Step 6: Fetch Related Specs

Fetch related specs per `chatprd-conventions` Related-Specs Pattern. Use the
source document's project ID (from Step 5's `get_document` response) and
`org_id` from workspace config. If the document has no project ID, fall back to
`default_project_id` from workspace config (loaded in Step 2). Filter out the
source document by UUID. Store results as `related_specs` (title + UUID). Skip
silently if project ID is unavailable or API times out.

### Step 7: Dedup Check

Call `list_issues` to search for existing Linear issues matching the proposed
titles.

- Mark duplicates in the proposal with existing Linear issue identifiers.

### Step 8: Select Linear Team

Use the teams list from Step 1:

- If single team: use it automatically.
- If multiple teams: let user pick via AskUserQuestion.

### Step 9: Review and Confirm (M3)

Present the proposed issue breakdown:

- Each proposed issue with title and brief description
- Duplicates marked with existing issue IDs (will be skipped)
- Target team

Ask user to review and approve via AskUserQuestion. Only proceed after explicit
confirmation.

### Step 10: Create Issues

Create approved (non-duplicate) issues via `create_issue`:

- **Rate limiting:** Create at most 3 issues concurrently, with 200ms delay
  between batches.
- **429 handling:** Exponential backoff (1s, 2s, 4s), max 3 retries per issue.
  Never fall through on rate limit.
- Include ChatPRD document title as reference in each issue description.
- When `related_specs` is non-empty, include a References section in each issue
  description per `chatprd-conventions` Related-Specs Pattern template.

### Step 11: Report

Display summary:

- Created issues: identifier, title, URL
- Skipped issues: duplicates or user-removed
- If partial failure: report which succeeded, offer retry for failures

## Error Handling

| Error                                 | Action                                          |
| ------------------------------------- | ----------------------------------------------- |
| yellow-linear not installed           | Fail fast with install message (Step 1)         |
| Document not found                    | Suggest `/chatprd:search` or `/chatprd:list`    |
| Partial failure (some issues created) | Report successes, offer retry for failures      |
| HTTP 429 rate limiting                | Exponential backoff (1s, 2s, 4s), max 3 retries |

See `chatprd-conventions` skill for additional error mapping.
