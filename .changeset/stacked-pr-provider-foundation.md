---
'github-workflow': minor
'yellow-core': minor
---

Establish the stacked-PR provider foundation so a repository can eventually
choose exactly one provider — Graphite (`gt-workflow`) or GitHub native
stacks (`github-workflow`) — with no silent fallback between them.

**yellow-core** gains the provider-neutral surface:

- `/stack:status` — classifies provider state as `UNSELECTED`,
  `READY_GRAPHITE`, `READY_GITHUB`, `CONFLICT`, `CONFIG_MISMATCH`,
  `MANAGED_CONFLICT`, or `PARTIAL_TOOLING`. Read-only.
- `/stack:select` — switches the active provider through
  `claude plugin install|enable|disable` after showing the exact commands,
  refuses managed-scope conflicts, never edits settings JSON, and directs
  the user to `/reload-plugins`.
- `stack-provider-router` and `stack-provider-guard` skills.
- `lib/stack-provider-state.js` — the single owner of the seven states and
  of switch planning, covered by deterministic fixture tests.
- `/setup:all` now documents alternative provider groups and offers setup
  for the enabled provider only, so no user is asked to configure both.

**github-workflow** is a new provider skeleton: `/github-stack:setup` and
`/github-stack:status` verify `gh`, authentication, and that the installed
`gh stack` extension is the official `github/gh-stack` (three third-party
lookalikes expose the same command name). No MCP server, no hooks, and no
`gh stack` operation is invoked.

Foundation only — stack creation, submission, amendment, synchronisation,
cleanup, and merging are not implemented, `flow:work` is unchanged, and the
repository's Graphite workflow is untouched. See
`plans/stacked-pr-provider-abstraction.md` and
`docs/research/2026-08-16-github-native-stacks-vs-graphite.md`.
