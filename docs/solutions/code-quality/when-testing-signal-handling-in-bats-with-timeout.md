---
title: 'When testing signal handling in bats with timeout'
date: 2026-09-29
category: code-quality
track: knowledge
problem: 'timeout exits 124 after successfully delivering a signal, which makes bats tests fail even though signal delivery is the intended outcome.'
tags: [test-harness, bats, timeout-handling]
source: compound-staging
---

# When testing signal handling in bats with timeout

## Context

When testing signal handling in bats with timeout, the timeout tool exits 124 after its deadline passes and it sends the signal (e.g., `-s TERM`). That nonzero status fails a bare piped command under bats, but `cmd || true` is the wrong fix: it also swallows a child that exits early or a broken invocation, so the following output assertion can pass on a regression.

Capture the status and assert the expected value instead:

```bash
# macOS/BSD has no `timeout` unless coreutils provides `gtimeout`.
killer=$(command -v timeout || command -v gtimeout || true)
[ -n "$killer" ] || skip "timeout/gtimeout not available"
# Without pipefail, the pipeline status is the killer's own status.
if { printf 'first-part'; sleep 3; printf 'second-part'; } \
    | "$killer" -s TERM 1 python3 "$OBS" > "$TEST_HOME/out"; then
  rc=0
else
  rc=$?
fi
[ "$rc" -eq 124 ]                            # deadline reached, signal sent
[ "$(cat "$TEST_HOME/out")" = "first-part" ]     # the handler's observable effect
```

Treat the other statuses as distinct failures, not as success:

| Status | Meaning |
|--------|---------|
| 124 | Deadline reached; the expected result for a signal test |
| 125 | `timeout` itself failed |
| 126 / 127 | The command could not be invoked or was not found |
| 137 | SIGKILL was sent (`-s KILL`, or `-k` after a TERM-ignoring child) |
| other | The child exited on its own before the deadline, with its own status |

Keep an assertion on what the handler did (forwarded output, restored file, removed temp file). The status alone only proves the signal was sent.

For SIGKILL cases assert 137 and check the filesystem afterwards; see the "T10" tests in
`plugins/yellow-core/tests/context-observer.bats`, and "R19" there for the `|| true` form this doc replaces.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`84692cd2-e8b5-46ff-9c63-485bc5e597c2` (priority 0.55, category preference).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
