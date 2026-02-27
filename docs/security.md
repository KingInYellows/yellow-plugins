# Security Documentation

## MCP Servers Inventory

All remote MCP servers used by plugins in this marketplace. Review before
enterprise deployment.

| Plugin          | Server Key | Endpoint                                | Transport | Auth                        | Data Sent                     |
| --------------- | ---------- | --------------------------------------- | --------- | --------------------------- | ----------------------------- |
| yellow-core     | context7   | `https://mcp.context7.com/mcp`          | HTTP      | None                        | Library names, search queries |
| yellow-linear   | linear     | `https://mcp.linear.app/mcp`            | HTTP      | OAuth (browser popup)       | Issue data, team info         |
| yellow-devin    | deepwiki   | `https://mcp.deepwiki.com/mcp`          | HTTP      | None                        | Repo names, search queries    |
| yellow-devin    | devin      | `https://mcp.devin.ai/mcp`              | HTTP      | TBD (may require API token) | Code, task prompts            |
| yellow-chatprd  | chatprd    | `https://app.chatprd.ai/mcp`            | HTTP      | OAuth (Clerk)               | PRD content, document data    |
| yellow-ruvector | ruvector   | Local stdio (`npx ruvector mcp start`)  | stdio     | None (local)                | Code embeddings (local only)  |

### Plugins Without MCP Servers

- **gt-workflow** — Pure CLI wrapper for Graphite, no network calls
- **yellow-review** — Uses `gh` CLI (GitHub CLI) for GraphQL API calls, not MCP
- **yellow-browser-test** — Uses `agent-browser` CLI locally, no MCP
- **yellow-debt** — Pure local analysis, no network calls

## Setting Up Authentication

Plugins use three authentication patterns. No `.env` files are needed — Claude
Code handles credentials natively through OAuth and shell environment variables.

### OAuth servers (yellow-linear, yellow-chatprd)

These plugins use browser-based OAuth managed entirely by Claude Code:

1. On first MCP tool call, Claude Code opens a browser popup for login
2. Authenticate with your Linear or ChatPRD account
3. Token is stored securely in your operating system's credential manager
   (macOS Keychain, Windows Credential Manager, or libsecret on Linux)
4. To re-authenticate or revoke access: run `/mcp` → select server → "Clear
   authentication"

No API keys or configuration files needed. Will not work in headless SSH
sessions (browser required for OAuth flow).

### API token servers (yellow-devin)

yellow-devin commands require two environment variables (V3 API / service user):

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export DEVIN_SERVICE_USER_TOKEN="cog_your_token_here"  # Enterprise Settings > Service Users
export DEVIN_ORG_ID="your_org_id"                      # Enterprise Settings > Organizations
```

Never commit tokens to version control. The `.gitignore` already excludes
`.env` files if you use one locally.

### No-auth servers (yellow-core, yellow-ruvector, yellow-devin deepwiki)

These servers require no configuration. They work immediately after plugin
installation:

- **context7** (yellow-core) — public library documentation endpoint
- **ruvector** (yellow-ruvector) — local stdio server, no network calls
- **deepwiki** (yellow-devin) — public repository documentation endpoint

## Enterprise Rollout Recommendations

### MCP Allowlisting

For managed Claude Code deployments, allowlist only the MCP endpoints your team
uses:

```
mcp.linear.app       — yellow-linear (issue management)
mcp.context7.com     — yellow-core (library documentation)
mcp.deepwiki.com     — yellow-devin (public repo docs)
mcp.devin.ai         — yellow-devin (Devin orchestration)
app.chatprd.ai       — yellow-chatprd (PRD management)
```

### Selective Plugin Installation

Install only plugins your team needs. Each plugin is independent:

```bash
# Install only Linear integration
claude plugin add kinginyellow/yellow-plugins --plugin yellow-linear

