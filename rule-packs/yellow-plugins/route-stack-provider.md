---
title: Route branch and PR work through the enabled stack provider
applies_when:
  - A command, agent or skill creates, pushes, restacks, submits or merges a
    branch or PR
  - New prose tells Claude to run gt, gh pr create, gh stack or git push
tags: [stack, graphite, github, workflow]
---

In provider-neutral orchestration, never hardcode Graphite (`gt`) or
GitHub-native stacks (`gh stack`). Run `/stack:status` first and route through
the enabled provider's own commands only on `READY_GRAPHITE` or `READY_GITHUB`.
Every other state stops with the classifier's detail. Never fall back to raw
`git push` or `gh pr create`.

`plugins/yellow-core/lib/stack-operation-registry.js` maps operations to
providers. A provider's own implementation commands (in `gt-workflow` or
`github-workflow`) name that provider's CLI by design and are exempt.
