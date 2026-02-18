---
status: pending
priority: p2
issue_id: "082"
tags: [code-review, quality, documentation]
dependencies: []
---

# 🟡 P2: Missing shell examples in skills that reference scripts

## Problem Statement
Two skills reference shell scripts but lack concrete code examples demonstrating proper usage patterns. Project conventions require that code examples quote ALL variables, but these skills provide no examples to demonstrate this pattern.

## Findings
**Skills missing shell examples:**
1. `plugins/yellow-linear/skills/linear-workflows/SKILL.md` - references Linear API scripts
2. `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md` - references validation and hook scripts

Both skills mention shell script usage but don't show code examples with proper variable quoting patterns like `"$var"`.

This violates the project convention from Shell Documentation Patterns: "Quote ALL variables in code examples: `"$var"` in tests and case statements"

## Proposed Solutions
### Solution 1: Add shell code example sections to both skills (Recommended)
Add dedicated "Shell Script Examples" sections showing proper variable quoting, error handling, and validation patterns.

**Pros:**
- Demonstrates best practices concretely
- Makes quoting requirements explicit
- Easier for users to copy correct patterns
- Aligns with documentation standards

**Cons:**
- Adds content to skill files
- Must maintain examples

**Effort:** 1-2 hours
**Risk:** Low

### Solution 2: Reference external documentation
Link to existing script files as examples instead of embedding code.

**Pros:**
- Avoids duplication
- Examples stay in sync with code

**Cons:**
- Less discoverable
- Requires navigating to other files
- Doesn't highlight key patterns

**Effort:** 30 minutes
**Risk:** Low

## Recommended Action
Adopt Solution 1: add inline shell code examples demonstrating proper variable quoting and key patterns.

## Technical Details
Files to modify:
1. `plugins/yellow-linear/skills/linear-workflows/SKILL.md`
2. `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md`

Add sections like:
```markdown
## Shell Script Examples

### Variable Quoting
Always quote variables to handle spaces and special characters:

\`\`\`bash
# Good
if [ -f "$config_file" ]; then
  source "$config_file"
fi

# Bad (unquoted)
if [ -f $config_file ]; then
  source $config_file
fi
\`\`\`

### Error Handling
\`\`\`bash
validate_input() {
  local name="$1"
  case "$name" in
    *..*|/*|~*)
      printf 'Error: Invalid name "%s"\n' "$name" >&2
      return 1
      ;;
  esac
}
\`\`\`
```

## Acceptance Criteria
- [ ] yellow-linear/skills/linear-workflows/SKILL.md has shell examples section
- [ ] yellow-ruvector/skills/ruvector-conventions/SKILL.md has shell examples section
- [ ] All examples properly quote variables
- [ ] Examples demonstrate key patterns from project conventions

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- Project memory: "Shell Documentation Patterns"
- `docs/solutions/security-issues/yellow-ruvector-plugin-multi-agent-code-review.md`