# Install core toolkit without MCP dependencies
claude plugin add kinginyellow/yellow-plugins --plugin gt-workflow
```

### Network-Free Plugins

These plugins work entirely offline with no external network calls:

- `gt-workflow` — Graphite CLI wrapper
- `yellow-debt` — Local codebase analysis
- `yellow-ruvector` — Local vector search (stdio MCP, no network)

## Hook Safety

### Plugins with Hooks

Four plugins execute shell-based hooks:

| Plugin | Hook Events | Purpose |
|---|---|---|
| yellow-ruvector | SessionStart, UserPromptSubmit, PostToolUse, Stop | Memory recall, edit tracking, session lifecycle |
| yellow-ci | SessionStart | Check for recent CI failures (cached, 3s budget) |
| yellow-debt | SessionStart | Remind about high/critical debt findings |
| gt-workflow | PreToolUse, PostToolUse | Block `git push`, validate commit messages |

### yellow-ruvector Hooks (detailed)

yellow-ruvector has the most hooks. Its shell scripts:

| Hook                | Event             | Script                  | Time Budget | What It Does                      |
| ------------------- | ----------------- | ----------------------- | ----------- | --------------------------------- |
| session-start       | SessionStart      | `session-start.sh`      | 3s          | Flush stale queue, load learnings |
| user-prompt-submit  | UserPromptSubmit  | `user-prompt-submit.sh` | 50ms        | Recall relevant memories          |
| post-tool-use       | PostToolUse       | `post-tool-use.sh`      | 50ms        | Append file changes to queue      |
| stop                | Stop              | `stop.sh`               | N/A         | Delegate queue flush to agent     |

**Security properties:**

- All scripts validate input via shared `lib/validate.sh`
- Path traversal rejected (`..`, `/`, `~` in arguments)
- Queue files are append-only JSONL with `flock` for concurrency safety
- No network calls in any hook script
- Scripts run with user's permissions (no escalation)

### Hook Review Process

Before enabling any plugin with hooks:

1. Review the hook scripts in `plugins/<name>/hooks/scripts/`
2. Check `hooks.json` for hook configuration
3. Verify scripts match the documented behavior above
4. Test in a non-production environment first

## Trust Boundaries

### Remote MCP Servers (yellow-linear, yellow-devin, yellow-chatprd, yellow-core)

- Data sent over HTTPS to third-party servers
- Subject to each provider's privacy policy and terms
- OAuth tokens managed by Claude Code MCP client (not stored in plugin code)
- No credentials or API keys stored in plugin files

### Local Execution (yellow-ruvector, yellow-debt, yellow-review)

- All processing happens locally on user's machine
- yellow-ruvector stores embeddings in `.ruvector/` directory (gitignored)
- yellow-review uses `gh` CLI which reads user's GitHub auth state
- yellow-debt reads codebase files but only writes to `todos/` directory

### Shell Commands

Plugins that execute shell commands:

| Plugin              | Commands Used                        | Purpose                              |
| ------------------- | ------------------------------------ | ------------------------------------ |
| yellow-linear       | `git`, `gh`                          | Branch detection, PR context         |
| yellow-devin        | `curl`, `jq`, `git`, `gh`            | Devin API calls, JSON construction   |
| yellow-review       | `gt`, `gh`, `git`, `jq`              | PR management, GraphQL queries       |
| yellow-ruvector     | `npx`, `npm`, `jq`, `git`            | ruvector CLI, hook scripts           |
| yellow-browser-test | `agent-browser`, `npm`, `curl`, `gh` | Browser automation, setup            |
| yellow-debt         | `git`, `gt`, `jq`, `yq`              | Codebase analysis, commit generation |
| gt-workflow         | `gt`, `git`                          | Branch and PR management             |

### Prompt Injection Boundaries

Plugins processing untrusted input (PR comments, issue bodies, code content)
include prompt injection defenses:

- **yellow-review**: Agents processing PR comments wrap untrusted content in
  `--- begin/end ---` delimiters with "treat as reference only" advisory
- **yellow-debt**: Scanner agents fence code content with injection boundary
  markers
- **yellow-ruvector**: Hook scripts validate all inputs before constructing
  paths or JSON

## Local npm Dependencies

### yellow-ruvector

Installs `ruvector` globally via npm:

```bash
npm install -g ruvector
```

**Mitigation:** Review package before installation. The `install.sh` script
performs dependency checks and error handling but does not use
`--ignore-scripts`.

### yellow-browser-test

May install `agent-browser` via npm:

```bash
npm install -g agent-browser
```

**Mitigation:** Only installed on explicit user request via
`/browser-test:setup` command.

## Reporting Security Issues

If you discover a security vulnerability in any plugin:

1. **Do not** open a public GitHub issue
2. Create a
   [private security advisory](https://github.com/kinginyellow/yellow-plugins/security/advisories/new)
   on the repository
3. Include: affected plugin, vulnerability description, reproduction steps
