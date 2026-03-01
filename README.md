# yellow-plugins

Personal Claude Code plugin marketplace — 11 plugins for Git workflows, code
review, CI, research, testing, and more.

## Install

Add the marketplace, then install individual plugins:

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install gt-workflow@yellow-plugins
```

## Plugins

| Plugin                | Description                                                                                                 | Components                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `gt-workflow`         | Graphite-native workflow commands for stacked PRs, smart commits, sync, and stack navigation                | 5 commands, 2 hooks                                 |
| `yellow-browser-test` | Autonomous web app testing with agent-browser — auto-discovery, structured flows, and bug reporting         | 3 agents, 4 commands, 2 skills                      |
| `yellow-chatprd`      | ChatPRD MCP integration with document management and Linear bridging                                        | 2 agents, 6 commands, 1 skill, 1 MCP                |
| `yellow-ci`           | CI failure diagnosis, workflow linting, and runner health management for self-hosted GitHub Actions runners | 4 agents, 7 commands, 2 skills, 1 hook              |
| `yellow-core`         | Dev toolkit with review agents, research agents, and workflow commands for TS/Py/Rust/Go                    | 13 agents, 5 commands, 3 skills, 1 MCP              |
| `yellow-debt`         | Technical debt audit and remediation with parallel scanner agents for AI-generated code patterns            | 7 agents, 5 commands, 1 skill, 1 hook               |
| `yellow-devin`        | Devin.AI V3 API integration — delegate tasks, manage sessions, research codebases via DeepWiki              | 1 agent, 7 commands, 1 skill, 2 MCPs                |
| `yellow-linear`       | Linear MCP integration with PM workflows for issues, projects, initiatives, cycles, and documents           | 3 agents, 7 commands, 1 skill, 1 MCP                |
| `yellow-research`     | Deep research with Perplexity, Tavily, EXA, and Parallel Task MCPs — inline code research and saved reports | 2 agents, 2 commands, 1 skill, 4 MCPs               |
| `yellow-review`       | Multi-agent PR review with adaptive agent selection, parallel comment resolution, and stack review          | 7 agents, 3 commands, 1 skill                       |
| `yellow-ruvector`     | Persistent vector memory and semantic code search for Claude Code agents via ruvector                       | 2 agents, 6 commands, 3 skills, 4 hooks, 1 MCP      |

## MCP Servers & Authentication

Eight plugins connect to external MCP servers. Authentication requirements vary
by server.

| Plugin            | MCP Server  | Auth                                                           |
| ----------------- | ----------- | -------------------------------------------------------------- |
| `yellow-core`     | Context7    | Free (no key); optional API key for higher rate limits         |
| `yellow-chatprd`  | ChatPRD     | OAuth (browser popup on first use)                             |
| `yellow-devin`    | DeepWiki    | Free for public repos; `DEVIN_SERVICE_USER_TOKEN` for private repos     |
| `yellow-devin`    | Devin       | `DEVIN_SERVICE_USER_TOKEN` & `DEVIN_ORG_ID` required                    |
| `yellow-linear`   | Linear      | OAuth (browser popup on first use)                             |
| `yellow-research` | Perplexity  | `PERPLEXITY_API_KEY` required                                  |
| `yellow-research` | Tavily      | `TAVILY_API_KEY` required                                      |
| `yellow-research` | EXA         | `EXA_API_KEY` required                                         |
| `yellow-research` | Parallel    | OAuth (auto-managed by Claude Code)                            |
| `yellow-ruvector` | ruvector    | Local stdio — no auth required                                 |

### Context7 (yellow-core)

Provides up-to-date library documentation for LLMs. Works without an API key
but with lower rate limits.

**Free (no key):** Works out of the box. The plugin connects to
`https://mcp.context7.com/mcp` with no configuration needed.

**Free API key (higher rate limits):** Create an account at
[context7.com/dashboard](https://context7.com/dashboard) and generate an API
key (format: `ctx7sk_...`). Then configure it in your Claude Code settings:

```bash
# In Claude Code, run /mcp → select context7 → edit config → add header:
# "headers": { "CONTEXT7_API_KEY": "ctx7sk_your_key_here" }
```

### DeepWiki & Devin (yellow-devin)

**DeepWiki (public repos):** Works out of the box at `https://mcp.deepwiki.com/mcp`.
No authentication needed for public repositories.

**DeepWiki (private repos) + Devin sessions:** Both require a `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID`.

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

### yellow-research (API keys)

Bundles four MCP servers for multi-source deep research. Each search provider
requires its own API key. The Parallel Task MCP uses OAuth and requires no key.

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export PERPLEXITY_API_KEY="pplx-..."
export TAVILY_API_KEY="tvly-..."
export EXA_API_KEY="..."
```

Source or restart your shell, then restart Claude Code — MCP servers read
environment variables at startup.

- **Perplexity:** [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api)
- **Tavily:** [app.tavily.com](https://app.tavily.com)
- **EXA:** [dashboard.exa.ai](https://dashboard.exa.ai)
- **Parallel Task MCP:** OAuth only — Claude Code handles it automatically

Plugins degrade gracefully: if a key is missing, that provider is skipped and
research continues with the remaining sources.

### ruvector (yellow-ruvector)

Runs locally as a stdio MCP server via `npx`. No external services or API keys
required. Run `/ruvector:setup` on first use to install.

## Usage

After installing, use `/plugin install <name>@yellow-plugins` to activate
individual plugins. Each plugin's commands are namespaced (e.g., `/ci:diagnose`,
`/linear:create`, `/devin:delegate`, `/research:deep`).

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
│   ├── gt-workflow/           # Graphite workflow (5 commands, 2 hooks)
│   ├── yellow-browser-test/   # Browser testing (3 agents, 4 commands, 2 skills)
│   ├── yellow-chatprd/        # ChatPRD integration (2 agents, 6 commands, 1 skill, 1 MCP)
│   ├── yellow-ci/             # CI toolkit (4 agents, 7 commands, 2 skills, 1 hook)
│   ├── yellow-core/           # Dev toolkit (13 agents, 5 commands, 3 skills, 1 MCP)
│   ├── yellow-debt/           # Debt audit (7 agents, 5 commands, 1 skill, 1 hook)
│   ├── yellow-devin/          # Devin.AI (1 agent, 7 commands, 1 skill, 2 MCPs)
│   ├── yellow-linear/         # Linear PM (3 agents, 7 commands, 1 skill, 1 MCP)
│   ├── yellow-research/       # Deep research (2 agents, 2 commands, 1 skill, 4 MCPs)
│   ├── yellow-review/         # PR review (7 agents, 3 commands, 1 skill)
│   └── yellow-ruvector/       # Vector memory (2 agents, 6 commands, 3 skills, 4 hooks, 1 MCP)
├── packages/                  # Validation tooling (domain, infrastructure, cli)
├── schemas/                   # JSON schemas
└── docs/                      # Validation guides, operational docs, and solutions
```

## License

MIT
