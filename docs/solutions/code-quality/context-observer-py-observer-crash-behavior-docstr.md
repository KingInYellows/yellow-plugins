---
title: 'Context-observer'
date: 2026-09-30
category: code-quality
track: knowledge
problem: 'context-observer.py docstring incorrectly claimed broken observers cannot blank the statusline.'
tags: [yellow-core, error-handling, observer, documentation]
components: [yellow-core]
source: compound-staging
---

# Context-observer

## Context

context-observer.py observer crash behavior: docstring incorrectly claimed broken observers cannot blank statusline. An observer crashing before reading input (e.g. a syntax error) leaves statusline empty. The cat fallback only covers a missing python3 or an unreadable observer file, not execution errors. Corrected docstring and changeset.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`9387e4c1-8943-48e7-941f-afb1ab71923b` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
