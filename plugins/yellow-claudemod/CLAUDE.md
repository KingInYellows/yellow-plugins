# yellow-claudemod Plugin

A Claude Code mod: `hooks/hooks.json` is a lone
`{ "modules": ["./register.ts"] }`, the one shape `validate-plugin.js` RULE 7
allows (`scripts/lib/mod-hooks.js`). Never add command hooks to that file;
command hooks belong in `catalog/plugins/yellow-claudemod.json#hooks`.

## Layout

- `hooks/register.ts` — the hooks module: `session.start` (registers
  `/claudemod-status`, reads usage), `session.measure` (caches rate-limit
  windows), `agent.spawn` (downshift + ledger row), `command.run`.
- `hooks/policy.ts` — pure decisions (`downshiftModel`, the `DOWNSHIFT_AGENTS`
  allowlist, ledger helpers, status text).
- `tests/register.test.ts` — `claude plugin test` suite.
- `commands/claudemod/setup.md` — version check for `/setup:all`.

## Rules

- The allowlist must match `docs/research/model-routing-policy.md`: no security,
  code-writing fixer or Haiku moves without a Phase 2 replay. Adding an Opus
  agent elsewhere does not add it here.
- `agent.spawn` must stay fail-open: its `.catch` replays `next(e)`, so a bug
  runs the agent on its own model. Never return `{ deny }` from it.
- `agent.spawn`'s `e.model` is the caller's parameter, undefined for a
  frontmatter-pinned agent. Leave a defined `e.model` alone.
- Ledger writes go through the `writes` promise chain; parallel fan-outs
  otherwise lose rows. Never cut a step short: a store call cannot be
  cancelled, so a skipped-past step could land a stale row list late. Hooks
  wait on the chain through `bounded` (2 s) instead, and once a wait times
  out, spawns stop waiting until the chain settles. Write failures are kept
  per ledger key and shown only to that session.
- Rows go under `ledger:<session id>`; `$.store` is machine-wide and the chain
  only serializes one session. `$.session.id()` is read per write because
  `/clear` changes it without a new `session.start`. Read the legacy `ledger`
  key; never write it.

## Checks

```bash
claude plugin validate plugins/yellow-claudemod
claude plugin test plugins/yellow-claudemod
```

Neither runs in CI yet (CI has no `claude` binary); run both before pushing a
change to `hooks/`. The API types come from the `plugin-authoring` skill's
`types/claude-code.d.ts`; type-check with a tsconfig outside this folder that
includes that file plus `hooks/` and `tests/`.
