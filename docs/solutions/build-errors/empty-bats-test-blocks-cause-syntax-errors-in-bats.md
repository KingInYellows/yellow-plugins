---
title: 'Empty bats test blocks cause syntax errors in bats 1.11.0'
date: 2026-10-05
category: build-errors
track: knowledge
problem: 'An empty bats test block left behind by a commit broke the suite under CI''s bats 1.11.0 with a syntax error.'
tags: [bats, testing, syntax-error, ci-fix, yellow-review]
components: [yellow-review]
source: compound-staging
---

# Empty bats test blocks cause syntax errors in bats 1.11.0

## Context

Empty bats test blocks cause syntax errors in bats 1.11.0. If a test definition contains only `{ }` with no body, bats 1.11.0 rejects it; remove the empty test or populate it with assertions. Verify by running the full suite.

Observed case: `plugins/yellow-review/tests/skill-content.bats` had an empty test left behind by a resolve-contract commit. It broke under CI's bats 1.11.0; deleting it restored the full suite (1020/1020).

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`45b80bad-9769-493c-9893-eed703ac97cd` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
