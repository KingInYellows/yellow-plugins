---
title: 'Cross-host hook envelope: one dependency-free Node runtime for Claude Code and Codex'
date: 2026-07-23
category: integration-issues
track: knowledge
problem: 'A plugin hook must run identically on Claude Code and Codex without a bash dependency, cross-plugin imports, or divergent per-host scripts'
tags:
  - codex
  - cross-host
  - hooks
  - node-runtime
  - session-start
  - envelope
  - fail-open
components:
  - plugins/yellow-ci/hooks/scripts/lib/envelope.js
  - plugins/yellow-ci/hooks/scripts/lib/run-hook.js
  - plugins/yellow-ci/hooks/scripts/lib/session-start-core.js
  - plugins/gt-workflow/hooks/scripts/lib/run-hook.js
---

# Cross-host hook envelope: one dependency-free Node runtime for Claude Code and Codex

> **Canonical distribution doc:** see [Codex Distribution](../../codex-distribution.md)
> for the overall neutral-catalog model this fits into.

## Problem

A plugin hook is authored once but must fire on two hosts (Claude Code and
Codex) with byte/semantic-identical decisions. Bash hooks don't run on Windows,
can't be unit-tested cleanly, and duplicate logic per host. The generated Codex
manifest carries the same hook, so the runtime must be host-agnostic — while
R34 forbids cross-plugin (sibling-path) imports in anything Codex-exposed, so the
pattern is **replicated per plugin**, not shared via a package.

## The shape

Four small modules per plugin under `hooks/scripts/`:

- `lib/envelope.js` — `snakeToCamelEnvelope` (both hosts' hook **input** is
  snake_case: `hook_event_name`, `tool_name`, `tool_input`, `tool_response`) plus
  the host-specific **output** formatter(s).
- `lib/<policy-or-core>.js` — the actual decision/IO logic, host-agnostic.
- `lib/run-hook.js` — the shared flow: bounded stdin read → parse → normalize →
  dispatch → `formatOutput`.
- `entrypoint-claude.js` / `entrypoint-codex.js` — thin (~15 line) wrappers that
  call `runHook` with the matching formatter.

### Input is the same; output differs only where the event differs

Hook **input** is snake_case on **both** hosts, so `snakeToCamelEnvelope` runs on
both legs. Output diverges only for blocking events:

- **PreToolUse deny** — Claude exits `2` with a plain-text stderr message (no
  JSON at all); Codex emits
  `{"hookSpecificOutput": {"permissionDecision": "deny", ...}}`. These are
  categorically different mechanisms, not just different field names.
- **SessionStart** — identical on both hosts: `{"continue": true}`, optionally
  with a `systemMessage`. So a single `formatSessionStartOutput` serves both
  entrypoints (yellow-ci's case).

### Fail-open vs fail-closed is preserved per hook

`run-hook.js` preserves each hook's original degrade direction on a bad payload:

- **64KB stdin bound** (`MAX_STDIN_BYTES`) — a verbose tool_result must not make
  the hook buffer unbounded input or blow its timeout. For a *blocking* hook,
  truncation is treated **fail-closed** (deny) so a large payload can't slip a
  `git push` past the blocker by truncating into a parse failure.
- **`JSON.parse('null')` guard** — `JSON.parse('null')` succeeds and
  `typeof null === 'object'`, so a bare `null` (or any non-object) payload is
  guarded *explicitly* before it reaches a policy function — otherwise it crashes
  on `envelope.command` / `envelope.toolInput` (a real review-caught regression).
- **SessionStart is fail-open**: it must ALWAYS emit valid JSON and never block
  startup (mirrors the bash hook's `set -uo pipefail` + guaranteed `json_exit`).
  Any error is swallowed into an empty-message result so the caller still emits
  `{"continue": true}`; the entrypoint's last-resort `.catch` does the same. The
  SessionStart logic reads `cwd` / `$HOME` / `gh`, not the envelope, so a
  malformed envelope does not change behavior.

## The host-neutral-skill-body vs non-linted-hook-layer split

This runtime is also where the R31↔R15 tension is resolved. The exposure lint
(`validate-codex.js`) scans only the generated **manifest + `codex/skills/**`**,
never `hooks/scripts/*.js`, `hooks/scripts/lib/*.sh`, or command wrappers. So:

- **Codex-exposed skill bodies** are host-neutral: no `.claude/`, no
  `${CLAUDE_PLUGIN_ROOT}`/`CLAUDE_PLUGIN_DATA`, no `$ARGUMENTS`/`subagent_type`.
- **All host-specific behavior lives in this hook/lib/wrapper layer**, which is
  never linted. Example (R38): the SessionStart cache is written to
  `${CLAUDE_PLUGIN_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/yellow-ci}` with a
  read-only fallback to the legacy `${HOME}/.cache/yellow-ci` — the
  `CLAUDE_PLUGIN_DATA` reference is fine here (Codex even sets it for plugin-hook
  compat) but would be lint-fatal in a skill body.

## Testing: a before/after golden parity gate

Because the port must reproduce the deleted bash hook exactly, capture goldens
from the ORIGINAL bash hook first (before deleting it), then diff the Node port's
output against them:

- yellow-ci's SessionStart is IO-driven, so a "fixture" is a named **environment
  scenario** (cwd, routing cache, gh mock, result cache) in a shared
  `tests/lib/hook-scenario.bash`, not a stdin payload — the `.stdin` envelope is
  constant and unused by the logic.
- STDOUT is compared JSON-semantically (`jq -S -c`) — the bash hook emitted jq's
  pretty JSON, the Node port emits compact JSON; the decision must match, not the
  bytes. STDERR and exit code are compared exactly.
- Both entrypoints are checked; for SessionStart they must be byte-identical.

**Caveat — the golden proves parity, not correctness.** A golden captured from a
buggy bash hook freezes the bug. Pair parity fixtures with at least one
first-principles regression fixture (e.g. the `null`-envelope crash) whose
expected output is derived from the contract, not from the old script.

## Caveat: inert on Codex today

Plugin-shipped hooks do not currently fire on Codex — `codex features list` shows
`plugin_hooks` as `removed` (0.144.1 and 0.144.6). The generated
`codex-hooks.json` (with its `commandWindows` twin) is schema/unit/parity-tested
but not live end-to-end verifiable on Codex right now. Do not gate delivery on
live Codex hook firing.
