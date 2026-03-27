# Marketplace Quickstart Guide

**For**: Solo developers creating personal plugin marketplaces **Time**: 10
minutes to first working marketplace **Version**: 1.0.0

## What You'll Build

A personal Claude Code plugin marketplace that lets you:

- Install plugins with one command: `/plugin install my-plugin@kingin-yellows`
- Update plugins safely with version pinning
- Browse available plugins with descriptions and categories

## Prerequisites

- Node.js 22.22.0 or later installed
- pnpm 8+ installed
- Git repository for your plugins
- Basic familiarity with JSON

## Step 1: Create Marketplace Structure (2 minutes)

```bash
# Navigate to your plugin repository root
cd /path/to/your/repo

# Create required directories
mkdir -p .claude-plugin
mkdir -p plugins
mkdir -p schemas
mkdir -p scripts

# Copy the official marketplace schema used by this repository
curl -o schemas/official-marketplace.schema.json \
  https://raw.githubusercontent.com/KingInYellows/yellow-plugins/main/schemas/official-marketplace.schema.json

# Copy validation script
curl -o scripts/validate-marketplace.js \
  https://raw.githubusercontent.com/KingInYellows/yellow-plugins/main/scripts/validate-marketplace.js
chmod +x scripts/validate-marketplace.js
```

## Step 2: Create Your First Plugin (3 minutes)

```bash
# Create plugin directory
mkdir -p plugins/hello-world

# Create minimal plugin manifest
mkdir -p plugins/hello-world/.claude-plugin
cat > plugins/hello-world/.claude-plugin/plugin.json << 'EOF'
{
  "name": "hello-world",
  "version": "1.0.0",
  "description": "My first Claude Code plugin",
  "author": {
    "name": "your-name"
  }
}
EOF

# Create plugin README
cat > plugins/hello-world/README.md << 'EOF'
# Hello World Plugin

A simple example plugin to test the marketplace system.

## Usage

This is a placeholder plugin for testing.
EOF
```

## Step 3: Create Marketplace Index (3 minutes)

```bash
# Create marketplace.json
cat > .claude-plugin/marketplace.json << EOF
{
  "name": "my-marketplace",
  "description": "Personal collection of Claude Code plugins",
  "owner": {
    "name": "your-github-username",
    "url": "https://github.com/your-username"
  },
  "plugins": [
    {
      "name": "hello-world",
      "version": "1.0.0",
      "author": {
        "name": "your-name"
      },
      "description": "My first Claude Code plugin for testing marketplace",
      "source": "./plugins/hello-world",
      "category": "development"
    }
  ]
}
EOF
```

## Step 4: Validate Your Marketplace (1 minute)

```bash
# Run validation
node scripts/validate-marketplace.js

# Expected output:
# ✓ PASS: Marketplace file loaded: .claude-plugin/marketplace.json
# ✓ PASS: Marketplace name: my-marketplace
# ✓ PASS: All plugins have required fields (name, source)
# ✓ All validation checks passed!
```

## Step 5: Commit and Publish (1 minute)

```bash
# Add files
git add .claude-plugin/marketplace.json
git add plugins/hello-world/
git add schemas/official-marketplace.schema.json
git add scripts/validate-marketplace.js

# Commit
git commit -m "Initialize personal plugin marketplace"

# Push via Graphite
gt submit --no-interactive
```

## Next Steps

### Add More Plugins

```bash
# Copy your existing plugin to marketplace structure
cp -r /path/to/existing-plugin plugins/my-plugin

# Ensure it has a plugin manifest
mkdir -p plugins/my-plugin/.claude-plugin
cat > plugins/my-plugin/.claude-plugin/plugin.json << 'EOF'
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Does something useful",
  "author": {
    "name": "your-name"
  }
}
EOF

# Add to marketplace.json (edit .claude-plugin/marketplace.json)
```

### Set Up CI Validation

Create `.github/workflows/validate-marketplace.yml`:

