# gt-workflow

Graphite-native workflow commands for Claude Code. Manages stacked PRs, smart commits with code auditing, repo sync, and stack navigation — all through the `gt` CLI.

## Commands

### `/smart-submit`

Stage, audit, and submit changes via Graphite in one flow.

- Runs 3 parallel code review agents (quality, security, silent failures)
- Stages specific files (never `git add .`)
- Auto-generates conventional commit messages from diff analysis
- Detects trunk vs feature branch for correct `gt` command
- Supports `--amend`, `--dry-run`, `--no-verify`

```
/smart-submit
/smart-submit --amend
/smart-submit --dry-run
```

### `/gt-stack-plan`

Plan a series of stacked PRs for a feature, ordered by dependency.

- Explores codebase to understand scope
- Proposes ordered stack with branch names, commit types, and sizes
- Optionally scaffolds all branches via `gt create`

```
/gt-stack-plan add user authentication with OAuth
/gt-stack-plan refactor the payment processing pipeline
```

### `/gt-sync`

One-command repo sync, restack, and cleanup.

- Syncs trunk via `gt repo sync`
- Restacks branches if needed
- Reports conflicts clearly with resolution instructions
- Cleans up merged branches

```
/gt-sync
/gt-sync --no-delete
```

### `/gt-nav`

Visualize your stack and navigate between branches.

- Shows full stack visualization with PR status
- Interactive navigation: up, down, top, bottom, or specific branch
- Quick jump with `--top` or `--bottom`

```
/gt-nav
/gt-nav --top
/gt-nav --pr
```

## Installation

Add this marketplace to Claude Code:

```
claude mcp add-marketplace yellow-plugins https://github.com/kinginyellow/yellow-plugins
```

Or install the plugin directly from a local clone:

```
claude plugin add ./plugins/gt-workflow
```

## Requirements

- [Graphite CLI](https://graphite.dev/docs/graphite-cli) (`gt`) installed and authenticated
- Git repository initialized with Graphite (`gt init`)

## License

MIT
