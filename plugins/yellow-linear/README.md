# yellow-linear

Linear MCP integration with PM workflows for issues, projects, initiatives,
cycles, and documents.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-linear@yellow-plugins
```

## Prerequisites

- Linear account ([linear.app](https://linear.app))
- Browser access for OAuth login on first use
- Graphite CLI (`gt`) for branch management

On first MCP tool call, Claude Code opens a browser popup to authenticate with
your Linear account. The OAuth token is stored in your system keychain and
refreshed automatically. No API keys or `.env` files needed.

Requires browser access — will not work in headless SSH sessions. To
re-authenticate or revoke access: run `/mcp` in Claude Code, select the Linear
server, and choose "Clear authentication".

Run `/linear:setup` after install or after clearing auth to verify that the MCP
server is visible in the current session.

## Commands

| Command              | Description                                                                      |
| -------------------- | -------------------------------------------------------------------------------- |
| `/linear:setup`      | Validate Linear MCP visibility, OAuth readiness, and Graphite availability       |
| `/linear:work`       | Start working on a Linear issue — loads context and routes to plan or stack      |
| `/linear:create`     | Create a Linear issue from current context                                       |
| `/linear:sync`       | Sync current branch with its Linear issue (load context, link PR, update status) |
| `/linear:sync-all`   | Audit open issues and close ones with merged PRs                                 |
| `/linear:triage`     | Review and assign incoming Linear issues                                         |
| `/linear:plan-cycle` | Plan sprint cycle by selecting backlog issues                                    |
| `/linear:status`     | Generate project and initiative health report                                    |
| `/linear:delegate`   | Delegate a Linear issue to a Devin AI session                                    |

## Agents

| Agent                 | Description                                     |
| --------------------- | ----------------------------------------------- |
| `linear-issue-loader` | Auto-load Linear issue context from branch name |
| `linear-pr-linker`    | Link PRs to Linear issues and sync status       |
| `linear-explorer`     | Deep search and analysis of Linear backlog      |

## Skills

| Skill              | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `linear-workflows` | Reference patterns and conventions for Linear workflows |

## MCP Servers

| Server | URL                          | Auth                  |
| ------ | ---------------------------- | --------------------- |
| Linear | `https://mcp.linear.app/mcp` | OAuth (browser popup) |

## Security

Linear issue text is treated as untrusted. `/linear:work` and the
`linear-issue-loader` agent redact credential-like lines, such as API keys,
tokens and `*_API_KEY=` assignments, as soon as the text is fetched. They
show and save only the redacted copy, fenced as reference-only.

## Graphite Merge Queue

With Graphite's merge queue (Parallel CI), a landed PR shows as `CLOSED`, not
`MERGED`, on GitHub, so Linear's "PR merged" automation never moves the issue to
Done. The squash commit still lands on the default branch with the PR number
appended, and its message is the PR title plus description. Two things make
Linear follow it:

1. **Closing words in the commit body.** `smart-submit` and `/flow:work` end the
   commit body with `Part of <ISSUE-ID>`, or `Closes <ISSUE-ID>` on the commit
   that completes the issue, when the branch name or stack item carries a Linear
   ID. `gt-amend` keeps an existing line and never adds one. Graphite copies the
   body into the PR description.
2. **One-time setup, per Linear's GitHub integration docs.** In Linear,
   Settings > Integrations > GitHub, turn on "Link commits to issues with magic
   words" and copy the webhook URL and secret. In the GitHub repository,
   Settings > Webhooks, add a webhook with that URL and secret, content type
   `application/json`, for push events. Confirm the team's "On PR or commit
   merge" status (Settings > Team > Workflow) is Done.

`/linear:sync`, `/linear:sync-all` and the `linear-pr-linker` agent also treat a
`CLOSED` PR as merged when its `(#<number>)` squash commit is on the default
branch (`scripts/pr-landed.sh`; a heuristic, so every status change stays behind
your confirmation), so a missed closing word is caught on the next sync.

## Limitations

- MCP-only — no offline mode
- Manual retry on transient failures
- Pagination capped at 30-50 items per query

## License

MIT
