# Plugin Template

**Quick-start template for creating new Claude Code plugins**

---

## Plugin Directory Structure

```
plugins/my-plugin/
├── .claude-plugin/
│   └── plugin.json          ← Manifest (required)
├── commands/                 ← Slash commands (optional)
│   └── my-command.md
├── skills/                   ← AI skills (optional)
│   └── my-skill.md
├── agents/                   ← Custom agents (optional)
│   └── my-agent.md
├── scripts/                  ← Lifecycle hooks (optional)
│   ├── install.sh
│   └── uninstall.sh
├── package.json              ← npm deps (optional)
└── README.md                 ← Documentation (required)
```

**Minimum Requirements**:
- `.claude-plugin/plugin.json` (manifest)
- At least one entrypoint (command/skill/agent/MCP)
- `README.md` (hosted on GitHub or similar)

---

## Step 1: Create Plugin Directory

```bash
# In marketplace root
mkdir -p plugins/my-plugin/.claude-plugin
cd plugins/my-plugin
```

---

## Step 2: Create Minimal Manifest

**File**: `.claude-plugin/plugin.json`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A brief description of what this plugin does (10-280 chars)",
  "author": {
    "name": "Your Name"
  },
  "entrypoints": {
    "commands": ["commands/my-command.md"]
  },
  "compatibility": {
    "claudeCodeMin": "2.0.12"
  },
  "permissions": [],
  "docs": {
    "readme": "https://github.com/username/repo/tree/main/plugins/my-plugin/README.md"
  }
}
```

**Validation**:
```bash
node ../../scripts/validate-plugin.js .
```

---

## Step 3: Create Entrypoint (Command Example)

**File**: `commands/my-command.md`

```markdown
---
name: my-command
description: Brief command description
allowed-tools: [Read, Write, Bash]
---

# My Command

This command does something useful.

## Usage

```bash
/my-command [options]
```

## Examples

```bash
/my-command --help
```

## Implementation

[Command implementation details here]
```

---

## Step 4: Create README

**File**: `README.md`

```markdown
# My Plugin

Brief description of what the plugin does.

## Installation

```bash
/plugin install my-plugin@kingin-yellows
```

## Usage

### Commands

- `/my-command` - Description of command

## Configuration

[Any configuration steps]

## Examples

[Usage examples]

## License

MIT
```

---

## Step 5: Add to Marketplace

**File**: `.claude-plugin/marketplace.json` (at repo root)

```json
{
  "schemaVersion": "1.0.0",
  "marketplace": {
    "name": "Your Marketplace",
    "author": "Your Name",
    "updatedAt": "2026-01-11T10:00:00Z"
  },
  "plugins": [
    {
      "id": "my-plugin",
      "name": "My Plugin",
      "version": "1.0.0",
      "source": "plugins/my-plugin",
      "category": "development",
      "description": "A brief description"
    }
  ]
}
```

---

## Full-Featured Template

**File**: `.claude-plugin/plugin.json`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Comprehensive plugin description explaining its purpose and key features",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://github.com/username"
  },
  "entrypoints": {
    "commands": [
      "commands/my-command.md",
      "commands/my-other-command.md"
    ],
    "skills": [
      "skills/my-skill.md"
    ],
    "agents": [
      "agents/my-agent.md"
    ]
  },
  "compatibility": {
    "claudeCodeMin": "2.0.12",
    "nodeMin": "18",
    "os": ["linux", "macos", "windows"],
    "arch": ["x64", "arm64"]
  },
  "permissions": [
    {
      "scope": "filesystem",
      "reason": "Read configuration files to customize behavior",
      "paths": [".config/my-plugin/"]
    },
    {
      "scope": "network",
      "reason": "Fetch plugin updates from GitHub API",
      "domains": ["api.github.com"]
    },
    {
      "scope": "shell",
      "reason": "Execute git commands for version control integration",
      "commands": ["git"]
    }
  ],
  "docs": {
    "readme": "https://github.com/username/repo/tree/main/plugins/my-plugin/README.md",
    "changelog": "https://github.com/username/repo/blob/main/plugins/my-plugin/CHANGELOG.md",
    "examples": "https://github.com/username/repo/tree/main/plugins/my-plugin/examples"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/username/repo.git"
  },
  "lifecycle": {
    "install": "scripts/install.sh",
    "uninstall": "scripts/uninstall.sh"
  },
  "dependencies": {
    "ajv": "^8.12.0"
  },
  "keywords": [
    "development",
    "productivity",
    "automation"
  ],
  "license": "MIT",
  "homepage": "https://example.com/my-plugin"
}
```

---

## Skill Template

**File**: `skills/my-skill.md`

```markdown
---
name: My Skill
description: AI-invoked skill that does something useful
allowed-tools: [Read, Write, Glob, Grep, Bash]
---

# My Skill

This skill provides [functionality description].

## When to Use

Claude should invoke this skill when:
- [Trigger condition 1]
- [Trigger condition 2]

## How It Works

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Examples

### Example 1
[Description]

```
Input: [example input]
Output: [example output]
```

### Example 2
[Description]

```
Input: [example input]
Output: [example output]
```

## Implementation Notes

[Technical details about implementation]

## Limitations

- [Limitation 1]
- [Limitation 2]
```