```yaml
name: Validate Marketplace

on:
  push:
    paths:
      - '.claude-plugin/marketplace.json'
      - 'plugins/**/.claude-plugin/plugin.json'
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.22.0'
      - name: Validate marketplace
        run: node scripts/validate-marketplace.js
```

### Add Pre-commit Hook

```bash
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
echo "Validating marketplace..."
if ! node scripts/validate-marketplace.js; then
  echo "Fix validation errors before committing"
  exit 1
fi
EOF

chmod +x .git/hooks/pre-commit
```

## Common Tasks

### Adding a New Plugin

1. Create plugin directory: `mkdir -p plugins/new-plugin`
2. Add `.claude-plugin/plugin.json` manifest
3. Edit `.claude-plugin/marketplace.json` to add plugin entry
4. Validate: `node scripts/validate-marketplace.js`
5. Commit and push

### Updating a Plugin Version

1. Update version in `plugins/my-plugin/.claude-plugin/plugin.json`
2. Update version in `.claude-plugin/marketplace.json`
3. Validate: `node scripts/validate-marketplace.js`
4. Commit and push

### Removing a Plugin

1. Remove plugin directory: `rm -rf plugins/old-plugin`
2. Remove entry from `.claude-plugin/marketplace.json`
3. Validate: `node scripts/validate-marketplace.js`
4. Commit and push

## Troubleshooting

### Validation Fails: "Source directory not found"

**Problem**: Plugin directory doesn't exist at specified path.

**Fix**: Check that path in marketplace.json matches actual directory:

```bash
ls -la plugins/my-plugin  # Should exist
```

### Validation Fails: "Version mismatch"

**Problem**: Version in marketplace.json doesn't match plugin.json.

**Fix**: Synchronize versions:

```bash
# Check plugin.json version
cat plugins/my-plugin/.claude-plugin/plugin.json | grep version

# Update marketplace.json to match
```

## Best Practices

1. **Always validate before committing**: Use pre-commit hook
2. **Keep versions synchronized**: Marketplace and plugin.json must match
3. **Use semantic versioning**: MAJOR.MINOR.PATCH (e.g., 1.2.3)
4. **Write clear descriptions**: Help future you remember what plugin does
5. **Keep optional categories consistent**: They are schema-supported but not
   validator-enforced

## File Structure Reference

```text
your-repo/
├── .claude-plugin/
│   └── marketplace.json          # Main marketplace index
├── plugins/
│   ├── hello-world/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json       # Plugin manifest
│   │   ├── README.md             # Plugin docs
│   │   └── ... plugin files ...
│   └── another-plugin/
│       └── ... same structure ...
├── schemas/
│   └── official-marketplace.schema.json
└── scripts/
    └── validate-marketplace.js   # Validation tool
```

## Success Metrics

According to PRD-KIY-MKT-001, success means:

- **Time-to-install**: ≤ 2 minutes on fresh machine
- **Update confidence**: Can rollback if needed
- **Maintenance overhead**: ≤ 10 minutes to publish new version

You'll achieve these by following this structure and validation workflow.

## What's Next?

1. Review complete schema documentation: `/docs/marketplace-schema-design.md`
2. Set up plugin.json schema (coming soon)
3. Create install/update CLI commands (future phase)
4. Add GitHub Actions automation (future phase)

## Support

- Schema definition: `/schemas/official-marketplace.schema.json`
- Validation guide: `/docs/validation-guide.md`
- Example marketplace: `/examples/marketplace.example.json`

## Quick Reference

### Minimal marketplace.json Template

```json
{
  "name": "your-marketplace",
  "owner": {
    "name": "your-username"
  },
  "plugins": [{"name": "example", "source": "./plugins/example"}]
}
```

### Minimal plugin.json Template

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": {
    "name": "your-name"
  }
}
```

### Validation Command

```bash
node scripts/validate-marketplace.js
```

### Categories (Choose One)

- development
- productivity
- security
- learning
- testing
- design
- database
- deployment
- monitoring

---

**Congratulations!** You now have a working personal plugin marketplace. Start
adding your plugins and enjoy easy cross-machine installation.
