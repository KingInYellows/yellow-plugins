# yellow-devin Plugin

Devin.AI integration for multi-agent workflows — delegate tasks, research
codebases via DeepWiki, orchestrate plan-implement-review chains.

## MCP Servers

- **DeepWiki** — Public HTTP endpoint at `https://mcp.deepwiki.com/mcp`
  - No authentication required
- **Devin** — Private HTTP endpoint at `https://mcp.devin.ai/mcp`
  - Authentication mechanism TBD — may require `DEVIN_API_TOKEN` (see Known
    Limitations)

## Conventions

- **API calls:** All session management via `curl` to `api.devin.ai/v1/`. Auth
  via `DEVIN_API_TOKEN` env var (Bearer token).
- **JSON construction:** Always use `jq` — never interpolate user input into
  JSON strings.
- **Shell quoting:** Always quote variables: `"$VAR"` not `$VAR`.
- **Git workflow:** Use Graphite (`gt`) for all branch management and PR
  creation — never raw `git push` or `gh pr create`.
- **Input validation:**
  - Token format: `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$`
  - Session ID: `^ses_[a-zA-Z0-9]{20,64}$`
  - Task prompts: max 8000 characters
  - Messages: max 2000 characters
- **Error handling:** Check curl exit code, HTTP status code, jq exit code on
  every API call. See `devin-workflows` skill for patterns.
- **Write safety:** C1 (validate before write), M3 (confirm destructive ops like
  cancel).
- **Never echo tokens** in error messages or debug output.

## Plugin Components

### Commands (5)

- `/devin:delegate` — Create a Devin session with a task prompt
- `/devin:status` — Check session status and recent output
- `/devin:message` — Send follow-up message to active session
- `/devin:cancel` — Terminate a running session (requires confirmation)
- `/devin:wiki` — Query DeepWiki/Devin Wiki about a repository

### Agents (1)

**Workflow:**

- `devin-orchestrator` — Multi-step plan-implement-review-fix cycles with Devin

### Skills (1)

- `devin-workflows` — Shared conventions, API reference, error codes

## When to Use What

Commands and the orchestrator agent overlap intentionally to serve different
invocation patterns:

| Capability     | Command           | Agent              | When to Use                                                         |
| -------------- | ----------------- | ------------------ | ------------------------------------------------------------------- |
| Create session | `/devin:delegate` | devin-orchestrator | Command for one-off delegation; agent for multi-step cycles         |
| Check progress | `/devin:status`   | devin-orchestrator | Command for manual checks; agent polls automatically                |
| Send message   | `/devin:message`  | devin-orchestrator | Command for ad-hoc messages; agent for review feedback              |
| Cancel session | `/devin:cancel`   | —                  | Always manual (M3 destructive op)                                   |
| Research repo  | `/devin:wiki`     | —                  | Command for quick queries; use Explore agent type for deep research |

For advanced workflows, the orchestrator agent calls Devin REST API directly via
Bash (curl) for session management.

## Known Limitations

- MCP-only for wiki queries — no offline mode
- Session state not persisted locally — after Claude Code restart, use
  `/devin:status` to re-discover active sessions from the API
- Devin MCP auth mechanism at `mcp.devin.ai` unverified — may need to be
  deferred to v2
- Polling-based session monitoring — no push/webhook support
- Manual retry on transient failures (no auto-reconnect)
- Pagination capped at 10 sessions per query to stay within rate limits
