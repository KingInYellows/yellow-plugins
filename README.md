# yellow-plugins

Personal Claude Code plugin marketplace.

## Install the Marketplace

```
/plugin marketplace add kinginyellow/yellow-plugins
```

## Install a Plugin

After adding the marketplace, install plugins from it:

```
/plugin install gt-workflow
/plugin install yellow-core
```

## Available Plugins

| Plugin | Description | Components |
|--------|-------------|------------|
| `gt-workflow` | Graphite-native workflow commands for stacked PRs, smart commits, sync, and stack navigation | 4 commands |
| `yellow-core` | Dev toolkit with review agents, research agents, and workflow commands for TS/Py/Rust/Go | 10 agents, 3 commands, 2 skills, 1 MCP server |

### gt-workflow

Graphite (`gt`) integration for stacked PR workflows:

- `/smart-submit` — Audit + commit + submit in one flow
- `/gt-stack-plan` — Plan stacked PRs for a feature
- `/gt-sync` — Sync repo, restack, clean up
- `/gt-nav` — Visualize and navigate the stack

### yellow-core

Comprehensive dev toolkit:

**Review Agents** (run in parallel via `/workflows:review`):
- `code-simplicity-reviewer` — YAGNI enforcement, simplification
- `security-sentinel` — Security audit, OWASP, secrets scanning
- `performance-oracle` — Bottlenecks, algorithmic complexity
- `architecture-strategist` — Architectural compliance, design patterns
- `polyglot-reviewer` — Language-idiomatic review for TS/Py/Rust/Go
- `test-coverage-analyst` — Test quality, coverage gaps

**Research Agents**:
- `repo-research-analyst` — Repository structure, conventions
- `best-practices-researcher` — External docs, community standards
- `git-history-analyzer` — Git archaeology, change history

**Workflow Agent**:
- `spec-flow-analyzer` — User flow analysis, gap identification

**Workflow Commands**:
- `/workflows:plan` — Transform feature descriptions into structured plans
- `/workflows:work` — Execute work plans systematically
- `/workflows:review` — Multi-agent comprehensive code review

**Skills**:
- `create-agent-skills` — Guidance for creating skills and agents
- `git-worktree` — Git worktree management for parallel development

**MCP Servers**:
- `context7` — Up-to-date library documentation

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
  "author": { "name": "Your Name" }
}
```

3. Add an entry to the `plugins` array in `.claude-plugin/marketplace.json`:

```json
{
  "name": "my-plugin",
  "description": "What the plugin does",
  "version": "1.0.0",
  "author": { "name": "Your Name" },
  "source": "./plugins/my-plugin",
  "category": "development"
}
```

## Project Structure

```
yellow-plugins/
├── .claude-plugin/
│   └── marketplace.json       # The catalog Claude Code reads
├── plugins/
│   ├── gt-workflow/           # Graphite workflow commands
│   │   ├── .claude-plugin/plugin.json
│   │   ├── CLAUDE.md
│   │   └── commands/          # 4 commands
│   └── yellow-core/           # Dev toolkit
│       ├── .claude-plugin/plugin.json
│       ├── CLAUDE.md
│       ├── agents/            # 10 agents (review/, research/, workflow/)
│       ├── commands/          # 3 workflow commands
│       └── skills/            # 2 skills
├── schemas/                   # Schema references
└── examples/                  # Example JSON files
```

## Official Format Reference

The marketplace follows the official Claude Code format used by:
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- [EveryInc/every-marketplace](https://github.com/EveryInc/every-marketplace)
- [obra/superpowers-marketplace](https://github.com/obra/superpowers-marketplace)

## License

MIT
