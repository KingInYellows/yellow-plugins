# yellow-agy

Successor to yellow-jules: one coding task handed to the Antigravity CLI (`agy`)
on the owner's machine, in an isolated git worktree, under the owner's Google AI
Pro sign-in.

## Status

Experimental scaffold. Only `commands/agy/setup.md` exists. The TypeScript CLI
(adapter, worktree module, and the grant/authority core ported from
yellow-jules) lands next, built to `docs/yellow-agy/contract-v0.md`. Evidence
for every flag the contract uses is in
`docs/spikes/antigravity-cli-delegate-2026-10.md`.

## Conventions

- Subscription auth only. Never suggest an API key, Vertex/ADC, or AI-credit
  overages, and never read or copy files under `~/.gemini/` other than
  `antigravity-cli/settings.json`, which setup only reads.
- The WSL bridge is exec-only: `wsl.exe [-d <distro>] -e …`, never the `--`
  form, which re-parses arguments in the distro's shell.
- Setup never runs a model turn. Quota is the owner's weekly AI Pro bucket.
- Error codes use the `AGY_*` prefix and env vars the `YELLOW_AGY_*` prefix
  (contract-v0 "Output envelope" lists them).
