---
title: 'Move multi-step shell out of agent prose into library functions'
date: 2026-10-02
category: code-quality
track: knowledge
problem: 'About 100 lines of shell in agent markdown were untestable except by fenced-block ordinal and hid stale-file and CI-skip gaps'
tags: [agent-authoring, bash, bats, handoff-file, ci-skip, yellow-debt]
components:
  [
    plugins/yellow-debt/agents/synthesis/audit-synthesizer.md,
    plugins/yellow-debt/lib/validate.sh,
    plugins/yellow-debt/tests/security.bats,
  ]
---

## Context

The yellow-debt `audit-synthesizer` agent carried about 100 lines of matching
shell inline. Tests could only reach it by extracting the Nth fenced block,
so inserting a block silently re-pointed the tests. Review (7 reviewers) also
found three smaller gaps that the inline layout encouraged.

## Guidance

- **Put logic in `lib/*.sh` functions; keep the prose to one call.** The agent
  block sources the library in a `bash` child and calls
  `debt_match_kept_todos`, `debt_pending_todos`, `debt_next_todo_id`. Bats
  tests call the functions directly. Never test by block ordinal.
- **Clear an index-keyed handoff file before the block that writes it.**
  `.debt/fingerprints.json` is read by finding index. If the writer exits
  early, the agent reads the previous audit's file and applies it to the wrong
  findings. Remove the file first (`rm -f`), check the write, and tell the
  agent to stop on a non-zero exit.
- **A required CI step fails, not skips.** `security.bats` skipped when
  kislyuk `yq` or `zsh` was missing, so coverage could vanish in CI. Skip
  only when `CI` is unset; when set, `fail`. See
  `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`.
- **Check that a defense-in-depth block loads what it checks with.** The Step 7
  name check used `$DEBT_TODO_NAME_RE` in a block that never sourced
  `validate.sh`; the unset variable made the regex empty, which matches
  everything, so the check always passed. Run it in a bash child that sources
  the library and call `debt_todo_name_ok`. Recurrence of
  `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`.

## Why This Matters

Prose shell is read and edited by agents and reviewers who cannot run it.
Each gap above passed silently: a stale file looked valid, a skipped test
looked green, an empty regex looked like a pass.

## When to Apply

Any agent or command that holds more than a few lines of branching shell, any
file handed between blocks by index or name, and any check labelled
"required" in CI.

## Examples

```bash
# synthesizer block: one call, library does the work
bash /dev/fd/3 3<<'EOS'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
debt_match_kept_todos || exit 1
EOS
```
```bash
# bats: fail in CI, skip locally
command -v zsh >/dev/null 2>&1 && return 0
[ -z "${CI:-}" ] || { echo "zsh is required in CI"; return 1; }
skip "zsh not installed"
```
