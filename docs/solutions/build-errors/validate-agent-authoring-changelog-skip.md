---
problem: validate-agent-authoring.js hard-errors on CHANGELOG.md prose mentioning deleted agents
category: build-errors
date: 2026-05-07
related-files:
  - scripts/validate-agent-authoring.js
  - tests/integration/validate-agent-authoring-changelog-skip.test.ts
related-prs:
  - audit/x-02-validator-frontmatter-only
---

# `validate-agent-authoring.js` CHANGELOG.md skip

## Problem

`pnpm release:check` fails with a hard ERROR like:

```
✗ ERROR: plugins/yellow-review/CHANGELOG.md: subagent_type "yellow-review:review:code-reviewer" does not match any declared plugin agent
```

The CHANGELOG entry that triggers it documents a deprecated agent that
was deleted. The reference is correct *as a historical fact* but the
validator's `pluginSubagentPattern` regex matched the inline-code prose
mention and looked up the value in the current agent registry, which
no longer contains the deleted agent.

This is a release blocker: it produces a false positive on every CI
run that touches `release:check`.

## Root cause

`scripts/validate-agent-authoring.js` defined `markdownFiles` as every
`.md` file under `plugins/`:

```js
const markdownFiles = walk(PLUGINS_DIR, (filePath) => filePath.endsWith('.md'));
```

The downstream loop scanned each markdown file's full body — including
prose paragraphs, inline code, and CHANGELOG entries — looking for
`subagent_type:` references. Any reference that didn't match a current
agent was flagged. CHANGELOGs are history; their references are
intentionally not current, so the check produced false positives.

## Approaches considered

1. **Frontmatter-only matching** (initial brainstorm decision): only
   match `subagent_type:` inside YAML frontmatter blocks. **Rejected**
   on closer inspection — `subagent_type:` references rarely appear in
   frontmatter; they appear in command file bodies (Task tool
   invocation pseudo-code in fenced code blocks) and inline as
   `Task(subagent_type="...")` in prose. Restricting to frontmatter
   would have effectively turned the validator into a no-op for the
   surface it actually protects.

2. **Line-start anchored regex** (`^\s*subagent_type` in multiline
   mode): catches code-block dispatches but loses inline
   `Task(subagent_type=...)` references in command file prose. Found
   ~11 such legitimate usages in the codebase.

3. **Skip CHANGELOG.md files entirely** (chosen): preserves all
   existing validation surfaces; only sacrifices CHANGELOG history
   scanning. Semantically correct: CHANGELOGs document the past, not
   the current dispatch graph.

## Solution

Single-line filter on the walk predicate:

```js
const markdownFiles = walk(
  PLUGINS_DIR,
  (filePath) =>
    filePath.endsWith('.md') && path.basename(filePath) !== 'CHANGELOG.md'
);
```

Trade-off: if a CHANGELOG entry references an agent that DOES still
exist, the validator no longer cross-checks it. Acceptable because:
- The entry was correct at write time (validated then).
- Future CHANGELOG drift on agent renames produces stale-but-harmless
  history entries; the runtime catches actual broken dispatches at
  execution time.
- Solving CHANGELOG drift would require a separate "history-aware"
  validator that knows about deleted agents — out of scope for this
  fix.

## Verification

`pnpm release:check` exits 0 cleanly. Three regression tests at
`tests/integration/validate-agent-authoring-changelog-skip.test.ts`:

1. Deleted-agent reference inside `CHANGELOG.md` → NOT flagged
2. Same reference inside a non-CHANGELOG file → STILL flagged
3. Both files present → only the non-CHANGELOG flagged; CHANGELOG silent

## Future considerations

If READMEs or solution docs start producing similar false positives
(documenting deleted agents in prose), extend the filter to a path-based
allowlist or move to a more discriminating regex (e.g., requiring the
match to be inside a fenced code block AND tagged as a dispatch). Not
needed now — the only observed false-positive surface is CHANGELOGs.
