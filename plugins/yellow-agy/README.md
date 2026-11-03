# yellow-agy

Local supervised delegate on the Antigravity CLI (`agy`), running under the
owner's own Google AI Pro sign-in. It is the successor to yellow-jules, which
stops taking new sessions after 2026-11-11 when Google makes Jules read-only.

**Status: experimental.** Built to
[`docs/yellow-agy/contract-v0.md`](../../docs/yellow-agy/contract-v0.md). Every
run is file edits only until agy's `--sandbox` is verified on a host.

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
- No enabled MCP servers (`agy mcp list`; `agy mcp disable <name>`)
- `"useG1Credits": false` in `~/.gemini/antigravity-cli/settings.json`, with
  `toolPermission` not set to `always-proceed`, `allowNonWorkspaceAccess` not
  `true`, and no `agentMode` that auto-approves edits (such as `accept-edits`)

## Commands

| Command          | What it does                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `/agy:setup`     | Checks agy's location, version, auth variables, settings and MCP servers, then records the host |
| `/agy:authorize` | Lists or revokes grants; prints the terminal command that creates one                           |
| `/agy:delegate`  | New branch and worktree, then a read-only plan turn                                             |
| `/agy:approve`   | Implements the stored plan (file edits only)                                                    |
| `/agy:reply`     | Follow-up turn; `--correction` asks for a new plan                                              |
| `/agy:status`    | Tasks, plans and any live run, from the local journal                                           |
| `/agy:collect`   | Writes the work as patches and scans them for secret-shaped content                             |
| `/agy:abandon`   | Prints the terminal command that collects, removes the worktree, keeps the branch               |

A grant is the owner's written permission: repo, branch pattern, operations, the
AI Pro quota floor, task and correction limits, and an expiry. Only the owner
creates one, by typing a code shown in their own terminal; abandon is confirmed
the same way.

## Rules it keeps

- Subscription auth only: no API key, Vertex AI or AI-credit overages.
- The unmodified `agy` binary with its own sign-in. yellow-agy never reads,
  copies or proxies agy's credentials.
- No `--dangerously-skip-permissions`. Writes are allowed per run through
  `--settings` and `--mode accept-edits`.
- agy never pushes. Your stack provider opens the PR.
