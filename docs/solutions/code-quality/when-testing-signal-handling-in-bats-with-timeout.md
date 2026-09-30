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

When testing signal handling in bats with timeout, the timeout tool exits 124 after successfully sending a signal (e.g., -s TERM). Use `cmd || true` after piped timeout invocations to avoid test failures in bats, since the signal delivery is the intended outcome, not an error.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`84692cd2-e8b5-46ff-9c63-485bc5e597c2` (priority 0.55, category preference).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
