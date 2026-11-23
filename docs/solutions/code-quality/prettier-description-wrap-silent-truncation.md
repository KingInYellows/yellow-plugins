---
title: 'Prettier Rewraps Frontmatter description into Multi-Line Form'
date: 2026-06-10
category: code-quality
track: bug
problem: 'prettier --write on plugin .md rewraps long description: scalar to multi-line, violating the single-line convention (RULE 15d); unindented continuations drop frontmatter'
tags: [prettier, frontmatter, description, rule-15d, plugin-authoring, prettierignore, format-check]
components:
  - plugins/
  - .prettierignore
---

# Prettier Rewraps `description:` into Multi-Line Form

## Problem

Running `prettier --write` on a plugin command `.md` file rewraps a
`description:` value longer than ~80 characters from valid single-line form
into a multi-line single-quoted YAML block. This violates the repo's single-line
`description:` convention (RULE 15d in `scripts/validate-agent-authoring.js`):
an unindented continuation can drop the whole frontmatter, and simpler parsers
may read only the first line. (An earlier version of this note claimed Claude
Code's frontmatter parser silently truncates valid multi-line descriptions at
the first newline; a check on Claude Code 2.1.274 in
`anthropics/claude-code#94301` found valid multi-line forms load in full for
skills and commands, while agents remain untested.)

## Symptoms

- `pnpm validate:agents` emits a `[RULE 15d advisory]` warning on multi-line
  `description:` values in skills, agents, and commands (when this issue was
  first logged in 2026-06, `pnpm validate:agents` did not check commands or
  agents for RULE 15d)
- `pnpm format:check` is NOT wired into any CI workflow, so a format pass
  can introduce wrapping silently
- The diff looks innocuous — just a line wrap

## Root Cause

Prettier's `proseWrap: always` + `printWidth: 80` wraps long YAML scalar
values as prose. This is correct Prettier behavior for body text, but it breaks
the single-line frontmatter `description:` convention (RULE 15d) that prevents
unindented continuations from dropping frontmatter and protects parsers that
read only the first line.

Additionally: `pnpm format:check` exists in `package.json` but is wired into
no CI workflow — the `plugins/` markdown tree is already prettier-dirty
wholesale. Running `prettier --check` on any untouched plugin `.md` fails.

## What Didn't Work

Testing prettier behavior on a `/tmp` copy of the file produces a false
negative: the copy misses `.prettierrc`, so prettier runs with default
settings and may not wrap. Always test in-repo.

## Solution

1. Never run `pnpm format` or `prettier --write` across `plugins/**/*.md`
2. To verify whether a specific file would be affected, run prettier in-repo
   (not in a tmp copy): `prettier --check plugins/<name>/commands/<file>.md`
3. If you must format a plugin `.md`, manually check all `description:` lines
   afterwards for multi-line wrapping

## Prevention

Add `plugins/**/*.md` to `.prettierignore` to prevent accidental formatting
of plugin authoring files. This is a repo-wide decision (not yet made as of
2026-06-10) — until it is made, treat the above as the working rule.

---

## Update — 2026-09-25

### PR #873 (yellow-plugins): `commands/review/triage.md` frontmatter description

Same failure mode reproduced during a `/review:pr` pass on PR #873: prettier
reflowed the frontmatter `description:` in
`plugins/yellow-review/commands/review/triage.md` onto multiple lines,
violating the single-line `description:` convention.

This time the fix applied was a **per-file inline opt-out** rather than the
blanket `.prettierignore` addition proposed above (still not a repo-wide
decision as of this update): add a `# prettier-ignore` comment directly above
the `description:` line, keeping it on one line while leaving the rest of the
file subject to normal formatting.

```yaml
---
name: review:triage
# prettier-ignore
description: 'Triage the review-findings ledger of one PR: ...'
---
```

Prefer `# prettier-ignore` scoped to the `description:` line when only that
field needs protecting; reserve the blanket `.prettierignore` decision for when
the number of affected files grows large enough that per-file comments become
their own maintenance burden.

---

## Update — 2026-11-22

Corrected the unverified claim that Claude Code's frontmatter parser silently
truncates valid multi-line descriptions at the first newline: testing on Claude
Code 2.1.274 (`anthropics/claude-code#94301`) showed valid multi-line skills
and commands load in full (agents were not tested), while an unindented
continuation drops all frontmatter and other parsers may read only the first
line. RULE 15d in `scripts/validate-agent-authoring.js` now checks skills,
agents, and commands (including quoted `description` keys) as an advisory
guard. See `plans/description-validators.md`.
