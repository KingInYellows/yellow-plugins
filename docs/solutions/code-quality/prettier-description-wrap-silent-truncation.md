---
title: 'Prettier Rewraps Frontmatter description into Silently-Truncated Multi-Line Form'
date: 2026-06-10
category: code-quality
track: bug
problem: 'prettier --write on plugin .md rewraps long description: scalar to multi-line, silently truncated by Claude Code frontmatter parser'
tags: [prettier, frontmatter, description, truncation, plugin-authoring, prettierignore, format-check]
components:
  - plugins/
  - .prettierignore
---

# Prettier Rewraps `description:` into Silently-Truncated Form

## Problem

Running `prettier --write` on a plugin command `.md` file rewraps a
`description:` value longer than ~80 characters from valid single-line form
into the multi-line single-quoted block form that Claude Code's frontmatter
parser silently truncates at the first newline.

## Symptoms

- Plugin command descriptions appear truncated in the Claude Code UI
- `pnpm validate:agents` does not catch the truncation
- `pnpm format:check` is NOT wired into any CI workflow, so a format pass
  can introduce this silently
- The diff looks innocuous — just a line wrap

## Root Cause

Prettier's `proseWrap: always` + `printWidth: 80` wraps long YAML scalar
values as prose. This is correct Prettier behavior for body text but wrong
for frontmatter `description:` values, which must be single-line to be
parsed correctly by Claude Code.

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
`plugins/yellow-review/commands/review/triage.md` onto multiple lines, which
Claude Code's frontmatter parser silently truncates.

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
