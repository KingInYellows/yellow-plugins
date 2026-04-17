---
name: test-skill
description: Skill fixture used to validate the skill-reference resolver in lint-plugins.sh.
user-invokable: false
---

# Test Skill

Body content. The body intentionally contains a stray `name:` line below to
regression-test the P1 fix from PR #261, which scoped name extraction to
frontmatter so body prose can no longer corrupt the known-skills set.

> Example documentation snippet that mentions `name: should-not-be-collected`
> in body prose. The lint script must NOT treat this string as a skill name.
