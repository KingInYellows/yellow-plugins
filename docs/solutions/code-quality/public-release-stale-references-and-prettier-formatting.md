---
title: 'Public Release Cleanup: Stale Doc References and Prettier Metadata Formatting'
category: code-quality
date: 2026-02-18
tags:
  - public-release
  - stale-references
  - prettier-formatting
  - bulk-editing
  - bot-review-triage
  - documentation-cleanup
problem_type: documentation-maintenance
components:
  - docs/operations/
  - docs/contracts/
  - docs/cli/
  - docs/ui/
  - plugins/yellow-ci/
  - config files (.gitignore, .eslintrc.cjs, .eslintignore, .prettierignore)
sessions:
  - date: 2026-02-18
    pr: 24
    findings: 4 TODOs + 7 PR review threads
    resolved: all
related:
  - docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md
severity: medium
---

# Public Release Cleanup: Stale Doc References and Prettier Metadata Formatting

## Problem Statement

During public release preparation (PR #24), two classes of issues surfaced:

1. **Stale references to archived docs**: 95 internal documents (SPECIFICATION.md,
   traceability-matrix.md, `.codemachine/` artifacts, PRD.md) were archived to a
   `development` branch, but 19+ files in `docs/` still referenced them with
   broken markdown links and plain-text mentions.

2. **Prettier collapsing markdown metadata blocks**: Running `prettier --write`
   with `proseWrap: always` collapsed adjacent `**key**: value` lines into
   single-paragraph text, destroying readability of metadata headers/footers.

## Symptoms

- Broken markdown links in docs/ (404 when navigating)
- FR-/NFR-/CRIT- requirement identifiers referencing a non-existent spec
- `.codemachine/` paths in config ignore files for a deleted directory
- Gemini code-assist bot flagging 7 identical formatting issues on PR review
- Metadata blocks like `**Version**: 1.0.0 **Updated**: 2026-01-12 **Task**: ...`
  unreadable in source

## Root Cause

### Stale References

The Phase 1 archive operation moved 95 internal docs to a `development` branch
but didn't scan remaining files for references to those docs. References existed
in three forms:

1. **Markdown links**: `[text](../SPECIFICATION.md#anchor)` — broken links
2. **Plain-text references**: `docs/SPECIFICATION.md` — confusing mentions
3. **Ignore rules**: `.codemachine/` entries in 4 config files — harmless but
   stale

### Prettier Metadata Collapsing

Prettier's `proseWrap: always` with `printWidth: 80` treats adjacent markdown
lines as a single paragraph. Metadata blocks like:

```markdown
**Document Version**: 1.0.0
**Last Updated**: 2026-01-12
**Task Reference**: I3.T4
```

Get collapsed to:

```markdown
**Document Version**: 1.0.0 **Last Updated**: 2026-01-12 **Task Reference**:
I3.T4
```

This is correct Prettier behavior for prose but wrong for metadata blocks.

## Solution

### 1. Bulk Stale Reference Removal (sed + find/xargs)

Three-pass sed approach to strip markdown links while preserving visible text:

```bash
# Pass 1: Strip SPECIFICATION.md links → keep visible text
find docs -name '*.md' \
  -not -path 'docs/plans/*' \
  -not -path 'docs/brainstorms/*' \
  | xargs sed -i -E 's/\[([^]]+)\]\(\.\.\/SPECIFICATION\.md[^)]*\)/\1/g'

# Pass 2: Strip traceability-matrix.md links
find docs -name '*.md' \
  -not -path 'docs/plans/*' \
  -not -path 'docs/brainstorms/*' \
  | xargs sed -i -E 's/\[([^]]+)\]\(\.\.\/traceability-matrix\.md[^)]*\)/\1/g'

# Pass 3: Strip .codemachine/ links
find docs -name '*.md' \
  -not -path 'docs/plans/*' \
  -not -path 'docs/brainstorms/*' \
  | xargs sed -i -E 's/\[([^]]+)\]\(\.\.\/\.codemachine\/[^)]*\)/\1/g'
```

**Key pattern**: `s/\[([^]]+)\]\(\.\.\/TARGET[^)]*\)/\1/g` — captures link text,
removes the link syntax, leaves the text in place.

After the bulk sed, **manual cleanup** was needed for:
- Plain-text mentions (`docs/SPECIFICATION.md`, `.codemachine/planning/...`)
- Orphaned reference sections (entire "Architecture Documents" sections with only
  dead links)
- Orphaned `Verification Strategy §6` text (previously linked to `.codemachine/`)

### 2. Stale Config Ignore Rules

Removed `.codemachine/` entries from 4 config files:
- `.gitignore:84-88` (5 lines)
- `.eslintignore:25` (1 section)
- `.prettierignore:21` (1 section)
- `.eslintrc.cjs:164` (1 array entry)

### 3. Prettier Metadata Block Fix

Add `<!-- prettier-ignore -->` before metadata blocks:

```markdown
<!-- prettier-ignore -->
**Document Version**: 1.0.0
**Last Updated**: 2026-01-12
**Task Reference**: I3.T4 - Enhanced Uninstall Experience
**Purpose**: Transaction audit logging
```

This is a Prettier-native escape hatch that preserves manual formatting for the
immediately following markdown block while keeping Prettier active for the rest
of the file.

**When to use**: Any block of adjacent `**key**: value` lines that should stay
on separate lines (metadata headers, footers, document properties).

**When NOT to use**: JSON arrays collapsed by Prettier — these are controlled by
`printWidth` and are usually fine collapsed for short arrays.

### 4. Batch Bot Review Comment Resolution

Pattern for handling repetitive automated review comments:

1. **Fetch** unresolved threads via GraphQL script
2. **Categorize** — all 7 were the same Prettier formatting issue
3. **Fix** what's fixable (markdown metadata → `prettier-ignore`)
4. **Accept** what's Prettier-enforced (JSON arrays — short, readable)
5. **Batch resolve** all threads via GraphQL mutation script

## Prevention Strategies

### Stale Reference Detection

Add a CI check or pre-archive script:

```bash
# Before archiving docs, find all references in remaining files
for doc in SPECIFICATION.md traceability-matrix.md PRD.md; do
  echo "=== References to $doc ==="
  grep -rn --include='*.md' --exclude-dir='plans' --exclude-dir='brainstorms' "$doc" docs/
done
```

### Prettier Metadata Protection

When creating new markdown docs with metadata blocks, always add
`<!-- prettier-ignore -->` before the block. This should be part of any document
template.

### Bot Review Comment Triage

When an automated reviewer (Gemini, CodeRabbit) generates 5+ comments about the
same issue:

1. Check if it's a formatter-enforced pattern (Prettier, ESLint --fix)
2. If yes: fix what's fixable, dismiss the rest, batch-resolve
3. Don't spend time on individual responses to repetitive bot comments

## Files Changed

| Category | Count | Files |
|----------|-------|-------|
| Stale doc references | 19 | docs/operations/*, docs/contracts/*, docs/cli/*, docs/ui/* |
| Config ignore rules | 4 | .gitignore, .eslintignore, .prettierignore, .eslintrc.cjs |
| Proxmox/homelab generalization | 4 | plugins/yellow-ci/* |
| Prettier metadata fix | 3 | .claude-plugin/audit/README.md, .github/releases.md, api/cli-contracts/README.md |
| TODO status updates | 4 | todos/056, 096, 097, 098 |

## Key Takeaways

1. **Archive operations need reference scanning**: When moving/archiving docs,
   always grep for references in remaining files before committing.

2. **`<!-- prettier-ignore -->` is the right tool for metadata blocks**: Don't
   fight Prettier's prose wrapping — use the escape hatch where needed.

3. **Sed bulk operations + manual cleanup**: Sed handles the repetitive link
   stripping (hundreds of links), but orphaned plain-text references and
   reference sections need manual judgment.

4. **Bot review comments batch well**: When all comments are the same issue,
   categorize → fix fixable → batch resolve. Don't treat each as individual.

5. **JSON arrays are fine collapsed**: Prettier's JSON `printWidth: 100`
   collapsing short arrays is a reasonable default. Don't fight it.
