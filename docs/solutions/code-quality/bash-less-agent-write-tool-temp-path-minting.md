---
title: 'Bash-less Write-Only Agents Need Orchestrator-Minted Temp Paths'
date: 2026-08-10
category: code-quality
track: knowledge
problem: Write-only agent with no Bash can't mint a unique temp path; orchestrator mints via mktemp -u instead
tags: [agent-authoring, tool-surface, mktemp, temp-files, subagent-design, council, spawn-prompt]
components: [agents, plugin-authoring, tool-surface]
---

## Context

Every existing council reviewer agent (`gemini-reviewer.md`, `opencode-reviewer.md`,
`codex-reviewer.md`) is a CLI-wrapper: it shells out to an external LLM CLI via
its own `Bash` tool, and mints its fenced-output path itself, e.g.
(`gemini-reviewer.md:418`):

```bash
FENCED_OUTPUT_FILE=$(mktemp /tmp/council-gemini-fenced-XXXXXX.txt)
```

This works because the same agent that runs `mktemp` also does the writing —
plain `mktemp` (no `-u`) creates the file immediately as part of generating
the name, and the agent's own subsequent write to that just-created file is
fine.

Planning `yellow-council-v2-four-cli-02-claude-reviewer-fanout` (adding a 4th,
in-process `claude-reviewer` with tool surface `[Read, Grep, Glob, Write]` —
no `Bash`, per spec R5) surfaced a gap with no repo precedent: a Bash-less
agent has no entropy source of its own, so it cannot mint a unique
temp path. Two approaches that seem obvious both fail:

- **Hardcoded path** (e.g. `/tmp/council-claude-fenced.txt`): works the first
  time the path is used, but fails on any later invocation where the file
  already exists — including a later invocation in a *different* session,
  since files under `/tmp` persist across sessions and only get cleared on
  reboot/tmpwatch. Claude Code's `Write` tool errors out ("This tool will
  fail if you did not read the file first") when asked to overwrite a file
  it hasn't previously `Read` — it's an explicit failure, not a silent
  no-op, but it still blocks the agent's only output write.
- **Plain `mktemp` handed to the agent**: the agent has no Bash to call
  `mktemp` from in the first place. Even setting that aside, plain `mktemp`
  *creates* the file as a side effect of generating the name — handing that
  already-existing path to a Write-only agent reintroduces the exact same
  "no overwrite without prior Read" failure, since the agent never `Read` a
  file it didn't create.

## Guidance

Move path minting to whichever side of the spawn boundary actually has
`Bash` — the orchestrator/parent command, not the agent:

1. Orchestrator mints the path with `mktemp -u <template>-XXXXXX` (the `-u`
   flag generates only the unique filename; it does **not** create the file):
   ```bash
   CLAUDE_FENCED_FILE=$(mktemp -u /tmp/council-claude-fenced-XXXXXX.txt)
   ```
2. Do NOT persist that value to the orchestrator's state file — if the same
   block that parses reviewer returns later truncates that file (e.g.
   `: > "$STATE_FILE"`), anything written beforehand is lost. Rely on the
   reviewer echoing the path back in its own return contract instead (e.g.
   `fenced_output_path=`), with independent cleanup for a malformed or
   missing return.
3. Pass the literal, already-resolved path as plain text inside the
   subagent's Task spawn prompt — reuse the same channel the rest of the
   review pack/diff context already travels over; no new plumbing needed.
4. The subagent's single `Write` call targets exactly that received path.
   Because nothing exists there yet, this is a create, not an overwrite, so
   the Write tool's "must Read before overwrite" rule doesn't fire.

Note `mktemp -u` is documented as the *unsafe* mode: it does not create (and
therefore does not reserve) the name, so there is a theoretical TOCTOU window
before the subagent's `Write` call. That's acceptable here — the path is
generated and consumed once, immediately, by a single spawned agent in the
same command invocation, not held open or shared across processes. It is
unique by construction (mktemp's randomization), not reserved by creation;
say so explicitly rather than calling it "collision-safe" without
qualification.

This keeps the new agent within its minimal declared tool surface
(`[Read, Grep, Glob, Write]`, no `Bash` added just to solve a plumbing
problem) and reuses an existing capability (orchestrator already has Bash and
already mints every other reviewer's path) instead of inventing a new one.

A related, secondary gap in the same porting exercise: CLI-wrapper reviewer
templates carry *mechanical* safeguards that only work because they run
inside Bash — e.g. an awk PEM-redaction state machine, sed literal-delimiter
escaping (see
[awk PEM state machine mutation](../security-issues/awk-pem-state-machine-variable-mutation.md)
and
[sandwich fence delimiter forgery](../security-issues/sandwich-fence-delimiter-forgery.md)).
Porting a reviewer template to a Bash-less in-process agent means those
safeguards cannot execute — they must become prompt-level self-discipline
rules, and the agent's own doc should say so explicitly ("these are prose
rules, not mechanics") rather than silently carrying over awk-block comments
that will never run. Stating the weaker guarantee honestly is itself part of
the fix, not an afterthought.

## Why This Matters

Silently reusing a CLI-wrapper agent's temp-file pattern for a Bash-less
agent produces a bug that a single-invocation smoke test won't catch — it
only manifests on a *later* invocation, and "later" can mean a different
session: `/tmp` files persist across sessions, so the failure surfaces
whenever the same path is reused with an existing file at it, not only
within one session. The first write "succeeds" regardless, because the file
doesn't exist yet either way — so the bug ships clean and only shows up on
reuse.

## When to Apply

Any time a new Claude Code plugin agent is granted `Write` for a single,
must-be-unique output file but is deliberately denied `Bash` (e.g. an
in-process reviewer/analysis agent, as opposed to a CLI-wrapper agent). Check
for this shape specifically:

- Agent's `tools:` frontmatter includes `Write`, omits `Bash`.
- Agent must produce exactly one file per invocation, and the same agent may
  be invoked more than once in a session.
- A sibling/template agent in the same family has `Bash` and mints its own
  path with `mktemp` — that pattern will NOT transfer as-is.

Verification: a test/validation pass must invoke the new agent **at least
twice against the same orchestrator run's path-minting logic** (a repeat
invocation, whether same session or a later one where a stale `/tmp` file
lingers) to actually exercise the "Write refuses to overwrite an unread
file" failure mode — a single-invocation smoke test cannot detect this gap.

## Examples

Anti-pattern (do not do this for a Bash-less agent):
```bash
# Hardcoded — write fails on any invocation that reuses this path
OUTPUT_FILE="/tmp/council-claude-fenced.txt"

# Plain mktemp handed to a Bash-less agent — creates the file immediately,
# so the agent's own Write call becomes a blocked overwrite
OUTPUT_FILE=$(mktemp /tmp/council-claude-fenced-XXXXXX.txt)
```

Correct pattern — orchestrator (has Bash) mints, subagent (no Bash) creates:
```bash
# In the orchestrator, before spawning the Bash-less subagent:
CLAUDE_FENCED_FILE=$(mktemp -u /tmp/council-claude-fenced-XXXXXX.txt)
# persist to state, then pass the literal value in the Task spawn prompt
```

Source: `plans/yellow-council-v2-four-cli-02-claude-reviewer-fanout.md`
lines 57-68 ("Temp-path hazard") and line 160 (Step 5); sibling precedent at
`plugins/yellow-council/agents/review/gemini-reviewer.md:418` and
`plugins/yellow-council/agents/review/opencode-reviewer.md:426`. This is a
planning-phase finding — `claude-reviewer.md` had not yet been implemented
at time of writing; see the plan file's checklist for current status.