---

## Agent Template

**File**: `agents/my-agent.md`

```markdown
---
name: My Agent
description: Specialized AI agent for [domain]
personality: professional, detail-oriented
expertise: [domain1, domain2]
---

# My Agent

You are a specialized agent for [domain]. Your role is to [primary responsibility].

## Expertise

- [Area of expertise 1]
- [Area of expertise 2]
- [Area of expertise 3]

## Behavior Guidelines

1. **[Guideline category 1]**
   - [Specific behavior]
   - [Specific behavior]

2. **[Guideline category 2]**
   - [Specific behavior]
   - [Specific behavior]

## Communication Style

- Use [tone description]
- Focus on [communication priority]
- Avoid [what to avoid]

## Tools and Capabilities

- Can use: [tool list]
- Cannot use: [restricted tool list]
- Requires permission for: [permission list]

## Example Interactions

### Scenario 1
**User**: [user input]
**Agent**: [expected response]

### Scenario 2
**User**: [user input]
**Agent**: [expected response]
```

---

## Lifecycle Script Templates

### Install Script

**File**: `scripts/install.sh`

```bash
#!/bin/bash
set -e

echo "Installing my-plugin..."

# Create config directory
mkdir -p ~/.config/my-plugin

# Copy default config
cp config/default.json ~/.config/my-plugin/config.json

# Set up git hooks (if needed)
if [ -d ".git" ]; then
  cp hooks/pre-commit .git/hooks/
  chmod +x .git/hooks/pre-commit
fi

echo "✅ my-plugin installed successfully"
```

### Uninstall Script

**File**: `scripts/uninstall.sh`

```bash
#!/bin/bash
set -e

echo "Uninstalling my-plugin..."

# Remove config directory
rm -rf ~/.config/my-plugin

# Remove git hooks
if [ -d ".git/hooks" ]; then
  rm -f .git/hooks/pre-commit
fi

echo "✅ my-plugin uninstalled successfully"
```

**Make executable**:
```bash
chmod +x scripts/install.sh scripts/uninstall.sh
```

---

## Package.json Template

**File**: `package.json`

```json
{
  "name": "claude-plugin-my-plugin",
  "version": "1.0.0",
  "description": "A Claude Code plugin for...",
  "engines": {
    "node": ">=18.0.0 <25.0.0"
  },
  "dependencies": {
    "ajv": "^8.12.0"
  },
  "devDependencies": {
    "ajv-formats": "^2.1.1"
  },
  "scripts": {
    "validate": "node ../../scripts/validate-plugin.js ."
  }
}
```

---

## Common Patterns

### Pattern 1: Configuration File Plugin

```json
{
  "permissions": [
    {
      "scope": "filesystem",
      "reason": "Read and write plugin configuration",
      "paths": [".config/my-plugin/", "my-plugin.config.json"]
    }
  ],
  "lifecycle": {
    "install": "scripts/setup-config.sh",
    "uninstall": "scripts/remove-config.sh"
  }
}
```

### Pattern 2: Network-Based Plugin

```json
{
  "permissions": [
    {
      "scope": "network",
      "reason": "Fetch data from external API",
      "domains": ["api.example.com"]
    }
  ],
  "dependencies": {
    "axios": "^1.6.0"
  }
}
```

### Pattern 3: Shell Command Plugin

```json
{
  "permissions": [
    {
      "scope": "shell",
      "reason": "Execute git commands for version control",
      "commands": ["git", "npm"]
    }
  ],
  "compatibility": {
    "os": ["linux", "macos"]  // Windows may not have git/npm
  }
}
```

---

## Publishing Checklist

Before publishing:

- [ ] Validate manifest: `node scripts/validate-plugin.js plugins/my-plugin`
- [ ] Test installation locally
- [ ] Create README.md with usage examples
- [ ] Add CHANGELOG.md for version history
- [ ] Ensure lifecycle scripts are executable
- [ ] Test permissions work as expected
- [ ] Update marketplace.json with plugin entry
- [ ] Create git tag: `git tag my-plugin-v1.0.0`
- [ ] Push to GitHub: `git push && git push --tags`

---

## Testing Locally

```bash
# 1. Validate manifest
node scripts/validate-plugin.js plugins/my-plugin

# 2. Test lifecycle scripts
cd plugins/my-plugin
./scripts/install.sh
./scripts/uninstall.sh

# 3. Test commands (if applicable)
# Copy plugin to Claude Code plugins directory
cp -r plugins/my-plugin ~/.claude/plugins/

# 4. Verify in Claude Code
# /plugin list
# /my-command
```

---

## Next Steps

1. **Customize manifest** with your plugin details
2. **Create entrypoints** (commands, skills, agents)
3. **Add permissions** if needed
4. **Write documentation** (README, examples)
5. **Validate** with `validate-plugin.js`
6. **Test locally** before publishing
7. **Add to marketplace** and commit

**Resources**:
- Plugin Schema: `/schemas/plugin.schema.json`
- Validation Script: `/scripts/validate-plugin.js`
- Example Plugin: `/examples/plugin.example.json`
- Design Docs: `/docs/plugin-schema-design.md`
