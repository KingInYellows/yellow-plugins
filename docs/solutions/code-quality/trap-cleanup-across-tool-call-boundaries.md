---
title: 'Trap Cleanup Must Live in the Call That Consumes the Temp Dir'
date: 2026-10-01
category: code-quality
track: knowledge
problem: A trap registered right after mktemp -d fires when that Bash call exits, deleting the dir before a separate Write call can stage into it
tags: [bash, trap, mktemp, write-tool, temp-files, command-authoring, plan-review, council]
components: [commands, skills, plugin-authoring]
---

## Context

Plan review of the council shell
`yellow-council-v2-four-cli-05-evidence-verification-and-finalization`
(PR #956, follow-up to PR #948) found a contradiction in its F2 guidance.
The plan said to stage the synthesized report with `Write` instead of a
heredoc, and also to register a `trap` for cleanup right after `mktemp -d`.

Those two instructions cannot both hold. Each Bash tool call is a fresh
subprocess, and `trap ... EXIT` fires when that subprocess exits. The block
that runs `mktemp -d` ends before the `Write` call starts, so the trap
deletes the directory first and `Write` stages into a path that is gone.

## Guidance

Keep the trap in the same Bash call as the code that consumes the directory,
and split the lifecycle across calls:

1. **Mint:** one Bash call runs `mktemp -d`, registers no trap, and prints the
   path.
2. **Stage:** `Write` puts the file in that directory.
3. **Consume:** a later Bash call re-validates the path, registers the
   `trap` that removes the directory on every exit of that call, then reads
   the file and does the remaining work.
4. **Abort cover:** if `Write` fails, or the orchestrator stays active after
   an abort between steps 1 and 3, it runs an explicit
   `rm -rf -- "<dir>"` block before stopping. No trap exists yet in that
   window, so this block is the only cleanup.
   If the user cancels the run in that window, the orchestrator gets no later
   tool call and this block never runs, so the directory is orphaned. Cover
   that residual with a stale-directory sweep at the start of a later run, as
   the council command's `council-synth-*` sweep does (reclaims directories
   older than a day).

Re-validate the path in step 3 before the trap or any `rm -rf` can act on
it. The value crossed a tool-call boundary as text, so check that it is
non-empty, is a directory you own and not a symlink, and is a direct child of the
expected temp root with the name the mint call chose. Reject any `..`. Run
every check before installing the trap: a trap installed on an unchecked
path deletes whatever directory that path names. A relayed literal is still
only text; see
[Shell-owned state is not a boundary against Write](../security-issues/shell-owned-state-is-not-a-boundary-against-write.md)
for what these checks do and do not guarantee.

## Why This Matters

A trap that fires early fails in a quiet way. The directory vanishes, `Write`
either errors or recreates a file in an unexpected place, and the cleanup
guarantee the trap was meant to give is lost. Putting the trap in the
consuming call ties cleanup to the call that actually holds the data.

## When to Apply

Use this whenever a command or skill creates a temp directory in one Bash
call and fills or reads it from another tool call, typically a `Write`
staging step. A single Bash block that does mint, use, and clean up can still
use the usual `mktemp -d` plus `trap` form.

## Examples

Wrong, in one block before a separate `Write`:

```bash
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf -- "$STAGE_DIR"' EXIT   # fires when this call exits, before Write
printf '%s\n' "$STAGE_DIR"
```

Right, as three steps:

```bash
# Call 1 -- mint only
TMP_ROOT="${TMPDIR:-/tmp}"; TMP_ROOT="${TMP_ROOT%/}"
STAGE_DIR="$(mktemp -d "$TMP_ROOT/stage.XXXXXX")" && printf '%s\n' "$STAGE_DIR"
```

```text
Write: <STAGE_DIR>/report.md   (literal path from call 1)
```

```bash
# Call 3 -- re-validate, trap, consume
TMP_ROOT="${TMPDIR:-/tmp}"; TMP_ROOT="${TMP_ROOT%/}"
STAGE_DIR="<literal path from call 1>"
[ -n "$STAGE_DIR" ] || exit 1
# Strip the root: an unchanged value is outside it, */* is nested, *..* is traversal.
case "${STAGE_DIR#"$TMP_ROOT"/}" in
  "$STAGE_DIR"|*/*|*..*) exit 1 ;;
  stage.?*) ;;
  *) exit 1 ;;
esac
[ -d "$STAGE_DIR" ] && [ ! -L "$STAGE_DIR" ] && [ -O "$STAGE_DIR" ] || exit 1
trap 'rm -rf -- "$STAGE_DIR"' EXIT
cat -- "$STAGE_DIR/report.md"
```

Related: [Bash block subshell isolation](bash-block-subshell-isolation-in-command-files.md),
[Bash-less agents need orchestrator-minted temp paths](bash-less-agent-write-tool-temp-path-minting.md).
