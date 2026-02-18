# Research Summary for Schema Designers

**Source**: Claude Code Plugin Research (D05)
**For**: Coder agents creating plugin.json and marketplace.json schemas
**Phase**: Specification → Schema Design

---

## Quick Reference: What You Need to Know

### plugin.json Location & Required Fields

**Location**: `.claude-plugin/plugin.json` (95% confidence)

**Required Fields**:
```json
{
  "name": "plugin-name",           // lowercase alphanumeric + hyphens, max 64 chars
  "description": "Description",    // max 1024 chars, no XML tags
  "version": "1.0.0"              // semantic versioning
}
```

**Recommended Fields**:
```json
{
  "author": {
    "name": "Developer Name",
    "email": "dev@example.com"
  },
  "homepage": "https://github.com/user/plugin",
  "category": "development"        // one of 9 official categories
}
```

### marketplace.json Location & Required Fields

**Location**: `.claude-plugin/marketplace.json` (95% confidence)

**Required Fields**:
```json
{
  "name": "marketplace-name",
  "description": "Marketplace description",
  "owner": {
    "name": "Organization Name",
    "email": "org@example.com"
  },
  "plugins": [
    {
      "name": "plugin-name",
      "description": "Plugin description",
      "source": "./plugins/plugin-name",  // or {"source": "url", "url": "git-url"}
      "category": "development",
      "author": {
        "name": "Developer",
        "email": "dev@example.com"
      }
    }
  ]
}
```

### Official Categories (9 Total)

Must use one of these enum values:
1. `development` - Language servers, code tools
2. `productivity` - Workflow & project management
3. `security` - Security scanning & compliance
4. `learning` - Educational tools
5. `testing` - Testing & QA tools
6. `design` - Design integration
7. `database` - Database management
8. `deployment` - Hosting & deployment
9. `monitoring` - Error tracking & monitoring

### Validation Rules to Enforce

1. **Name validation**: `^[a-z0-9-]+$` (lowercase alphanumeric + hyphens only)
2. **Name max length**: 64 characters
3. **Description max length**: 1024 characters
4. **Description validation**: No XML tags allowed
5. **Version format**: Semantic versioning (`\d+.\d+.\d+(-[a-zA-Z0-9.]+)?`)
6. **Email format**: Valid email address
7. **URL format**: Well-formed URI
8. **Category**: Must be one of 9 official values (enum)

### Extension Points (What Plugins Can Contain)

Plugins can have any combination of:
- **Commands** (`/commands/*.md`) - User-invoked slash commands
- **Skills** (`/skills/*/SKILL.md`) - AI-invoked capabilities
- **Agents** (`/agents/*.md`) - Custom AI personas
- **MCP Servers** (`.mcp.json`) - External tool integration
- **Hooks** (`/hooks/*.js`) - Event handlers (advanced)

**Minimum requirement**: At least ONE extension point.

### npm Dependencies Support

**Confirmed**: ✅ Fully supported

- Plugins can have `package.json`
- Installation runs `npm install` automatically
- Node.js requirements: 18-24 (NOT 25+)
- Use `engines` field to specify Node.js version

Example package.json:
```json
{
  "engines": {
    "node": ">=18.0.0 <25.0.0"
  },
  "dependencies": {
    "axios": "^1.6.0"
  }
}
```

### Permission Model (For Documentation)

**Permission Modes**: default, plan, acceptEdits, bypassPermissions

**Rule Types**: allow, ask, deny (evaluated in that order)

**Plugin Declaration**: Use `allowed-tools` in skill/command frontmatter
```yaml
allowed-tools: [Read, Glob, Grep, Bash]
```

**Important**: Plugins CANNOT bypass user permission settings. Declarations are advisory only.

### Installation Process (For Reference)

1. **Copy**: Plugin directory copied from marketplace
2. **npm install**: If package.json exists
3. **Custom scripts**: If defined in package.json
4. **Validation**: Manifest checked via `claude plugin validate`

---

## Schema Design Priorities

### High Priority (Must Have)

1. **Define comprehensive plugin.json schema**
   - Include all discovered fields (required + optional)
   - Add future-proofing fields (minClaudeCodeVersion, etc.)
   - Strong validation rules (name pattern, length limits)

2. **Define comprehensive marketplace.json schema**
   - Support both local and URL-based plugin sources
   - Enforce author and category requirements
   - Validate plugin entry structure

3. **Validation rules**
   - Name: `^[a-z0-9-]+$` max 64 chars
   - Description: max 1024 chars, no XML
   - Version: semantic versioning
   - Category: enum of 9 official values
   - Email: valid format
   - URLs: well-formed

### Medium Priority (Should Have)

4. **Add compatibility fields**
   - `minClaudeCodeVersion` (even though not enforced yet)
   - `maxClaudeCodeVersion` (for breaking changes)
   - `nodeVersion` (Node.js requirement)

5. **Add security/trust metadata**
   - `verified` (boolean for marketplace-verified plugins)
   - `permissions` (array of required permissions)
   - `securityAudit` (date of last security review)

6. **Add discovery metadata**
   - `keywords` (array for search)
   - `screenshots` (array of image URLs)
   - `changelog` (URL to changelog)

### Low Priority (Nice to Have)

7. **Analytics metadata**
   - `downloads` (install count)
   - `rating` (user rating)
   - `updatedAt` (last update timestamp)

8. **Advanced features**
   - `dependencies` (plugin dependencies)
   - `conflicts` (incompatible plugins)
   - `alternatives` (similar plugins)

