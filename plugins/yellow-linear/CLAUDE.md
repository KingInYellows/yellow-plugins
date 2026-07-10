# yellow-linear Plugin

Linear MCP integration with PM workflows for issues, projects, initiatives,
cycles, and documents.

## MCP Server

- **Linear** — Official HTTP endpoint at `https://mcp.linear.app/mcp`
- Authentication: OAuth on first use (handled by MCP client)
- No credentials stored in plugin code

## Conventions

- **Team context:** Auto-detected from `git remote get-url origin` → matched
  against `list_teams`. If multiple teams match the same repo name, prompt user
  to disambiguate. Case-sensitive exact match.
- **Branch naming:** `<type>/<TEAM-ID>-<description>` (e.g.,
  `feat/ENG-123-auth-flow`)
- **Issue ID pattern:** `[A-Z]{2,5}-[0-9]{1,6}` extracted from branch name
  (case-sensitive, first match wins)
- **PR creation:** Use Graphite (`gt submit`), not `gh pr create`. Use
  `gh pr view` / `gh api` for reading PR state only.
- **Status transitions:** Read valid statuses from `list_issue_statuses`, never
  hardcode status names.
- **Input validation:** All `$ARGUMENTS` values must be validated before use.
  See `linear-workflows` skill for format rules.

## Plugin Components

### Commands (9)

- `/linear:setup` — Validate Linear MCP visibility, first-use OAuth readiness,
  and Graphite availability
- `/linear:work` — Start working on a Linear issue: loads context, writes
  brainstorm doc, routes to `/workflows:plan` or `/gt-stack-plan`
- `/linear:create` — Create a Linear issue from current context
- `/linear:sync` — Sync current branch with its Linear issue (load context, link
  PR, update status). Supports `--after-submit` for Tier 1 auto-apply.
- `/linear:sync-all` — Audit open Linear issues and close ones with merged PRs
- `/linear:triage` — Review and assign incoming Linear issues. Offers "What
  Next?" routing to `/linear:work` or `/linear:delegate` after triage.
- `/linear:plan-cycle` — Plan sprint cycle by selecting backlog issues. Offers
  "What Next?" routing after planning.
- `/linear:status` — Generate project and initiative health report
- `/linear:delegate` — Delegate a Linear issue to a Devin AI session (requires
  `DEVIN_SERVICE_USER_TOKEN` + `DEVIN_ORG_ID` as **shell** env exports;
  installing yellow-devin sets up the credentials but you must still `export`
  them to your shell, not a hard plugin dependency)

### Agents (3)

**Workflow:**

- `linear-issue-loader` — Auto-load Linear issue context from branch name
- `linear-pr-linker` — Suggest linking PRs to Linear issues and syncing status

**Research:**

- `linear-explorer` — Deep search and analysis of Linear backlog

### Skills (1)

- `linear-workflows` — Reference patterns and conventions for Linear workflows

## When to Use What

Commands and agents overlap intentionally to serve different invocation
patterns:

- **`/linear:setup`** — First install, after clearing OAuth, or when ToolSearch
  no longer sees Linear MCP tools in the current session.
- **`/linear:sync`** — Manual, comprehensive sync: loads context + links PR +
  updates status in one shot. Use when you want full branch-to-issue
  synchronization.
- **`linear-issue-loader` agent** — Auto-triggers on branch checkout or "what's
  this issue?" questions. Read-only context loading.
- **`linear-pr-linker` agent** — Auto-triggers after `gt submit` or "link to
  linear" requests. Focused on PR linking + status suggestion.
- **`linear-explorer` agent** — Auto-triggers on "search linear", "is this a
  duplicate?" queries. Read-only backlog search.

For advanced workflows, agents can call Linear MCP tools directly (e.g.,
`get_issue`, `list_issues`) without going through commands.

## Cross-Plugin Dependencies

- **yellow-core** (optional) — `/linear:work` routes to `/workflows:plan` and
  `/workflows:work` via Skill tool. Without it, `/linear:work` writes the
  brainstorm doc but cannot invoke planning commands; suggests manual workflow.
- **gt-workflow** (optional) — `/linear:work` routes to `/gt-stack-plan` via
  Skill tool. Without it, suggests manual branch creation with `gt create`.
- **yellow-devin** (optional) — `/linear:delegate` validates the
  `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` **shell** environment
  variables, not plugin presence (see `delegate.md` Step 1). Installing
  yellow-devin provides setup guidance and userConfig/keychain storage for its
  own `/devin:*` commands, but `/linear:delegate` reads shell env directly —
  userConfig-only values must still be `export`ed to your shell (per
  `yellow-devin/commands/devin/setup.md`) for it to see them. Without the
  exports, `/linear:delegate` reports which variables to set.

## Known Limitations

- MCP-only — no offline mode, no direct GraphQL fallback
- Manual retry on transient failures (MCP client doesn't auto-retry)
- Pagination capped at 30-50 items per query to stay within rate limits
