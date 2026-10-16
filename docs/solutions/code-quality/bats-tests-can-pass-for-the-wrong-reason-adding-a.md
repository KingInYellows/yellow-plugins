---
title: 'Bats tests can pass for the wrong reason'
date: 2026-10-14
category: code-quality
track: knowledge
problem: 'A bats test can keep passing after a new required flag diverts it onto a usage-error path it was never meant to reach.'
tags: [bats, testing, yellow-review, stacked-prs]
components: [yellow-review]
source: compound-staging
---

# Bats tests can pass for the wrong reason

## Context

bats tests can pass for the wrong reason. Adding a required flag (--ignored-since) to run-verify-command.bats made bare --revert-denied calls hit the new usage error and still pass. Verify each test reaches its intended path. A fixed 2s sleep in the credential-on-disk test also failed on the remote PR tip, so check the remote before blaming your commit.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`93619395-9e75-47ca-a284-258645abbf2a` (priority 0.55, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
