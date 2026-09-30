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

Squash-commit ancestry verification in merge-queue workflows. The gate-c-plan-lifecycle tool was fixed to require the squash commit to be on origin/main before comparing content, addressing cases where Graphite merge-queue artifacts diverge from reviewed PR content. Prevents content drift validation errors when queued PRs land on main.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`1c0b4660-3047-4907-8249-d56cc3832d29` (priority 0.55, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
