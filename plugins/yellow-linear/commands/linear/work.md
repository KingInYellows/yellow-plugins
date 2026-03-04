---
name: linear:work
description: "Start working on a Linear issue — loads context and routes to plan or stack. Use when 'work on ENG-123', 'start issue', 'pick up this ticket', 'begin working on'."
argument-hint: '<issue-id(s) or cycle-name>'
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - ToolSearch
  - Skill
  - mcp__plugin_yellow-linear_linear__get_issue
  - mcp__plugin_yellow-linear_linear__list_issues
  - mcp__plugin_yellow-linear_linear__list_cycles
  - mcp__plugin_yellow-linear_linear__list_issue_statuses
  - mcp__plugin_yellow-linear_linear__list_comments
  - mcp__plugin_yellow-linear_linear__update_issue
---

# Work on Linear Issue

Fetch Linear issue context, write a brainstorm doc for downstream consumption,
and route to the appropriate workflow command (`/workflows:plan` or
`/gt-stack-plan`).

## Workflow

### Step 1: Parse Arguments

Determine what the user wants to work on:

1. **Issue IDs:** If `$ARGUMENTS` matches one or more `[A-Z]{2,5}-[0-9]{1,6}`
   patterns, treat each match as a Linear issue ID.
2. **Cycle name:** Otherwise, treat `$ARGUMENTS` as a cycle name:
   - Validate: alphanumeric, spaces, and hyphens only, max 100 characters.
   - Fetch cycles via `list_cycles` for the auto-detected team (see "Team
     Context" in `linear-workflows` skill).
   - Match by name (case-insensitive substring).
   - Fetch issues from the matched cycle via `list_issues`.
   - Present issues as a numbered list and let the user select which to work on
     via `AskUserQuestion` (multi-select).
3. **No arguments:** Prompt via `AskUserQuestion`: "Enter a Linear issue ID
   (e.g., ENG-123) or cycle name."

### Step 2: Validate Issues (C1)

For each resolved issue ID:

1. Call `get_issue` to verify the issue exists and is accessible.
2. Check current status:
   - **Done or Cancelled:** Warn "Issue appears already handled" — confirm via
     `AskUserQuestion` or abort.
   - **In Review:** Warn "Issue already has a PR in review" — confirm or abort.
   - **In Progress (assigned to someone else):** Warn "Issue is in progress and
     assigned to [name]" — confirm or abort.

If validation fails for any issue, stop with an error. Do NOT proceed with
unverified issues.

### Step 3: Display Issue Context

For each validated issue, display:

- **Identifier** and **Title**
- **Priority** and **Status**
- **Assignee** (if any)
- **Description** (full text)
- **Acceptance Criteria** (if present in description)
- **Labels**

Fetch recent comments (up to 5) via `list_comments` and display them.

### Step 4: Write Brainstorm Doc

Create a pre-populated context document for downstream commands.

```bash
mkdir -p docs/brainstorms
```

**Naming convention:** `docs/brainstorms/<date>-<ISSUE-ID>-<slug>-brainstorm.md`

Example: `docs/brainstorms/2026-03-04-ENG-123-auth-flow-brainstorm.md`

For multiple issues, use the first issue ID and add a combined slug:
`docs/brainstorms/2026-03-04-ENG-123-ENG-456-auth-and-api-brainstorm.md`

Generate the current date:
```bash
DATE=$(date +%Y-%m-%d)
```

**Document structure:**

```markdown
# <Issue Title>

## Linear Issue

| Field       | Value                          |
|-------------|--------------------------------|
| Identifier  | <ISSUE-ID>                     |
| Priority    | <priority>                     |
| Status      | <current status>               |
| Assignee    | <assignee or "Unassigned">     |
| URL         | <Linear issue URL>             |

## Description

<full issue description>

## Acceptance Criteria

<extracted from description if present, otherwise "See description above">

## Recent Comments

<last 5 comments with author and date>

## Cross-References

<if multiple issues, list all with identifiers and titles>
```

Write the file using the Write tool.

### Step 5: Route to Workflow

Present options via `AskUserQuestion`:

**Single issue:**
1. "Plan this issue (`/workflows:plan <issue-title>`)" (Recommended)
2. "Plan as stacked PRs (`/gt-stack-plan <brainstorm-path>`)"
3. "Just load context (skip planning)"

**Multiple issues:**
1. "Plan as stacked PRs (`/gt-stack-plan <brainstorm-path>`)" (Recommended)
2. "Plan each issue separately"
3. "Just load context (skip planning)"

### Step 6: Invoke Selected Command

Based on user's choice in Step 5:

- **Plan this issue:** Invoke via Skill tool with
  `skill: "workflows:plan"` and `args` set to the issue title.
- **Plan as stacked PRs:** Invoke via Skill tool with
  `skill: "gt-stack-plan"` and `args` set to the brainstorm doc path.
- **Plan each separately:** For each issue, invoke
  `skill: "workflows:plan"` sequentially with each issue title.
- **Just load context:** Skip — brainstorm doc is already written. Report the
  path and suggest the user proceed manually.

**Graceful degradation:** If the Skill invocation fails (plugin not installed):
- Report which plugin is needed
- Output install command: `/plugin marketplace add KingInYellows/yellow-plugins <plugin-name>`
- Describe the manual workflow equivalent:
  - For `/workflows:plan`: "Read the brainstorm doc at `<path>` and create a
    plan manually in `plans/`."
  - For `/gt-stack-plan`: "Break the work into branches manually with
    `gt create <branch-name>`."

### Step 7: Update Linear Status

Transition issue(s) to "In Progress" (Tier 1 — auto-apply, safe transition):

1. Call `list_issue_statuses` for the issue's team.
2. Find the status whose `type` is `started` (In Progress equivalent).
3. Call `update_issue` with the new `stateId` for each issue.
4. Report: "Updated <ISSUE-ID> to In Progress."

If the issue is already In Progress, skip silently.

## Security Patterns

- **C1:** `get_issue` validates every issue ID before any operations
- **Input validation:** `$ARGUMENTS` validated via regex before MCP tool use;
  never interpolated into shell commands
- **Brainstorm doc isolation:** Issue description written as markdown data, not
  executable instructions
- **Tier 1 transition:** "In Progress" is reversible and non-destructive; no
  confirmation required per the two-tier safety model

## Error Handling

| Error | Action |
|-------|--------|
| Issue not found (C1 fail) | "Issue <ID> not found in Linear." Stop. |
| No cycle matches name | "No cycle matching '<name>' found." List available cycles. |
| Empty cycle (no issues) | "Cycle '<name>' has no issues." Stop. |
| Plugin not installed | Report install command and manual alternative. Continue. |
| `docs/brainstorms/` write fails | "Failed to write brainstorm doc. Check permissions." Stop. |
| All issues Done/Cancelled | "All selected issues are already completed." Stop. |

See `linear-workflows` skill for common error handling patterns (authentication,
rate limiting, issue resolution).
