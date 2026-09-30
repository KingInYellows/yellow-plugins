---
title: 'Scripts/validate-provider-groups'
date: 2026-09-30
category: code-quality
track: knowledge
problem: 'validate-provider-groups.js checks each CONSUMER_SITES obligation independently, so a new provider must satisfy every applicable one.'
tags: [validation, test-patterns, provider-architecture]
source: compound-staging
---

# Scripts/validate-provider-groups

## Context

scripts/validate-provider-groups.js checks each CONSUMER_SITES obligation independently. A new provider with no CLI probe needs a NO_CLI_PROBE_PROVIDERS entry; one with a probe needs a <id>_cli_resolved printf in all.md. The override list must stay the first parenthetical in delegate.md's CONFLICT bullet.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`a4bc583f-a87e-464c-8e90-76629c1e94d9` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
