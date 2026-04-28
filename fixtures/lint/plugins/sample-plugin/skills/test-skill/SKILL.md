---
name: test-skill
description: Skill fixture used to validate the skill-reference resolver in lint-plugins.sh.
user-invokable: false
---

# Test Skill

Body content. The body intentionally contains a stray `name:` line below to
regression-test the P1 fix from PR #261, which scoped name extraction to
frontmatter so body prose can no longer corrupt the known-skills set.

The next line deliberately starts at column 1 with no blockquote or code
fence prefix, so an awk extractor running on the whole file (the pre-fix
bug) would match `^name:` against it. The lint script must NOT treat this
body-prose `name:` as a skill — only the frontmatter `name: test-skill`
should index.

name: should-not-be-collected
