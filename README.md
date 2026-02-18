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
