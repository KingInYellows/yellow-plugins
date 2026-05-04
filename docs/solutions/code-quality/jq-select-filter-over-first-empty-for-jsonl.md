---
title: Use jq select() Not first(expr // empty) for JSONL Field Extraction
date: 2026-05-04
category: code-quality
track: bug
problem: jq first(.field // empty) emits per-line errors on JSONL streams where most lines lack the field, producing unpredictable output even with 2>/dev/null
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
line, jq processes the expression `.part.snapshot.sessionID // empty` and
finds the field absent. `first(... // empty)` emits no output for those lines
but also generates a jq-internal error per line. The `2>/dev/null` suppresses
all errors — including genuine parse failures — making the failure invisible.

When many lines lack the field, jq's behavior under `first()` with an empty
generator becomes implementation-dependent. In practice the result is either:
- An empty string (session ID appears unset even when it exists later in the file)
- Partial output from a line where the field exists but error recovery is off

The `2>/dev/null` then guarantees no diagnostic is surfaced when things go
wrong. The command silently returns empty and the session cleanup / session
reference step silently no-ops.

## Key Insight

**`select(.field != null)` omits non-matching lines cleanly without erroring.**
Pair it with `| head -1` to take the first match. This is the idiomatic jq
pattern for "find the first line in a JSONL stream that has a field."

`first(expr // empty)` is designed for in-memory JSON arrays, not streaming
JSONL. On JSONL input it processes the entire file as a sequence of values and
the `first()` semantics interact poorly with a generator that produces zero
outputs on most inputs.

## Fix

```bash
# WRONG: first() + empty on JSONL — per-line errors, unpredictable output
SESSION_ID=$(jq -r 'first(.part.snapshot.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)

# CORRECT: select() filter skips non-matching lines without error
SESSION_ID=$(jq -r 'select(.part.snapshot.sessionID != null) | .part.snapshot.sessionID' \
  "$OUTPUT_FILE" 2>/dev/null | head -1)
```

The `select()` version:
- Emits zero output for lines that lack the field (no error)
- Emits the field value for lines that have it
- `head -1` takes the first match, consistent with the original intent
- `2>/dev/null` is still appropriate to suppress genuine parse errors on
  malformed lines, but it no longer suppresses structural field-absence errors

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
   JSONL stream. For JSONL, use `select()` + `head -1` instead.
2. If `2>/dev/null` is present: confirm that the suppressed errors are only
   line-parse failures, not field-absence errors from `// empty` on mismatched
   lines.

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
