# gt-workflow Plugin

Graphite-native workflow commands for stacked PR development.

## Conventions

- **ALWAYS** use `gt` (Graphite CLI) for branch management, commits, and PR
  submission
- **NEVER** use raw `git push` or `gh pr create` — Graphite manages the stack
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Keep commits atomic and focused — one concern per PR in a stack

## Key `gt` Commands

| Command                      | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `gt create <name> -m "msg"`  | Create a new branch (stacks on current) |
| `gt modify -m "msg"`         | Update the current branch's default commit (preferred) |
| `gt modify --commit -m "msg"` | Add an extra commit to the current branch when intentional |
| `gt commit create -m "msg"`  | Add a commit (deprecated, use `gt modify --commit`) |
| `gt commit amend -m "msg"`   | Amend the current branch commit         |
| `gt submit --no-interactive` | Push stack and create/update PRs        |
| `gt repo sync`               | Fetch trunk, detect merged branches     |
| `gt stack restack`           | Rebase stack on latest trunk            |
| `gt log` / `gt log short`    | Visualize the stack                     |
| `gt up` / `gt down`          | Navigate up/down the stack              |
| `gt top` / `gt bottom`       | Jump to top/bottom of stack             |
| `gt trunk`                   | Show trunk branch name                  |
| `gt checkout <name>`         | Switch to a branch                      |
| `gt pr`                      | Show PR link for current branch         |
| `gt continue`                | Continue after resolving conflicts      |

## Plugin Commands

- `/gt-setup` — validate Graphite CLI, auth detection, and repo initialization
- `/smart-submit` — Audit + commit + submit in one flow
- `/gt-amend` — Audit + amend current branch commit + re-submit (quick fix path)
- `/gt-stack-plan` — Plan stacked PRs for a feature
- `/gt-sync` — Sync repo, restack, clean up
- `/gt-nav` — Visualize and navigate the stack

## Submit Paths

- **`/smart-submit`** — Ad-hoc commit+submit for working changes. Runs 3-agent
  audit (code review, security, silent failures), generates conventional commit,
  submits via Graphite. Use when committing standalone changes outside a plan.
- **`/workflows:work`** (yellow-core) — Plan-driven implementation. Delegates to
  `/smart-submit` in its final phase. Use when executing a structured plan from
  `/workflows:plan`.

Both paths use `gt submit --no-interactive` for submission.

## Hooks

- **PreToolUse (Bash)** — Backstop that blocks raw `git push` and points the
  workflow back to `gt submit --no-interactive`
- **PostToolUse (Bash)** — Warns when a `gt commit`, `gt modify`, or
  `gt create` command uses a non-conventional commit message (warn-only, never
  blocks execution)

### Input Integrations

- **Linear issues** — `/gt-stack-plan` reads a `## Linear Issues` section from
  plan files (written by `/workflows:plan` when Linear context is detected).
  When present, defaults to 1:1 issue-to-branch mapping with
  `feat/<ISSUE-ID>-<slug>` naming and outputs an issue-to-branch table. This is
  input-only (reads plan metadata) and does not create a runtime dependency on
  yellow-linear.

### MCP Tool Integration

- **ruvector** — Not directly integrated. gt-workflow commands are thin
  wrappers around Graphite CLI; memory operations happen in calling workflows
  (e.g., `/workflows:work`). Graceful skip if yellow-ruvector not installed.
- **morph** — Not applicable. gt-workflow operates on git/Graphite CLI, not
  file editing.
