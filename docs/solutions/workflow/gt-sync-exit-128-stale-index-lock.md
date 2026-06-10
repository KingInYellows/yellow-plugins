---
title: 'When `gt sync` Fails With Exit Code 128 on `git reset -q --keep <sha>`'
date: 2026-06-10
category: workflow
track: knowledge
problem: '`gt sync` exits 128 due to a stale `.git/index.lock` file from a previously crashed git operation.'
tags: [git, graphite, gt-sync, index-lock, stale-lock]
source: compound-staging
---

# When `gt sync` Fails With Exit Code 128 on `git reset -q --keep <sha>`

## Context

When `gt sync` fails with exit code 128 on `git reset -q --keep <sha>`, the cause is a stale `.git/index.lock` file left by a crashed prior git operation. Safe resolution: (1) confirm no live git/gt process is running via `ps aux | grep -E '[g]it|[g]t'`; (2) verify lock file is 0-byte and old (`ls -la .git/index.lock`); (3) remove it: `rm .git/index.lock`. Then re-run `gt sync`.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`a7a74daa-312f-4b17-8197-b8a6941e248f` (priority 0.65, category fact).

See `plans/background-compounding-triggers.md` for the pipeline architecture.
