# gt-workflow Plugin

Graphite-native workflow commands for stacked PR development.

## Conventions

- **ALWAYS** use `gt` (Graphite CLI) for branch management, commits, and PR submission
- **NEVER** use raw `git push` or `gh pr create` — Graphite manages the stack
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Keep commits atomic and focused — one concern per PR in a stack

## Key `gt` Commands

| Command | Purpose |
|---------|---------|
| `gt create <name> -m "msg"` | Create a new branch (stacks on current) |
| `gt commit create -m "msg"` | Add a commit to current branch |
| `gt commit amend -m "msg"` | Amend the current branch commit |
| `gt submit --no-interactive` | Push stack and create/update PRs |
| `gt repo sync` | Fetch trunk, detect merged branches |
| `gt stack restack` | Rebase stack on latest trunk |
| `gt log` / `gt log short` | Visualize the stack |
| `gt up` / `gt down` | Navigate up/down the stack |
| `gt top` / `gt bottom` | Jump to top/bottom of stack |
| `gt trunk` | Show trunk branch name |
| `gt checkout <name>` | Switch to a branch |
| `gt pr` | Show PR link for current branch |
| `gt continue` | Continue after resolving conflicts |

## Plugin Commands

- `/smart-submit` — Audit + commit + submit in one flow
- `/gt-stack-plan` — Plan stacked PRs for a feature
- `/gt-sync` — Sync repo, restack, clean up
- `/gt-nav` — Visualize and navigate the stack
