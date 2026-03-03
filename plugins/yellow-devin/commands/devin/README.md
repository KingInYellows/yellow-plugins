# Devin Commands

Slash commands for managing Devin V3 sessions — delegate tasks, monitor
progress, send messages, and research codebases.

## Command Reference

| Command | Description | Arguments | Example |
|---|---|---|---|
| `/devin:setup` | Validate V3 credentials and permissions with live API probes. | _(none)_ | `/devin:setup` |
| `/devin:delegate` | Create a new Devin session with a task prompt. | `<task description> [--tags t1,t2] [--max-acu N]` | `/devin:delegate Refactor the auth module --tags auth,refactor --max-acu 5` |
| `/devin:status` | Check status of a specific session or list recent sessions. | `[session-id] [--tag TAG] [--status STATUS] [--archived]` | `/devin:status abc123 ` |
| `/devin:message` | Send a follow-up message to an active session (auto-resumes suspended sessions). | `<session-id> <message>` | `/devin:message abc123 Please also add unit tests` |
| `/devin:cancel` | Terminate a running session after user confirmation. | `<session-id>` | `/devin:cancel abc123` |
| `/devin:wiki` | Query DeepWiki or Devin Wiki about a repository's architecture and patterns. | `<question> [--repo owner/repo]` | `/devin:wiki How does authentication work --repo acme/backend` |
| `/devin:archive` | Archive a session to hide it from the default status listing. | `<session-id>` | `/devin:archive abc123` |
| `/devin:tag` | Add, remove, or list tags on a session. | `<session-id> <add\|remove\|list> [tags...]` | `/devin:tag abc123 add sprint-42 bug-fix` |

## Prerequisites

All commands (except `/devin:wiki`) require:

- `DEVIN_SERVICE_USER_TOKEN` — service user credential (`cog_` prefix)
- `DEVIN_ORG_ID` — organization ID
- `curl` and `jq` installed

Run `/devin:setup` after first install or token rotation to verify credentials.

## See Also

- [Plugin README](../../README.md) — install instructions, MCP servers, and
  troubleshooting
- `devin-workflows` skill — shared V3 API patterns and error handling
