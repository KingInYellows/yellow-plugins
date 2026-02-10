# yellow-plugins

Personal Claude Code plugin marketplace.

## Install the Marketplace

```
/plugin marketplace add kinginyellow/yellow-plugins
```

## Install a Plugin

After adding the marketplace, install plugins from it:

```
/plugin install yellow-starter
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| `yellow-starter` | Starter plugin with a `/yellow-hello` test command |

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

3. Register it in `.claude-plugin/marketplace.json`:

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

4. Validate:

```bash
pnpm validate:schemas
```

## Project Structure

```
yellow-plugins/
├── .claude-plugin/
│   └── marketplace.json       # The catalog Claude Code reads
├── plugins/
│   └── yellow-starter/        # Starter plugin
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── commands/
│       │   └── yellow-hello.md
│       └── CLAUDE.md
├── schemas/
│   ├── official-marketplace.schema.json   # Official format reference
│   ├── marketplace.schema.json            # Extended validation schema
│   └── plugin.schema.json                 # Extended plugin schema
├── scripts/
│   ├── validate-marketplace.js            # Validates marketplace.json
│   └── validate-plugin.js                 # Validates plugin manifests
├── examples/
│   ├── marketplace.example.json
│   ├── plugin.example.json
│   └── plugin-minimal.example.json
├── packages/                              # TypeScript validation toolkit
│   ├── domain/                            # Validation types & error catalog
│   ├── infrastructure/                    # AJV schema validators
│   └── cli/                               # Validation CLI wrapper
└── docs/                                  # Specifications & design docs
```

## Validation

```bash
# Install dependencies
pnpm install

# Validate marketplace.json and all plugin manifests
pnpm validate:schemas

# Validate only the marketplace catalog
pnpm validate:marketplace

# Validate only plugin manifests
pnpm validate:plugins
```

## Official Format Reference

The marketplace follows the official Claude Code format used by:
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- [EveryInc/every-marketplace](https://github.com/EveryInc/every-marketplace)
- [obra/superpowers-marketplace](https://github.com/obra/superpowers-marketplace)

Key fields in `.claude-plugin/marketplace.json`:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Marketplace identifier |
| `plugins` | Yes | Array of plugin entries |
| `owner` | No | Owner name and URL |
| `description` | No | Marketplace description |
| `metadata.version` | No | Marketplace version (semver) |

Key fields in each plugin entry:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Plugin name (used as ID) |
| `source` | Yes | Path to plugin dir (e.g., `./plugins/my-plugin`) |
| `description` | No | Short description |
| `version` | No | Semver version |
| `author` | No | Author object with `name` |
| `category` | No | Category string |

## License

MIT
