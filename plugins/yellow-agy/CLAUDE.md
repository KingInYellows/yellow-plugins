# yellow-agy

Successor to yellow-jules: one coding task handed to the Antigravity CLI (`agy`)
on the owner's machine, in an isolated git worktree, under the owner's Google AI
Pro sign-in.

## Status

Experimental. `commands/agy/setup.md` is the only command. The TypeScript
adapter is landing in stages against `docs/yellow-agy/contract-v0.md`; the
evidence for every flag it uses is in
`docs/spikes/antigravity-cli-delegate-2026-10.md`.

## Architecture

```text
plugins/yellow-agy/
  src/
    invocation.ts   # the only place an agy argv/env is built: env scrub, hooks off, WSL bridge
    profiles.ts     # --settings profiles (read-only, implement) and per-turn argv
    classify.ts     # result classification; an absent finished_reason is a normal finish
    errors.ts       # AGY_* catalog with exit codes and recovery actions
  dist/             # committed compiled CJS; drift-checked in CI
  tests/            # vitest, no agy binary needed
```

## Conventions

- Subscription auth only. Never suggest an API key, Vertex/ADC, or AI-credit
  overages, and never read or copy files under `~/.gemini/` other than
  `antigravity-cli/settings.json`, which setup only reads.
- The WSL bridge is exec-only: `wsl.exe [-d <distro>] -e …`, never the `--`
  form, which re-parses arguments in the distro's shell.
- Setup never runs a model turn. Quota is the owner's weekly AI Pro bucket.
- Error codes use the `AGY_*` prefix and env vars the `YELLOW_AGY_*` prefix
  (contract-v0 "Output envelope" lists them).
