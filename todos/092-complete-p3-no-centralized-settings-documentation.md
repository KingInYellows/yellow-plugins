---
status: complete
priority: p3
issue_id: "092"
tags: [code-review, documentation, plugin-settings]
dependencies: []
---

# 🔵 P3: No Centralized Settings Documentation

## Problem Statement
Only yellow-browser-test uses the `.claude/<plugin-name>.local.md` settings pattern for user-configurable plugin settings. This pattern is not documented in a shared location, preventing other plugin authors from discovering and using it.

## Findings
**Current State**:
- yellow-browser-test uses `.claude/yellow-browser-test.local.md` for browser paths and test settings
- No shared skill or documentation describes this pattern
- Plugins that could benefit from settings files:
  - **yellow-devin**: API keys, agent models, custom reviewer names
  - **yellow-ruvector**: embedding model settings, vector DB paths
  - **yellow-debt**: audit thresholds, custom categories

**Pattern Benefits**:
- User-specific configuration without modifying plugin code
- Gitignored by default (`.local.md` convention)
- Markdown format matches Claude context expectations
- Per-plugin namespacing via filename

## Proposed Solutions
### Solution 1: Document in yellow-core Skill (Recommended)
Create a new skill or add section to existing yellow-core skill documenting the `.local.md` pattern:

```markdown
## Plugin Settings Pattern

Plugins can read user-specific settings from `.claude/<plugin-name>.local.md`:

1. Add example settings file to plugin docs
2. Document supported settings in plugin CLAUDE.md
3. Read settings via Read tool in agents/commands
4. Provide sensible defaults if file missing

Example: yellow-browser-test uses `.claude/yellow-browser-test.local.md`
```

### Solution 2: Create Standalone Reference Document
Add `docs/plugin-settings-pattern.md` with:
- Pattern overview
- File naming conventions
- Best practices for reading settings
- Examples from yellow-browser-test
- Migration guide for plugins with hardcoded config

## Recommended Action
Apply Solution 1: add settings pattern documentation to yellow-core's create-agent-skills skill or similar shared reference.

Reference this pattern when other plugins need configuration (yellow-devin, yellow-ruvector, yellow-debt).

## Acceptance Criteria
- [ ] Settings pattern documented in shared location
- [ ] Documentation includes file naming, reading pattern, defaults handling
- [ ] Example from yellow-browser-test referenced
- [ ] Accessible to plugin authors via yellow-core or docs/

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.
**2026-02-15**: Added "Plugin Settings Pattern" section to yellow-core create-agent-skills skill (33 lines). Documents `.claude/<plugin-name>.local.md` pattern with security rules, example, and best practices.

## Resources
- Plugin marketplace review session
- Reference implementation: `plugins/yellow-browser-test/.claude/yellow-browser-test.local.md`
- Candidate location: `plugins/yellow-core/skills/create-agent-skills/SKILL.md`
