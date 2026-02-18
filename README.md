# yellow-plugins

Personal Claude Code plugin marketplace — 10 plugins for Git workflows, code
review, CI, testing, and more.

## Install

Add the marketplace, then install individual plugins:

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install gt-workflow@yellow-plugins
```

## Plugins

| Plugin                | Description                                                                                                 | Components                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `gt-workflow`         | Graphite-native workflow commands for stacked PRs, smart commits, sync, and stack navigation                | 5 commands, 1 hook                             |
| `yellow-browser-test` | Autonomous web app testing with agent-browser — auto-discovery, structured flows, and bug reporting         | 3 agents, 4 commands, 2 skills                 |
| `yellow-chatprd`      | ChatPRD MCP integration with document management and Linear bridging                                        | 2 agents, 5 commands, 1 skill, 1 MCP           |
| `yellow-ci`           | CI failure diagnosis, workflow linting, and runner health management for self-hosted GitHub Actions runners | 3 agents, 5 commands, 2 skills, 1 hook         |
| `yellow-core`         | Dev toolkit with review agents, research agents, and workflow commands for TS/Py/Rust/Go                    | 10 agents, 3 commands, 2 skills, 1 MCP         |
| `yellow-debt`         | Technical debt audit and remediation with parallel scanner agents for AI-generated code patterns            | 7 agents, 5 commands, 1 skill                  |
| `yellow-devin`        | Devin.AI integration for multi-agent workflows — delegate tasks, research codebases via DeepWiki            | 1 agent, 5 commands, 1 skill, 2 MCP            |
| `yellow-linear`       | Linear MCP integration with PM workflows for issues, projects, initiatives, cycles, and documents           | 3 agents, 5 commands, 1 skill, 1 MCP           |
| `yellow-review`       | Multi-agent PR review with adaptive agent selection, parallel comment resolution, and stack review          | 8 agents, 3 commands, 1 skill                  |
| `yellow-ruvector`     | Persistent vector memory and semantic code search for Claude Code agents via ruvector                       | 2 agents, 6 commands, 2 skills, 3 hooks, 1 MCP |

## MCP Servers & Authentication

Five plugins connect to external MCP servers. All work without authentication,
but some offer enhanced access with an API key or account.

| Plugin            | MCP Server | Free Tier                  | Authenticated Tier                          |
| ----------------- | ---------- | -------------------------- | ------------------------------------------- |
| `yellow-core`     | Context7   | Works immediately (lower rate limits) | Free API key for higher limits |
| `yellow-devin`    | DeepWiki   | Public repos only          | Private repos via Devin API key             |
| `yellow-devin`    | Devin      | —                          | Requires `DEVIN_API_TOKEN`                  |
| `yellow-linear`   | Linear     | —                          | OAuth (browser popup on first use)          |
| `yellow-chatprd`  | ChatPRD    | —                          | OAuth (browser popup on first use)          |
| `yellow-ruvector` | ruvector   | Local stdio — no auth      | —                                           |

### Context7 (yellow-core)

Provides up-to-date library documentation for LLMs. Works without an API key
but with lower rate limits.

**Free (no key):** Works out of the box. The plugin connects to
`https://mcp.context7.com/mcp` with no configuration needed.

