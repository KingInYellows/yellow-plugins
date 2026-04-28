---
name: skill-body-ref
description: Fixture referencing a string that only appears in SKILL.md body prose. Lint MUST error with "unknown skill" — proves the pre-PR-261 body-parsing regression stays fixed.
model: inherit
skills:
  - should-not-be-collected
tools:
  - Read
---

# Skill Body Regression Fixture

If the lint script collects `name:` lines from SKILL.md body prose, this
agent's reference to `should-not-be-collected` would silently resolve. The
fix in PR #261 scopes name extraction to frontmatter, so this reference
must surface as "unknown skill: should-not-be-collected".
