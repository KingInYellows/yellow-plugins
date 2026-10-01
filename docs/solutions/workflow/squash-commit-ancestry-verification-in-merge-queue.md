---
title: 'Squash-commit ancestry verification in merge-queue workflows'
date: 2026-09-29
category: workflow
track: knowledge
problem: 'Graphite merge-queue artifacts can diverge from reviewed PR content, causing content drift validation errors unless the squash commit is verified on origin/main first.'
tags: [graphite-workflow, merge-queue, git-verification]
source: compound-staging
---

# Squash-commit ancestry verification in merge-queue workflows

## Context

Graphite merge-queue artifacts can diverge from the reviewed PR content. When
you already know the PR number and its squash commit, check that the squash
commit reached `origin/main` before comparing content. Fetch first, or the
check runs against a stale ref:

```bash
git fetch origin main
git merge-base --is-ancestor "$SQUASH_SHA" origin/main \
  || echo "squash commit is not on origin/main: nothing landed"
```

This is corroborating evidence, not a standalone gate: it proves the commit
landed, not that its content matches the reviewed branch. Pair it with the
landed-content comparison in `docs/solutions/workflow/plan-lifecycle-management.md`
("Verifying an MQ merge when Gate C has nothing"). It is a manual recovery step;
`/plan:complete` Gate C does not run it.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`1c0b4660-3047-4907-8249-d56cc3832d29` (priority 0.55, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