---

## Critical Constraints from Research

### MUST Constraints (Hard Requirements)

**Plugin Manifest**:
1. Location: `.claude-plugin/plugin.json`
2. Required fields: name, description, version
3. Name: lowercase alphanumeric + hyphens, max 64 chars
4. Description: max 1024 chars, no XML tags
5. Category: one of 9 official values

**Marketplace Manifest**:
6. Location: `.claude-plugin/marketplace.json` at repo root
7. Required fields: name, description, owner, plugins
8. Plugin entry: name, description, source, category, author
9. Owner: name and email required
10. Author: name and email required

**Compatibility**:
11. Minimum Claude Code: 2.0.12+
12. Node.js versions: 18-24 (NOT 25+)
13. Validation: Must pass `claude plugin validate`

**Extension Points**:
14. At least one: commands, skills, agents, MCP, hooks
15. Skills: require name and description in frontmatter
16. Commands: Markdown + YAML frontmatter

### SHOULD Constraints (Recommended)

1. Use semantic versioning
2. Include author with contact info
3. Provide homepage/repository URL
4. Minimize npm dependencies
5. Declare Node.js version in engines
6. Document all required permissions
7. Provide README.md
8. Include changelog

### MAY Constraints (Optional)

1. Custom install/uninstall scripts
2. Package lockfile (package-lock.json)
3. TypeScript types
4. CI/CD for testing
5. Dependency scanning

---

## Unknown/Unverified (Document as Assumptions)

1. **Install script timeout**: Not documented (assume 60s)
2. **Plugin size limits**: Not documented (recommend <10MB)
3. **Concurrent plugin limits**: Not documented (assume unlimited)
4. **Hooks execution order**: Not documented (undefined order)
5. **Dependency conflict resolution**: npm's default (potential conflicts)

---

## Example Schemas (Starter Templates)

### plugin.json Schema (JSON Schema Draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://kinginyellow.dev/schemas/claude-plugin.json",
  "title": "Claude Code Plugin Manifest",
  "description": "Manifest for Claude Code plugins",
  "type": "object",
  "required": ["name", "description", "version"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$",
      "maxLength": 64,
      "description": "Plugin identifier (lowercase alphanumeric + hyphens)"
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1024,
      "description": "Human-readable description (no XML tags)"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$",
      "description": "Semantic version (e.g., 1.0.0)"
    },
    "author": {
      "type": "object",
      "required": ["name", "email"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "email": { "type": "string", "format": "email" }
      }
    },
    "homepage": {
      "type": "string",
      "format": "uri",
      "description": "Documentation or repository URL"
    },
    "category": {
      "type": "string",
      "enum": [
        "development", "productivity", "security", "learning",
        "testing", "design", "database", "deployment", "monitoring"
      ],
      "description": "Plugin category"
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Keywords for search and discovery"
    },
    "minClaudeCodeVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Minimum required Claude Code version (e.g., 2.0.12)"
    }
  },
  "additionalProperties": true
}
```

### marketplace.json Schema (JSON Schema Draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://kinginyellow.dev/schemas/claude-marketplace.json",
  "title": "Claude Code Marketplace Manifest",
  "description": "Manifest for Claude Code plugin marketplaces",
  "type": "object",
  "required": ["name", "description", "owner", "plugins"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$",
      "description": "Marketplace identifier"
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1024,
      "description": "Marketplace description"
    },
    "owner": {
      "type": "object",
      "required": ["name", "email"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "email": { "type": "string", "format": "email" }
      }
    },
    "plugins": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["name", "description", "source", "category", "author"],
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^[a-z0-9-]+$",
            "maxLength": 64
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          },
          "source": {
            "oneOf": [
              {
                "type": "string",
                "pattern": "^\\./",
                "description": "Local path (e.g., ./plugins/name)"
              },
              {
                "type": "object",
                "required": ["source", "url"],
                "properties": {
                  "source": { "const": "url" },
                  "url": { "type": "string", "format": "uri" }
                }
              }
            ]
          },
          "category": {
            "type": "string",
            "enum": [
              "development", "productivity", "security", "learning",
              "testing", "design", "database", "deployment", "monitoring"
            ]
          },
          "author": {
            "type": "object",
            "required": ["name", "email"],
            "properties": {
              "name": { "type": "string", "minLength": 1 },
              "email": { "type": "string", "format": "email" }
            }
          },
          "version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$"
          },
          "homepage": {
            "type": "string",
            "format": "uri"
          },
          "tags": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    }
  }
}
```

---

## Next Steps for Schema Design

1. **Enhance schemas** with additional fields from research
2. **Add examples** for each schema
3. **Create validation tools** that go beyond `claude plugin validate`
4. **Write tests** for schema validation edge cases
5. **Document** all fields with descriptions and examples

---

## Questions to Resolve During Schema Design

1. Should we add `verified` field for marketplace-approved plugins?
2. Should we track `dependencies` between plugins?
3. Should we add `screenshots` for visual discovery?
4. Should we enforce `homepage` as required (currently optional)?
5. Should we add `license` field for open-source compliance?
6. Should we support `keywords` separate from `tags`?
7. Should we add `maintainers` array for multi-author plugins?
8. Should we track `deprecated` status for outdated plugins?

Refer to full research document at `/home/kinginyellow/projects/yellow-plugins/docs/claude-code-plugin-research.md` for complete details.
