---
title: 'Plugins/yellow-review/lib/resolve-text.sh conflict'
date: 2026-10-03
category: workflow
track: knowledge
problem: 'Concurrent PRs #950 and #952 conflicted in plugins/yellow-review/lib/resolve-text.sh and had to be reconciled without dropping either change.'
tags: [merge-conflict-resolution, multi-pr-reconciliation, resolve-text-shell, tested-fix]
components: [yellow-review]
source: compound-staging
---

# Plugins/yellow-review/lib/resolve-text.sh conflict

## Context

Note: `resolve-text.sh` comes from PR #950 (unmerged); it does not exist on
`main` at the time of writing, so the path below is not yet locatable there.

plugins/yellow-review/lib/resolve-text.sh conflict reconciliation: merge concurrent PRs by preserving both the full END block logic (blockend, mqend cleanup from #950) and the strict-mode file argument (from #952). Resolution verified through 253 local tests and 848-test full suite pass (0 failures); all validators passing.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`89e56957-0558-415c-b2de-3ca2048fddae` (priority 0.95, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
