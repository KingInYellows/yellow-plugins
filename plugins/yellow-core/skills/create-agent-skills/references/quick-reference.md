# Quick Reference — Create-Agent-Skills

Copy-paste templates for creating new commands, skills, and plugin settings.
Linked from `SKILL.md`.

## Create command

```bash
cat > .claude/commands/my-cmd.md << 'EOF'
---
name: my-cmd
description: Does X. Use when Y.
---

# My Command

Instructions here.
EOF
```

## Create skill

```bash
mkdir -p .claude/skills/my-skill
cat > .claude/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: Does X. Use when Y.
---

# My Skill

Instructions here.
EOF
```

## Test invocation

```bash
/my-skill arg1 arg2
```

## Plugin Settings Pattern

Plugins can read user-specific configuration from
`.claude/<plugin-name>.local.md`:

**File Location:** `.claude/<plugin-name>.local.md`

**Format:** YAML frontmatter + optional markdown notes

**Security:** Never store credentials — reference env var names only (e.g.,
`$MY_TOKEN`)

**Example:**

```yaml
---
schema: 1
devServer:
  command: 'npm run dev'
  port: 3000
auth:
  credentials:
    email: '$BROWSER_TEST_EMAIL'
    password: '$BROWSER_TEST_PASSWORD'
---
# Notes
Optional markdown content for user reference.
```

**Best Practices:**

- Provide sensible defaults if settings file is missing
- Document supported settings in plugin's CLAUDE.md
- Use `schema: 1` for future versioning support
- Settings files are gitignored by `.local.md` convention

**Reference:** See `yellow-browser-test` plugin for working example.
