# Probe: Antigravity CLI (`agy`) adapter questions

**Date:** 2026-11-02 · **Binary:** agy 1.4.12 in WSL Ubuntu-24.04 on the owner's
Windows host · **Context:** answers the open questions in
`docs/yellow-agy/contract-v0.md` before the adapter's lifecycle lands. Follows
`antigravity-cli-delegate-2026-10.md`.

Ran on the owner's machine through Remote Control, in the throwaway repo at WSL
`~/projects/agy-spike`. It used 12 model prompts (the AI Pro bucket went from
99% to 96%). Raw evidence stays on the owner's machine
(`agy-spike/FINDINGS-2026-11.md`). The global settings file was restored to its
pre-probe hash afterwards.

## Answers

- **MCP can't be turned off per run.** `--settings` rejects the MCP keys as
  unknown, no flag exists, and `/mcp` fails in print mode. `agy mcp list` works.
  The only switch is the global `agy mcp disable <name>`, so `setup` refuses
  with `AGY_MCP` while any server is enabled.
- **A normal finish omits `finished_reason`.** The top-level keys are
  `conversation_id`, `status`, `response`, `duration_seconds`, `num_turns` and
  `usage`. A blocked tool still gives exit 0 and `SUCCESS`, adds
  `denied_actions`, and usually leaves `response` empty.
- **`--settings` overlays per top-level key.** A key the run gives replaces the
  global key wholesale; a key it leaves out leaks through (a global `agentMode`
  did). The adapter pins `toolPermission`, `permissions`, `agentMode`,
  `allowNonWorkspaceAccess`, `enableTerminalSandbox` and `useG1Credits`.
- **`toolPermission`** accepts `always-proceed`, `request-review` (the default),
  `strict` and `proceed-in-sandbox`. None hangs headless: a call the profile
  doesn't allow is soft-denied at once.
- **`agentMode`** accepts `accept-edits`, `plan`, `auto` and `""`; `"default"`
  is rejected. A per-run `""` overrides a global `accept-edits`, and `--mode`
  beats both.
- **Command matching:** `command(git diff)` matches extra arguments. A chained
  `git add … && git commit …` passed with both parts granted. No `regex:` rule
  was needed. Not probed: denial of a chain with an ungranted part, and whether
  `$(…)`, backticks or redirects in trailing arguments run through a shell.
- **`--input-format stream-json`** exists: one message per stdin line, and it
  needs `--output-format stream-json`. v0 stays one process per turn.
- **`/usage` works in print mode** without a model call and returns
  machine-readable remaining fractions per model bucket.

## Still open

- **`--sandbox` under WSL2.** bwrap runs, but the probe had no allow rule for
  the command it used, so the result is inconclusive. A rerun needs two prompts
  with `command(head)` allowed. Until then the implement profile allows no test
  or lint commands.

## Useful tricks

- `agy -p /usage --log-file <path>` logs the effective permissions and mode
  without calling the model, which lets `setup` check a profile for free.
- `--settings` is validated before anything runs, so a bad key fails fast.
- An unknown slash command is sent to the model as a prompt and costs quota.
  Probes must use the same env scrub and `useG1Credits: false` as real runs.
