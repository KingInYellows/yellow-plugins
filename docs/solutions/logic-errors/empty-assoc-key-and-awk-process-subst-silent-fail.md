---
title: 'Empty Associative-Array Keys and Unchecked awk Process Substitution Make a Bash Helper Fail Silently'
date: 2026-10-05
category: logic-errors
track: bug
problem: 'bash rejects a[""]=1, and a process-substituted awk decoder that fails (mawk has no strtonum) leaves a batch helper printing nothing and exiting 0, while 457 passing tests never put a blank line in a window or ran under mawk'
tags:
  - bash
  - associative-array
  - awk
  - mawk
  - process-substitution
  - silent-failure
  - jq
  - quote-ground
  - yellow-core
---

## Problem

`plugins/yellow-core/lib/quote-ground.sh` (PR #1027) grounds a quoted line
inside a cited window. Review found two defects the full yellow-core bats suite
did not, and both were reproduced locally.

## Symptoms

- A blank line inside the cited window made `check` exit 1 (reported as
  ungrounded) and `batch` print nothing. The helper keyed its normalized-line
  cache on the raw line text, and bash 5.2 rejects an empty subscript:
  `a[""]=1` fails with `bad array subscript`. An empty quote hit the same path.
- With mawk as `awk`, `batch` printed `function strtonum never defined` on
  stderr and exited 0 with empty stdout. The row decoder was an awk program in a
  `done < <(awk ...)` process substitution, whose exit status the parent shell
  never sees, so the read loop saw EOF and finished "successfully".

## What Didn't Work

- Trusting the green suite. No fixture had a blank line, and CI installs gawk,
  which hides the mawk-only failure.
- Checking `$?` after the loop. A process substitution's status is not reported
  to the parent, so there is nothing to check.

## Solution

1. Prefix every associative-array key built from data with a non-empty sentinel
   (`k:$line`, `p:$file`, `f:$file`). An empty quote or blank line is then a
   valid subscript.
2. Do not decode through a process substitution whose status you ignore. One
   `jq` pass decodes the rows, and a row that jq cannot decode fails the whole
   input before any row is printed. Reject a field that contains U+0000 inside
   jq, because it would shift the NUL framing.
3. Read each file through a command substitution (`recs=$(awk ...) || exit 2`)
   instead of `< <(awk ...)`, so a read failure exits 2 rather than reporting an
   ungrounded quote.
4. Emit output objects with one `jq -nc ... --args` call so jq escapes every
   control character; prefix each value with one character that jq strips so an
   id starting with `-` is never read as an option.
5. Add a fail-fast `BASH_VERSINFO` guard (4.4 or newer, because an empty array
   under `set -u` is an error before 4.4) before the first `declare -A`, and
   clamp the window loops to the loaded file's line count.
6. Keep unredacted text off disk: feed the redactor through a pipe, read the
   decoded rows from a process substitution that prints a row count first (a
   failed jq leaves the count unread, so the failure cannot hide), and use no
   temp files at all, so there is nothing to clean up on `exit 2` or a signal.

## Why This Works

A non-empty prefix makes every key a valid subscript whatever the line holds.
Letting jq own decoding and encoding removes the awk dialect dependency, and
reading its own status turns a quietly dead decoder into a loud exit 2.

## Prevention

- Fixtures for any text-keyed map must include empty, whitespace-only and
  duplicate lines.
- Never rely on the failure of a `< <(cmd)` producer being visible. Write to a
  temp file or a command substitution and check the status.
- Use POSIX awk only (no `strtonum`, `gensub`, `asort`) or call `jq`; Debian and
  Ubuntu default `awk` is often mawk. Run batch tests under both awks.
- Add a version guard for scripts that need bash 4+ (macOS ships 3.2).
