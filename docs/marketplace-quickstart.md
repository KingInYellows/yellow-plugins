# Marketplace Quickstart Guide

**For**: Solo developers creating personal plugin marketplaces
**Time**: 10 minutes to first working marketplace
**Version**: 1.0.0

## What You'll Build

A personal Claude Code plugin marketplace that lets you:
- Install plugins with one command: `/plugin install my-plugin@kingin-yellows`
- Update plugins safely with version pinning
- Browse available plugins with descriptions and categories

## Prerequisites

- Node.js 18+ installed
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

# Copy marketplace schema
curl -o schemas/marketplace.schema.json \
  https://raw.githubusercontent.com/kinginyellow/yellow-plugins/main/schemas/marketplace.schema.json

# Copy validation script
curl -o scripts/validate-marketplace.js \
  https://raw.githubusercontent.com/kinginyellow/yellow-plugins/main/scripts/validate-marketplace.js
chmod +x scripts/validate-marketplace.js
```

## Step 2: Create Your First Plugin (3 minutes)

```bash
# Create plugin directory
mkdir -p plugins/hello-world

# Create minimal plugin.json manifest
cat > plugins/hello-world/plugin.json << 'EOF'
{
  "version": "1.0.0",
  "name": "Hello World Plugin",
  "description": "My first Claude Code plugin",
  "author": "your-name",
  "entrypoints": []
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
# Get current timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Create marketplace.json
cat > .claude-plugin/marketplace.json << EOF
{
  "schemaVersion": "1.0.0",
  "marketplace": {
    "name": "My Personal Plugin Marketplace",
    "author": "your-github-username",
    "description": "Personal collection of Claude Code plugins",
    "url": "https://github.com/your-username/your-repo",
    "updatedAt": "$TIMESTAMP"
  },
  "plugins": [
    {
      "id": "hello-world",
      "name": "Hello World Plugin",
      "version": "1.0.0",
      "author": "your-name",
      "description": "My first Claude Code plugin for testing marketplace",
      "source": "plugins/hello-world",
      "category": "development",
      "tags": ["example", "test"],
      "featured": true,
      "verified": true,
      "updatedAt": "$TIMESTAMP"
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
# ✓ PASS: Marketplace file loaded
# ✓ PASS: Schema version: 1.0.0
# ✓ PASS: All plugin IDs are unique
# ✓ PASS: All validation checks passed!
# NFR-REL-004: ✓ 100% validation coverage achieved
```

## Step 5: Commit and Publish (1 minute)

```bash
# Add files
git add .claude-plugin/marketplace.json
git add plugins/hello-world/
git add schemas/marketplace.schema.json
git add scripts/validate-marketplace.js

# Commit
git commit -m "Initialize personal plugin marketplace"

# Push
git push origin main
```

## Next Steps

### Add More Plugins

```bash
# Copy your existing plugin to marketplace structure
cp -r /path/to/existing-plugin plugins/my-plugin

# Ensure it has a plugin.json manifest
cat > plugins/my-plugin/plugin.json << 'EOF'
{
  "version": "1.0.0",
  "name": "My Plugin",
  "description": "Does something useful"
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
      - 'plugins/**/plugin.json'
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
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
2. Add `plugin.json` manifest
3. Edit `.claude-plugin/marketplace.json` to add plugin entry
4. Validate: `node scripts/validate-marketplace.js`
5. Commit and push

### Updating a Plugin Version

1. Update version in `plugins/my-plugin/plugin.json`
2. Update version in `.claude-plugin/marketplace.json`
3. Update `updatedAt` timestamp
4. Validate: `node scripts/validate-marketplace.js`
5. Commit and push

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
cat plugins/my-plugin/plugin.json | grep version

# Update marketplace.json to match
```

### Validation Fails: "Invalid category"

**Problem**: Category isn't one of 9 official categories.

**Fix**: Use valid category from this list:
- development, productivity, security, learning, testing
- design, database, deployment, monitoring

## Best Practices

1. **Always validate before committing**: Use pre-commit hook
2. **Keep versions synchronized**: Marketplace and plugin.json must match
3. **Use semantic versioning**: MAJOR.MINOR.PATCH (e.g., 1.2.3)
4. **Write clear descriptions**: Help future you remember what plugin does
5. **Use tags generously**: Makes plugins easier to find
6. **Update timestamps**: Set `updatedAt` when making changes

## File Structure Reference

```
your-repo/
├── .claude-plugin/
│   └── marketplace.json          # Main marketplace index
├── plugins/
│   ├── hello-world/
│   │   ├── plugin.json           # Plugin manifest
│   │   ├── README.md             # Plugin docs
│   │   └── ... plugin files ...
│   └── another-plugin/
│       └── ... same structure ...
├── schemas/
│   └── marketplace.schema.json   # Schema definition
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

- Schema definition: `/schemas/marketplace.schema.json`
- Validation guide: `/docs/validation-guide.md`
- Example marketplace: `/examples/marketplace.example.json`
- PRD reference: `PRD.md`

## Quick Reference

### Minimal marketplace.json Template

```json
{
  "schemaVersion": "1.0.0",
  "marketplace": {
    "name": "Your Marketplace Name",
    "author": "your-username",
    "updatedAt": "2026-01-11T10:00:00Z"
  },
  "plugins": []
}
```

### Minimal plugin.json Template

```json
{
  "version": "1.0.0",
  "name": "Plugin Name",
  "description": "What it does"
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

**Congratulations!** You now have a working personal plugin marketplace. Start adding your plugins and enjoy easy cross-machine installation.
