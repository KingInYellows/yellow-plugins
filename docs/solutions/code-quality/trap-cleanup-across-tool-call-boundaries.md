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
   an abort between steps 1 and 3, it runs an explicit removal block before
   stopping. No trap exists yet in that window, so this block is the only
   cleanup. It acts on the same relayed literal as step 3, so it runs the
   same re-validation first and refuses to delete on any mismatch.
   If the user cancels the run in that window, the orchestrator gets no later
   tool call and this block never runs, so the directory is orphaned. Cover
   that residual with a stale-directory sweep at the start of a later run, as
   the council command's `council-synth-*` sweep does (reclaims directories
   older than a day).

Re-validate the path in steps 3 and 4 before the trap or any `rm -rf` can act
on it. The value crossed a tool-call boundary as text, so check that it is
non-empty, is a directory you own and not a symlink, and is a direct child of the
expected temp root with the name the mint call chose. Reject any `..`. Run
every check before installing the trap or running the abort `rm -rf`: either
one on an unchecked path deletes whatever directory that path names. On any
failed check, exit without deleting and leave the stale-directory sweep to
reclaim the real directory. A relayed literal is still
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

Right, as three calls (plus an abort cover):

```bash
# Call 1 -- mint only
TMP_ROOT="${TMPDIR:-/tmp}"; TMP_ROOT="${TMP_ROOT%/}"
STAGE_DIR="$(mktemp -d "$TMP_ROOT/stage.XXXXXX")" || exit 1
STAGE_TOKEN="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
# Every failure after mkdtemp removes the directory: Call 3 never sees it.
case "$STAGE_TOKEN" in
  ????????????????????????????????) ;;
  *) rm -rf -- "$STAGE_DIR"; exit 1 ;;
esac
printf '%s' "$STAGE_TOKEN" > "$STAGE_DIR/.token" || { rm -rf -- "$STAGE_DIR"; exit 1; }
printf '%s\n%s\n' "$STAGE_DIR" "$STAGE_TOKEN"   # line 1: dir, line 2: token
```

```text
Write: <STAGE_DIR>/report.md   (literal path from call 1)
```

```bash
# Call 3 -- re-validate, trap, consume
TMP_ROOT="${TMPDIR:-/tmp}"; TMP_ROOT="${TMP_ROOT%/}"
STAGE_DIR="<literal path from call 1>"
STAGE_TOKEN="<literal token from call 1>"
[ -n "$STAGE_DIR" ] && [ -n "$STAGE_TOKEN" ] || exit 1
# Strip the root: an unchanged value is outside it, */* is nested, *..* is traversal.
case "${STAGE_DIR#"$TMP_ROOT"/}" in
  "$STAGE_DIR"|*/*|*..*) exit 1 ;;
  stage.?*) ;;
  *) exit 1 ;;
esac
[ -d "$STAGE_DIR" ] && [ ! -L "$STAGE_DIR" ] && [ -O "$STAGE_DIR" ] || exit 1
# Shape and ownership match any user-owned stage.* directory; the token binds to the minted one.
[ -f "$STAGE_DIR/.token" ] && [ ! -L "$STAGE_DIR/.token" ] || exit 1
[ "$(cat -- "$STAGE_DIR/.token")" = "$STAGE_TOKEN" ] || exit 1
trap 'rm -rf -- "$STAGE_DIR"' EXIT
cat -- "$STAGE_DIR/report.md"
```

The name and ownership checks alone accept any user-owned `stage.*` direct
child, so a relayed literal swapped for an existing one would have the trap
delete it. The `.token` comparison refuses that swap: the consuming call
deletes only a directory that holds the token call 1 printed. It does not stop
a model that deliberately writes a matching directory and token, because
`Write` and Bash reach the same paths. See
[Shell-owned state is not a boundary against Write](../security-issues/shell-owned-state-is-not-a-boundary-against-write.md)
for that residual.

```bash
# Call 4 -- abort cover, only when Write failed or the run is stopping
TMP_ROOT="${TMPDIR:-/tmp}"; TMP_ROOT="${TMP_ROOT%/}"
STAGE_DIR="<literal path from call 1>"
STAGE_TOKEN="<literal token from call 1>"
[ -n "$STAGE_DIR" ] && [ -n "$STAGE_TOKEN" ] || exit 1
case "${STAGE_DIR#"$TMP_ROOT"/}" in
  "$STAGE_DIR"|*/*|*..*) exit 1 ;;
  stage.?*) ;;
  *) exit 1 ;;
esac
[ -d "$STAGE_DIR" ] && [ ! -L "$STAGE_DIR" ] && [ -O "$STAGE_DIR" ] || exit 1
[ -f "$STAGE_DIR/.token" ] && [ ! -L "$STAGE_DIR/.token" ] || exit 1
[ "$(cat -- "$STAGE_DIR/.token")" = "$STAGE_TOKEN" ] || exit 1
rm -rf -- "$STAGE_DIR"
```

Related: [Bash block subshell isolation](bash-block-subshell-isolation-in-command-files.md),
[Bash-less agents need orchestrator-minted temp paths](bash-less-agent-write-tool-temp-path-minting.md).
