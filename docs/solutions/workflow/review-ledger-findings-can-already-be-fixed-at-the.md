---
title: 'Review-ledger findings can already be fixed at the current'
date: 2026-10-14
category: workflow
track: knowledge
problem: 'Review-ledger findings can already be fixed at the current head, so triage must verify against the tree before acting.'
tags: [review-ledger, triage, worktree-restack, bats]
source: compound-staging
---

# Review-ledger findings can already be fixed at the current

## Context

Review-ledger findings can already be fixed at the current head. In PR #1080, cards 1, 15 and 21 were dismissed with evidence after checking worktree-restack.sh cmd_abort against named bats cases. Confirm the pinning test exists before dismissing, and re-run the suite on the committed tree first.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`6401b8c8-03bf-423a-a3e5-81d4258d52d9` (priority 0.55, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
