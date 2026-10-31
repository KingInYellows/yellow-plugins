# yellow-agy

Local supervised delegate on the Antigravity CLI (`agy`), running under the
owner's own Google AI Pro sign-in. It is the successor to yellow-jules, which
stops taking new sessions after 2026-11-11 when Google makes Jules read-only.

**Status: experimental scaffold.** This release ships `/agy:setup` only. The
delegate commands come with the adapter, built to
[`docs/yellow-agy/contract-v0.md`](../../docs/yellow-agy/contract-v0.md).

## Install

```text
/plugin install yellow-agy@yellow-plugins
```

## Prerequisites

- agy 1.4.11 or later, on `PATH` or inside a WSL distro on Windows
  (`YELLOW_AGY_WSL_DISTRO` picks the distro; the default distro otherwise)
- agy signed in once, interactively, with the Google account that holds the AI
  Pro plan
- None of `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`,
  `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` or `AGY_ADC_AUTH`
  set, in your shell or inside the WSL distro
- `"useG1Credits": false` in `~/.gemini/antigravity-cli/settings.json`, with
  `toolPermission` not set to `always-proceed` and `allowNonWorkspaceAccess` not
  `true`

## Commands

| Command      | What it does                                                          |
| ------------ | --------------------------------------------------------------------- |
| `/agy:setup` | Read-only check of agy location, version, auth variables and settings |

## Rules it keeps

- Subscription auth only: no API key, Vertex AI or AI-credit overages.
- The unmodified `agy` binary with its own sign-in. yellow-agy never reads,
  copies or proxies agy's credentials.
- No `--dangerously-skip-permissions`. Writes are allowed per run through
  `--settings` and `--mode accept-edits`.
- agy never pushes. Your stack provider opens the PR.
