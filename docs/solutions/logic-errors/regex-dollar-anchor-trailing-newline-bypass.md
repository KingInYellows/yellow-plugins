---
title: 'Regex $ Anchor Matches Before a Trailing Newline (Python re and jq/Oniguruma)'
date: 2026-09-28
category: logic-errors
track: bug
problem: '^...$ allow-list checks in Python re.match() and jq test() accept a trailing newline, letting crafted input slip validation'
tags:
  - regex
  - validation
  - allow-list
  - python
  - jq
  - oniguruma
components:
  - plugins/yellow-core/lib/context-observer.py
  - plugins/yellow-core/lib/context-observer.sh
  - plugins/yellow-core/skills/session-handoff/scripts/handoff.sh
---

# Regex $ Anchor Matches Before a Trailing Newline

## Problem

Two independent allow-list checks used `^pattern$` anchors to validate an
identifier or timestamp before trusting it for a file path or a JSON record.
Both were bypassable by appending a trailing `\n` to the input, because `$`
matches the end of the string **or** immediately before a trailing newline in
both Python's `re` and jq's Oniguruma engine (verified with jq 1.7). A value
like `"abc123\n"` satisfies `^[A-Za-z0-9_-]{1,128}$`, and
`"2026-09-28T00:00:00Z\n"` satisfies a `^…Z$` timestamp check. Text after an
embedded newline does not pass; only the trailing newline does.

## Symptoms

Before the fix in this PR (line numbers omitted on purpose; the code has moved):

- `SESSION_ID_RE` in `plugins/yellow-core/lib/context-observer.py` was
  `re.compile(r"^[A-Za-z0-9_-]{1,128}$")` checked with `.match()`. A session id
  with a trailing newline passed and was used to build a project slug / write
  path. It is now an unanchored pattern checked with `.fullmatch()`.
- `plugins/yellow-core/skills/session-handoff/scripts/handoff.sh` passed
  `HANDOFF_TS_RE='^[0-9]{4}-...Z$'` into jq as `--arg ts_re` and checked it
  with `test($ts_re)`. A trailing newline let a note's
  `context_at_capture.observed_at` through with the newline still in it. That
  jq check is gone: validation now goes through `co_context`
  (`CO_CONTEXT_JQ`, `\A…\z`). `HANDOFF_TS_RE` still exists for the bash
  `[[ =~ ]]` check in `ho_shaped`; there `$` does not accept a trailing
  newline, so that use is safe and was left alone.
- Reads as correct at a glance: the pattern looks fully anchored, and
  hand-typed test inputs during development never exercise the
  trailing-newline case.

## What Didn't Work

The fix isn't "add `\A`/`\Z` anywhere" — the correct spelling is
engine-specific, and the codebase already had both a correct and an
incorrect example of the *same* timestamp check next to each other:

- The observation reader in `plugins/yellow-core/lib/context-observer.sh`
  validated the identical ISO-8601 timestamp shape correctly:
  `test("\\A[0-9]{4}-...Z\\z")` — jq/Oniguruma, lowercase `\z`.
- `handoff.sh` validated the same shape in jq via a bash variable
  (`HANDOFF_TS_RE`) built with a bare `^...$`, so it inherited the unsafe
  anchor instead of the sibling's `\A...\z` convention.

## Solution

Fixed in this PR by using each engine's *true end-of-string* anchor — the
spelling is not interchangeable across engines:

- **Python `re`** (`context-observer.py`): switched `.match()` on `^...$`
  to `SESSION_ID_RE.fullmatch(value)`. `fullmatch()` requires the whole
  string to match with no anchor ambiguity at all.
- **jq / Oniguruma** (`handoff.sh`): the check now uses `co_context` from
  `CO_CONTEXT_JQ` in `lib/context-observer.sh`, one jq definition shared by
  the reader and the note parser, anchored with `\A...\z` (lowercase `z`).
  One definition means the two sites cannot drift apart again.

## Why This Works

`fullmatch()` / `\A...\z` require the match to consume the entire string
with no "end of string, allowing one trailing newline" carve-out. That
carve-out exists in most regex engines to make `$` useful for line-oriented
multi-line text; it's exactly wrong for allow-list validation of a single
scalar token.

## Prevention

- For any allow-list gate whose output is trusted for a path, filename, or
  embedded JSON/shell value, prefer `fullmatch`/exact-length equivalents
  over `^...$`.
- When porting the same validation shape to a second language or tool
  (Python regex here, jq/Oniguruma there), don't assume `\A`/`\Z`/`\z` mean
  the same thing: in Python, `\Z` is the safe true-end anchor and `$` is the
  unsafe one; in jq/Oniguruma it's the opposite capitalization — lowercase
  `\z` is safe, `\Z` still has the trailing-newline exception. Check the
  engine's own docs and use exactly that spelling; `CO_CONTEXT_JQ` in
  `lib/context-observer.sh` is the jq/Oniguruma reference in this codebase.
- Add a test fixture that appends a trailing `\n` to every allow-list regex
  test case.
