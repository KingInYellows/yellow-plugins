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

Squash-commit ancestry verification in merge-queue workflows. Graphite merge-queue artifacts can diverge from reviewed PR content, so confirm the squash commit is on origin/main before comparing content. This is a manual recovery step, not something `/plan:complete` Gate C enforces: run `git merge-base --is-ancestor "$SQUASH_SHA" origin/main` yourself, as shown in `docs/solutions/workflow/plan-lifecycle-management.md`. Skipping it risks content drift validation errors when queued PRs land on main.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`1c0b4660-3047-4907-8249-d56cc3832d29` (priority 0.55, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
