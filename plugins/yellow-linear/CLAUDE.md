# yellow-linear Plugin

Linear MCP integration with PM workflows for issues, projects, initiatives, cycles, and documents.

## MCP Server

- **Linear** — Official HTTP endpoint at `https://mcp.linear.app/mcp`
- Authentication: OAuth on first use (handled by MCP client)
- No credentials stored in plugin code

## Conventions

- **Team context:** Linear team names match GitHub repo names. Auto-detected from `git remote get-url origin`.
- **Branch naming:** `<type>/<TEAM-ID>-<description>` (e.g., `feat/ENG-123-auth-flow`)
- **Issue ID pattern:** `[A-Z]+-\d+` extracted from branch name (first match wins)
- **PR creation:** Use Graphite (`gt submit`), not `gh pr create`. Use `gh pr view` / `gh api` for reading PR state only.
- **Status transitions:** Read valid statuses from `list_issue_statuses`, never hardcode status names.

## Plugin Components

### Commands (5)

- `/linear:create` — Create a Linear issue from current context
- `/linear:sync` — Sync current branch with its Linear issue (load context, link PR, update status)
- `/linear:triage` — Review and assign incoming Linear issues
- `/linear:plan-cycle` — Plan sprint cycle by selecting backlog issues
- `/linear:status` — Generate project and initiative health report

### Agents (3)

**Workflow:**
- `linear-issue-loader` — Auto-load Linear issue context from branch name
- `linear-pr-linker` — Suggest linking PRs to Linear issues and syncing status

**Research:**
- `linear-explorer` — Deep search and analysis of Linear backlog

### Skills (1)

- `linear-workflows` — Reference patterns and conventions for Linear workflows

## Known Limitations

- MCP-only — no offline mode, no direct GraphQL fallback
- Manual retry on transient failures (MCP client doesn't auto-retry)
- Pagination capped at 30-50 items per query to stay within rate limits