**Free API key (higher rate limits):** Create an account at
[context7.com/dashboard](https://context7.com/dashboard) and generate an API
key (format: `ctx7sk_...`). Then configure it in your Claude Code settings:

```bash
# Option 1: Add API key header to the MCP server config
# In Claude Code, run /mcp → select context7 → edit config → add header:
#   "headers": { "CONTEXT7_API_KEY": "ctx7sk_your_key_here" }

# Option 2: OAuth (if your MCP client supports it)
# Use the endpoint https://mcp.context7.com/mcp/oauth instead of /mcp
```

### DeepWiki (yellow-devin)

Provides AI-powered documentation for any GitHub repository.

**Free (public repos):** Works out of the box at `https://mcp.deepwiki.com/mcp`.
No authentication needed for public repositories.

**Private repos (requires Devin account):** Private repository access uses the
Devin MCP server (`https://mcp.devin.ai/mcp`) with a Devin API key. This is the
same `DEVIN_API_TOKEN` used by the Devin plugin — see below.

### Devin (yellow-devin)

Requires a Devin account and API token for all operations.

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export DEVIN_API_TOKEN="apk_your_token_here"

# Get your token: https://devin.ai/settings/api
```

Never commit tokens to version control.

### Linear & ChatPRD (OAuth)

On first MCP tool call, Claude Code opens a browser popup to authenticate with
your Linear or ChatPRD account. Tokens are stored in your system keychain and
refresh automatically.

To re-authenticate or revoke access: run `/mcp` in Claude Code, select the
server, and choose "Clear authentication".

These plugins require browser access and **will not work in headless SSH
sessions**.

### ruvector (yellow-ruvector)

Runs locally as a stdio MCP server via `npx`. No external services or API keys
required. Run `/ruvector:setup` on first use to install.

## Usage

After installing, use `/plugin install <name>@yellow-plugins` to activate
individual plugins. Each plugin's commands are namespaced (e.g., `/ci:diagnose`,
`/linear:create`, `/devin:delegate`).

Run `/plugin` to browse all available plugins in the Discover tab.

## Update, Disable, Remove

```
/plugin marketplace update yellow-plugins
/plugin disable <plugin-name>@yellow-plugins
/plugin uninstall <plugin-name>@yellow-plugins
```

## Local Install (Development)

Clone the repo and add it as a local marketplace:

```bash
git clone https://github.com/KingInYellows/yellow-plugins.git
cd yellow-plugins
pnpm install
```

Then in Claude Code:

```
/plugin marketplace add ./
/plugin install gt-workflow@yellow-plugins
```

Verify `${CLAUDE_PLUGIN_ROOT}` resolves correctly after local install — local
installs copy plugins to `~/.claude/plugins/cache/`.

## Create a New Plugin

1. Create a directory under `plugins/`:

```
plugins/my-plugin/
  .claude-plugin/
    plugin.json
  commands/
    my-command.md
  CLAUDE.md
```

2. Add a minimal `plugin.json`:

```json
{
  "name": "my-plugin",
  "description": "What the plugin does",
  "version": "1.0.0",
  "author": { "name": "Your Name" }
}
```

3. Register in `.claude-plugin/marketplace.json`:

```json
{
  "name": "my-plugin",
  "description": "What the plugin does",
  "version": "1.0.0",
  "author": { "name": "Your Name" },
  "source": "./plugins/my-plugin"
}
```

4. Validate:

```bash
pnpm validate:schemas
```

See each plugin's `CLAUDE.md` for conventions, component details, and usage
guides.

## Project Structure

```
yellow-plugins/
├── .claude-plugin/
│   └── marketplace.json       # Plugin catalog
├── plugins/
│   ├── gt-workflow/           # Graphite workflow (5 commands, 1 hook)
│   ├── yellow-browser-test/   # Browser testing (3 agents, 4 commands, 2 skills)
│   ├── yellow-chatprd/        # ChatPRD integration (2 agents, 5 commands, 1 skill, 1 MCP)
│   ├── yellow-ci/             # CI toolkit (3 agents, 5 commands, 2 skills, 1 hook)
│   ├── yellow-core/           # Dev toolkit (10 agents, 3 commands, 2 skills, 1 MCP)
│   ├── yellow-debt/           # Debt audit (7 agents, 5 commands, 1 skill)
│   ├── yellow-devin/          # Devin.AI (1 agent, 5 commands, 1 skill, 2 MCP)
│   ├── yellow-linear/         # Linear PM (3 agents, 5 commands, 1 skill, 1 MCP)
│   ├── yellow-review/         # PR review (8 agents, 3 commands, 1 skill)
│   └── yellow-ruvector/       # Vector memory (2 agents, 6 commands, 2 skills, 3 hooks, 1 MCP)
├── packages/                  # Validation tooling (domain, infrastructure, cli)
├── schemas/                   # JSON schemas
└── docs/                      # Validation guides, operational docs, and solutions
```

## License

MIT
