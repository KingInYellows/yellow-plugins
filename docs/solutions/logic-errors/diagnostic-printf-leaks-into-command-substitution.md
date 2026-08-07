---
title: 'A validator printing its own diagnostic without a stderr redirect leaks it into the very $() capture it exists to protect'
date: 2026-08-06
category: logic-errors
track: bug
problem: 'awk END-block printf with no stderr redirect inside FINDINGS=$(...) command substitution mixed a "dropped N malformed" diagnostic into the captured findings data'
tags:
  - bash
  - awk
  - command-substitution
  - stderr-redirect
  - silent-failure
  - validator-self-contamination
components:
  - plugins/yellow-codex/agents/review/codex-reviewer.md
---

# A validator printing its own diagnostic without a stderr redirect leaks it into the very $() capture it exists to protect

## Problem

`plugins/yellow-codex/agents/review/codex-reviewer.md`'s field-shape
validator counts malformed finding records dropped during validation and
reports the count with a diagnostic line, from inside an awk `END` block:

```awk
if (dropped > 0)
  printf "[codex-reviewer] dropped %d malformed finding record(s) during field-shape validation\n", dropped
```

The awk program runs as part of a pipeline whose combined stdout is
captured via command substitution:

```bash
FINDINGS="$(... | awk '...')"
```

With no explicit redirect, `printf` writes to stdout by default — the
same stream `$(...)` captures. The diagnostic line the validator prints to
tell an operator "I dropped N malformed records" becomes part of
`$FINDINGS` itself: exactly the downstream consumer-side data corruption
the field-shape validator exists to prevent in the first place. A
validator whose job is to keep malformed data out of the findings stream
was, on its own error path, injecting a malformed *line* into that same
stream.

## Why This Matters

This is not a cosmetic log-noise issue. `$FINDINGS` downstream is parsed
structurally (split into per-finding records, each field-shape checked
again, then rendered). An extra non-conforming line mixed into that
stream is itself malformed input to every downstream consumer — the bug
compounds through exactly the pipeline stage the validator was added to
harden. In a security-review context (this validator runs inside a code
review agent), a diagnostic string interleaved with real findings data is
also a plausible vector for a downstream parser to misattribute or drop
adjacent real findings, depending on how strict that parser's line-based
splitting is.

## Root Cause

`printf` (and `echo`) write to file descriptor 1 (stdout) by default. Any
script whose stdout is being captured via `$(...)` or piped into another
command must explicitly redirect anything that is diagnostic/log output —
not part of the intended captured value — to file descriptor 2 (stderr).
This is easy to get right at the top level of a script (`printf '...' >&2`
reads naturally) and easy to miss inside a nested `awk`/`sed`/`perl`
program embedded in a larger pipeline, because the redirect has to be
written using that language's own I/O syntax (`> "/dev/stderr"` in awk,
not a bash-level `>&2` — awk's own `print ... > "/dev/stderr"` is the
correct form; a bash-level redirect on the awk invocation would send
*all* of awk's output to stderr, including the real findings data awk is
also printing on non-error lines).

## Fix

```awk
if (dropped > 0)
  printf "[codex-reviewer] dropped %d malformed finding record(s) during field-shape validation\n", dropped > "/dev/stderr"
```

Only the diagnostic line is redirected — the awk program's normal `print`
statements for real findings still go to stdout and are still captured by
the surrounding `$(...)`.

## Detection

```bash
# Any printf/print/echo inside an awk program embedded in a command-substitution
# pipeline that has no explicit stderr redirect is a candidate
rg -n '(printf|print|echo)[[:space:]]' plugins/*/agents/**/*.md plugins/*/commands/**/*.md \
  | rg -v '>&2|"/dev/stderr"|> "/dev/stderr"'
```

When reviewing any script whose output is captured with `VAR="$(...)"` or
piped downstream:

- Every `printf`/`print`/`echo` call that is diagnostic (a count, a
  warning, a progress message) rather than the intended payload must be
  explicitly redirected to stderr, in the syntax of whatever language
  emits it.
- Verify the redirect empirically: run the pipeline with a case that
  triggers the diagnostic and assert the captured variable's value is
  unaffected — don't just confirm the redirect syntax parses.

## Prevention Checklist

- [ ] Every diagnostic/log line inside a script whose stdout feeds a
      `$(...)` capture or a pipe is redirected to stderr, using the
      correct redirect syntax for the language it's written in (awk's
      `> "/dev/stderr"`, not a bash-level `>&2` wrapped around the whole
      awk invocation if awk also emits real payload data on stdout)
- [ ] A test case exists that deliberately triggers the diagnostic path
      (e.g. feeds malformed input) and asserts the captured value is
      exactly the expected payload, not payload-plus-diagnostic
- [ ] Field-shape / self-validating guards are reviewed for this failure
      mode specifically — a guard's own error-reporting path is a
      privileged position to corrupt the data it validates, and bugs
      there are easy to miss because the guard "looks like" it's working
      correctly on the happy path

## Related Documentation

- `docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md` —
  a different stderr-redirect pitfall in the same command-authoring
  surface (noclobber breaking `2>` onto an existing file), adjacent but
  distinct root cause
- `docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`
  — this PR's other silent-failure finding in the same file family: a new
  outcome falling through to a default bucket is a different mechanism
  (missing enum slot) but the same class of "the guard exists specifically
  to prevent silent corruption, and a gap in the guard reintroduces it"
