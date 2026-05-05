---
title: Use jq select() Not first(expr // empty) for JSONL Field Extraction
date: 2026-05-04
category: code-quality
track: bug
problem: jq first(.field // empty) on a JSONL stream errors when no line contains the field (empty generator), and 2>/dev/null silences genuine parse errors alongside it, producing unpredictable silent failures
tags: [jq, jsonl, select, first, shell, command-authoring, silent-failure, extraction]
components:
  - plugins/yellow-council/agents/review/opencode-reviewer.md
---

# Use `jq select()` Not `first(expr // empty)` for JSONL Field Extraction

## Problem

Yellow-council's opencode reviewer extracted a session ID from a JSONL output
file using:

```bash
SESSION_ID=$(jq -r 'first(.part.snapshot.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)
```

On a real JSONL stream, most lines are progress events, log entries, or other
structured objects that do not have `.part.snapshot.sessionID`. For each such
line, jq evaluates `.part.snapshot.sessionID` as `null`, and `// empty`
converts that to `empty` — cleanly, without error. So the expression is
not error-prone per line.

The actual failure mode is different: if **no** line in the file contains the
field, the generator inside `first()` produces zero outputs. `first()` with an
empty generator emits a jq error (`null (null) has no keys` or similar, depending
on jq version) and exits non-zero. The `2>/dev/null` suppresses that error
alongside genuine JSONL parse failures on malformed lines, making both failure
modes invisible. `SESSION_ID` is silently set to empty even when the field does
exist further in the file or when the file itself is corrupt.

A second, subtler problem: `first()` returns only one value. If the caller
later needs all matching session IDs (e.g., for multi-session cleanup), the
pattern silently drops all but the first without any indication that more
matches were available.

## Key Insight

**`select(.field != null)` omits non-matching lines cleanly and emits the
field value for every matching line.** Pair it with `| head -1` to take the
first match, or omit `head -1` to collect all matches. This is the idiomatic
jq pattern for "find lines in a JSONL stream that have a field."

`first(expr // empty)` works correctly when at least one line matches, but
errors when zero lines match (empty generator). It also returns only one value,
hiding the availability of additional matches. `select()` avoids both problems:
it never errors on field absence and naturally produces all matches, letting
the caller decide how many to consume.

## Fix

```bash
# WRONG: first() + empty on JSONL — errors when no line matches, hides all-matches case
SESSION_ID=$(jq -r 'first(.part.snapshot.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)

# CORRECT: select() filter skips non-matching lines without error
SESSION_ID=$(jq -r 'select(.part.snapshot.sessionID != null) | .part.snapshot.sessionID' \
  "$OUTPUT_FILE" 2>/dev/null | head -1)
```

The `select()` version:

- Emits zero output for lines that lack the field (no error — field absence evaluates to `null` then filters out cleanly)
- Emits the field value for every line that has it
- `head -1` takes the first match, consistent with the original intent; omit it to collect all matches
- `2>/dev/null` is still appropriate to suppress genuine parse errors on
  malformed JSONL lines; unlike the `first()` pattern, there are no empty-generator errors for it to accidentally hide

### Nested field path variant

For deeply nested paths, the same pattern applies:

```bash
# Extract first occurrence of a nested field from JSONL
VALUE=$(jq -r 'select(.a.b.c != null) | .a.b.c' "$FILE" 2>/dev/null | head -1)
```

### With a fallback

If no matching line exists and a fallback is needed:

```bash
SESSION_ID=$(jq -r 'select(.part.snapshot.sessionID != null) | .part.snapshot.sessionID' \
  "$OUTPUT_FILE" 2>/dev/null | head -1)
SESSION_ID="${SESSION_ID:-}"   # explicit empty-string fallback
```

## Detection

```bash
# Find first(...// empty) patterns applied to file inputs (JSONL risk)
rg "first\(.*//\s*empty\)" plugins/ --include='*.md'

# Find jq invocations with 2>/dev/null that extract nested fields from files
# (candidates for the suppressed-error pattern)
rg "jq.*2>/dev/null.*\\.\\w+\\.\\w+" plugins/ --include='*.md'
```

When reviewing jq expressions that read JSONL files:

1. If the expression uses `first()`: verify the input is a JSON array, not a
   JSONL stream. For JSONL, use `select()` + `head -1` instead. `first()` errors
   when zero lines match — which is a silent failure when `2>/dev/null` is also
   present.
2. If `2>/dev/null` is present: confirm it is only suppressing genuine JSONL
   parse errors (malformed JSON lines). If `first(... // empty)` is also present,
   it may also be silencing the empty-generator error, masking a real failure.

## Prevention

- [ ] JSONL field extraction always uses `select(.field != null) | .field` +
      `head -1`, never `first(.field // empty)` on streaming input
- [ ] `2>/dev/null` on jq commands is documented with a comment explaining
      what errors are expected and why suppression is acceptable
- [ ] When adding a new field extraction from a JSONL output file, prototype
      the jq expression against a real sample file with mixed-schema lines
      before adding to a command file

## Related Documentation

- MEMORY.md: "jq pipelines: always capture exit code" (GitHub GraphQL Shell
  Patterns section) — complementary: always check exit code even when using
  `2>/dev/null`
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  — broader shell anti-patterns in command files
- `docs/solutions/integration-issues/gh-api-graphql-plugin-command-template.md`
  — jq null guard patterns for GraphQL responses (analogous `select` usage)
