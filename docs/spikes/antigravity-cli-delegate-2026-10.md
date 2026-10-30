# Spike: Antigravity CLI (`agy`) as a local delegate executor

**Date:** 2026-10-30 · **Binary:** agy ≥ 1.4.11 in WSL Ubuntu-24.04 on the
owner's Windows host · **Context:** Jules is read-only after 2026-11-11 and
shuts down 2026-12-31. This spike checks whether `agy` headless can be the
executor behind a yellow-jules successor while staying on the owner's Google AI
Pro sign-in (no API key, no overages). It follows up on
`antigravity-cli-headless-2026-08.md` (agy 1.0.2), several of whose findings are
now out of date.

Ran on the owner's machine through Remote Control. agy is installed in **WSL
Ubuntu-24.04 only**, not on Windows. It used 10 model prompts plus 6 slash
commands that don't touch quota. The raw per-run evidence stays on the owner's
machine (`agy-spike/FINDINGS.md` and `evidence/`). The throwaway repo lived at
WSL `~/projects/agy-spike`, because agy only trusts paths under the WSL home
directory.

**Verdict: go.** The adapter runs agy inside WSL.

## Confirmed

- `--settings '{...}'` applies to one run and is never saved. An allowlist of
  only `command(git)` let `git` through and soft-denied `npm`, and the global
  settings hash didn't change. This replaces any edit to the global file.
- `--json-schema` returns a valid plan in `structured_output` with no edits.
- `--conversation <id>` resumes the same id, and edits stay in the worktree.
- Writes outside the workspace (`../escape.txt`, `/tmp`) are denied or never
  run.
- SIGTERM to the process group gives `finished_reason: "interrupted"`, partial
  text and exit 1, with no orphan processes.
- Overages were off throughout: global `useG1Credits: false` and `/credits`
  at 0. The spike also forced `useG1Credits: false` on every run.
- Quota: a plan plus implement pair used about 1.2% of the weekly Gemini 4 Argon
  bucket. `/usage` updates late.
- The settings file was restored and its hash matches . The worktree and branch
  were removed.

## Traps the adapter must handle

1. Headless workspace edits are **soft-denied unless `--mode accept-edits`** is
   set, even though the docs say they're auto-allowed.
2. A `--print-timeout` run returns `status: SUCCESS` and exit 0. Classify it
   with the undocumented `finished_reason: "print_timeout"`, which comes with
   partial output and zeroed usage.
3. A soft-denial leaves `response` empty. Read the undocumented `denied_actions`
   array.
4. It never returned `WAITING`. An ambiguous prompt just acted and got denied,
   so the adapter can't rely on it asking questions.
5. A resumed turn repeats the previous turn's `structured_output`. Ignore it
   unless that turn passed `--json-schema`.
6. Every run starts the user's MCP servers, including an unpinned
   `npx githits@latest`. That costs 10+ s before the first token and is a
   supply-chain exposure.
7. There's no machine-readable auth mode and no `whoami`. Setup has to check env
   vars, `useG1Credits: false` and `/credits`, and confirm with the user once.

## Still open (probe in the adapter PR)

- Does `--sandbox` do anything under WSL2? No shell command ran in the test.
- Can `--settings` turn off MCP servers for one run?
- What does `finished_reason` say on a normal completion?
- Can `--input-format stream-json` run multiple turns in one process?
