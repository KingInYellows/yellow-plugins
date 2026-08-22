# yellow-cursor

Cursor Cloud Agent integration — delegate coding tasks to Cursor's cloud agents
from Claude Code, track their progress, and manage their lifecycle. All
integration runs through a small typed CLI (`dist/cli.js`); the plugin commands
are thin, confirmation-gated wrappers around it.

## Install

```text
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-cursor@yellow-plugins
```

Then run `/cursor:setup` to detect credentials and the `@cursor/sdk` runtime.

## Prerequisites

- **Authentication** — one of:
  - `CURSOR_API_KEY` environment variable, or
  - a Cursor stored login (`~/.cursor/sdk/auth.json`, written by Cursor's own
    login flow — this plugin never performs that login on your behalf).

  Credentials are never read from command-line arguments and never printed by
  any command in this plugin.

- **`@cursor/sdk`** — resolved automatically if present in your workspace;
  otherwise `/cursor:setup --install-sdk` installs the pinned version into the
  plugin's own data directory. No global install required.
- **`jq`** — used by every command to parse the CLI's JSON output.

Run `/cursor:setup` after install (and again any time `CURSOR_API_KEY` changes)
to confirm both are in place.

## The Agent/Run model

A Cursor **Agent** is a persistent unit of work against one repository. Creating
one does nothing by itself — the first message you send to it (the initial
delegation prompt, or a later follow-up) is what actually creates work
server-side, as a **Run**. Each run has its own status, and may end up with a
target branch and a pull request. One agent can accumulate several runs over its
lifetime as you follow up on it.

## Commands

| Command | Description |
| --- | --- |
| `/cursor:setup` | Detect credentials and SDK, optionally install `@cursor/sdk` |
| `/cursor:delegate` | Launch a new Cursor Cloud Agent on a repo + prompt (dry-run validated, confirmed, billable) |
| `/cursor:list` | List agents, merged with local state (`--archived` to include archived ones) |
| `/cursor:status` | Check live status of an agent (and optionally a run), with reconciliation |
| `/cursor:follow-up` | Send a follow-up prompt to an existing agent (confirmed, billable) |
| `/cursor:cancel` | Cancel a running run (confirmed) |
| `/cursor:artifacts` | List or download artifacts a run produced |
| `/cursor:usage` | Show token usage and cost for an agent |
| `/cursor:archive` | Hide an agent from default listing (confirmed) |
| `/cursor:unarchive` | Restore an archived agent to default listing (confirmed) |

### Example

```text
/cursor:delegate --repo https://github.com/org/repo --prompt "Fix the flaky retry test in tests/retry.spec.ts" --ref main
```

This first runs a zero-network dry run and shows you the resolved plan
(repository, ref, model) with an explicit note that launching spends money, then
asks you to confirm before the real, billable launch happens.

```text
/cursor:status --agent-id <id>
/cursor:follow-up --agent-id <id> --prompt "Also update the changelog"
/cursor:artifacts --agent-id <id>
```

## Security and billing model

- **Every billable action requires explicit confirmation.** `delegate` and
  `follow-up` both show a plan (or summary) and require you to confirm before
  the real network call happens — no command in this plugin passes `--yes`
  without asking first.
- **No delete.** Nothing here can delete an agent. `archive`/`unarchive` are the
  only lifecycle-management operations, and both are idempotent.
- **Idempotency.** Every delegate/follow-up call carries an idempotency key
  (yours, or one generated for you). If a launch fails ambiguously — a network
  error _after_ the message was actually sent — the command tells you to check
  status rather than silently retrying, and any retry you do choose to run must
  reuse that same key so it can't accidentally create a second paid run.
- **Concurrency cap.** `delegate` checks the number of active agents for a
  repository against a limit (`--max-active`, default 3) before launching.
- **No nested delegation.** An agent that is itself running inside a
  remote-delegated context refuses to delegate or follow up further.
- **Credentials are never printed.** Setup reports where a credential came from
  (`env` / `stored-login` / `none`), never its value.

## Limitations

- **Single-agent v1** — no fan-out to multiple agents in one command, no batch
  delegation.
- **`artifacts` and `usage` are capability-gated** — some SDK/account
  combinations don't support them; that's a permanent condition (the command
  tells you so), not something worth retrying.
- **`follow-up` has no dry-run** — the confirmation step shows a plain summary
  of the agent id and prompt rather than a CLI-validated plan.
- **No account-wide usage endpoint** — `/cursor:usage` is always scoped to one
  agent.

## Migrating from yellow-devin

If you're moving delegated-agent workflows from `yellow-devin` to
`yellow-cursor`, the closest command mapping is:

| yellow-devin      | yellow-cursor      |
| ----------------- | ------------------ |
| `/devin:delegate` | `/cursor:delegate` |
| `/devin:status`   | `/cursor:status`   |
| `/devin:cancel`   | `/cursor:cancel`   |
| `/devin:archive`  | `/cursor:archive`  |

The biggest behavioral difference: yellow-cursor always dry-run validates and
confirms before a billable launch, and never auto-retries an ambiguous outcome —
where applicable, check your existing Devin-delegation callers (e.g.
`/linear:delegate`) for provider-specific assumptions before switching them
over.

## License

MIT
