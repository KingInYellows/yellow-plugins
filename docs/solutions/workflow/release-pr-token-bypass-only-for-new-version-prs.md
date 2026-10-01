---
title: 'RELEASE_PR_TOKEN only bypasses approval for version PRs'
date: 2026-09-29
category: workflow
track: knowledge
problem: 'A version PR already open when RELEASE_PR_TOKEN is added stays subject to external-contributor approval.'
tags: [release-workflow, release-pr-token, changesets, github-actions]
source: compound-staging
---

# RELEASE_PR_TOKEN only bypasses approval for version PRs

## Context

RELEASE_PR_TOKEN only bypasses approval for version PRs opened after token configuration. If a bot-authored version PR is already open when you add the token, Changesets updates that PR rather than creating a new one, leaving it subject to external-contributor approval. Remediation: close the existing PR and delete its branch so the next main push recreates it under the token.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`22ab16b0-d066-46f3-9c4a-92e07fee4bbb` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
