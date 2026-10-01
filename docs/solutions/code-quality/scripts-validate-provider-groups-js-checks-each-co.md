---
title: 'Adding a provider: validate-provider-groups.js consumer-site obligations'
date: 2026-09-30
category: code-quality
track: knowledge
problem: 'validate-provider-groups.js checks each CONSUMER_SITES obligation independently, so a new provider must satisfy every applicable one.'
tags: [validation, test-patterns, provider-architecture]
components: [yellow-core, yellow-linear]
source: compound-staging
---

# Adding a provider: validate-provider-groups.js consumer-site obligations

## Context

`scripts/validate-provider-groups.js` checks each `CONSUMER_SITES` obligation
independently, so passing one site says nothing about the others. A new
provider must satisfy every obligation that applies to its group.

## Guidance

- A provider with no CLI probe needs a `NO_CLI_PROBE_PROVIDERS` entry.
- A provider with a CLI probe needs a `<id>_cli_resolved` printf in executable
  code (not a comment) inside the `setup-all-remote-agent-tooling` marker slice
  of `plugins/yellow-core/commands/setup/all.md`.
- Keep the override list as the first parenthetical of the CONFLICT bullet in
  `plugins/yellow-linear/commands/linear/delegate.md`; the check reads it by
  position.

## When to Apply

Adding a provider to a `capabilityProvider` group. The consumer-site checks
currently cover the `remote-agent` group.
Run `pnpm validate:provider-groups` after the change.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`a4bc583f-a87e-464c-8e90-76629c1e94d9` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
