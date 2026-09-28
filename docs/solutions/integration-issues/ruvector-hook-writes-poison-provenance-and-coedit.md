---
title:
  'ruvector: hook-path CLI writes poisoned the store, and co-edit tracking never
  recorded anything'
date: 2026-09-26
category: integration-issues
track: bug
problem:
  'yellow-ruvector hooks called `hooks post-edit` / `hooks post-command`, which
  wrote near-empty hash-embedded memories (stamping fresh stores hash/64d,
  ADR-210) while their co-edit tracking silently recorded nothing; hook recall
  compared 64d queries against 384d vectors'
tags:
  - ruvector
  - hooks
  - embedding-provenance
  - adr-210
  - co-edit
  - multiedit
components:
  - plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh
  - plugins/yellow-ruvector/hooks/scripts/pre-tool-use.sh
  - plugins/yellow-ruvector/hooks/scripts/lib/coedit.sh
  - plugins/yellow-ruvector/hooks/scripts/session-start.sh
---

# ruvector: hook-path CLI writes poisoned the store, and co-edit tracking never recorded anything

## Symptoms

- `/ruvector:status` reports `PROVENANCE: MISMATCH` (store `hash`/64d, active
  `onnx-minilm`/384d) on a project that was only ever used through this plugin,
  and every `hooks_remember` is refused.
- `hooks_recall` from the SessionStart / UserPromptSubmit hooks prints "recall
  quality degraded" to stderr and returns arbitrary memories.
- The store fills with `"successful edit of ts in project"` and
  `"npm test succeeded"` memories.
- `hooks coedit-suggest` and the "Likely next files" part of `hooks pre-edit`
  never return anything, however many files are edited together.

## Root causes (verified against ruvector 0.2.34 and 0.3.3 source and live runs)

1. **Hook-path memory writes.** `hooks post-edit` and `hooks post-command` each
   call `Intelligence.tryRemember()` (`bin/cli.js` post-edit/post-command
   handlers). The hook-path CLI embeds with the hash embedder (64d). On a store
   with no provenance stamp, the first such write stamps it `hash`/64d; the MCP
   server (onnx-minilm, 384d) then refuses every write (ADR-210). On an already
   ONNX-stamped store the same writes are refused on every tool call. Measured
   with 10 edits + 10 commands on a fresh 0.3.3 store: 20 junk memories and a
   `hash` stamp.
2. **Co-edit tracking that cannot work across processes.** `hooks post-edit`
   only records a file sequence when `Intelligence.lastEditedFile` is set, but
   that field is initialized to `null` in the constructor and never persisted
   (`cli.js:3131`, `:3797`). Claude Code runs every hook as a new process, so
   `file_sequences` stays empty forever.
3. **The MCP server clobbers CLI writes.** `bin/mcp-server.js` loads
   `intelligence.json` once (`:223`) and writes its in-memory copy back on every
   save (`:418-430`, called from every `hooks_remember`), so anything a hook
   adds through the CLI between two MCP saves is lost — including
   `hooks coedit-record` output.
4. **Hash-embedded hook recall.** The hook-path `hooks recall` embedded the
   query with the hash embedder and compared it against 384d stored vectors on
   0.2.34 (near-random results). On 0.3.3 it switches to ONNX semantic recall,
   which takes 1.2–2.1s warm — longer than the 0.9s / 0.65s hook budgets, so a
   plain upgrade makes it time out instead.
5. **MultiEdit read from the wrong field.** The hooks read
   `tool_input.edits[].file_path`; Claude Code's MultiEdit carries one top-level
   `tool_input.file_path` and `edits[]` holds only `old_string`/`new_string`, so
   MultiEdit never matched.

## Fix

- PostToolUse no longer calls any ruvector CLI. It records co-edit pairs in a
  plugin-owned `.ruvector/coedit.json` with jq (`hooks/scripts/lib/coedit.sh`):
  per-session last-edit state (`coedit-sessions/<session_id>`), a 60s window,
  symmetric counts, temp-file + rename under a non-blocking mkdir lock, a cap of
  2000 directed entries (`COEDIT_MAX_PAIRS`; every pair is stored in both
  directions, so at most 1000 file pairs, fewer if the 80%-of-1 MB byte budget
  binds first), root-relative physical paths, and rejection of paths outside the
  root or with control characters. No plugin hook writes `intelligence.json` any
  more.
- PreToolUse surfaces up to 3 partners (count ≥ 3, still existing, once per file
  per session for its 200 most recently suggested files, 32 KB of paths) as
  fenced `hookSpecificOutput.additionalContext`. Partner names from
  `coedit.json` are project data, so each is re-validated (normalizes to itself,
  exists under the root) and keys with control characters are dropped inside jq
  — a multi-line key would otherwise split into a forged `count<TAB>path` line
  when read line by line.
- `/ruvector:related <file>` lists up to 50 partners by count (rarer pairs
  included); partners past the 50th are not shown.
- Recall happens once per session at SessionStart (semantic, 4.5s budget); the
  UserPromptSubmit hook is gone.
- MultiEdit is read from `tool_input.file_path`.

## Prevention

- Before delegating to an upstream CLI subcommand from a hook, check what it
  writes (memories, stamps) and whether its state survives one process per call
  — "the built-in exists" is not "the built-in works from a hook".
- Treat the MCP server as the only writer of `intelligence.json`; keep hook-side
  data in files the plugin owns.
- Re-validate anything read back from a project data file before it reaches
  model context, and filter control characters before splitting jq output on
  newlines or tabs.
- Use real Claude Code hook payloads in fixtures (MultiEdit's shape was wrong in
  both the scripts and the old tests).

## Upstream issue drafts (not yet filed)

**`hooks post-edit` never records file_sequences: `lastEditedFile` is not
persisted across CLI processes.** `Intelligence.lastEditedFile` lives only in
memory (`bin/cli.js` ~3131/3797). Tools that run each hook as a separate process
(Claude Code does) start every `post-edit` with `lastEditedFile = null`, so no
sequence is ever recorded and `coedit-suggest` / `pre-edit`'s "Likely next
files" stay empty. Reproduced on 0.2.34 and 0.3.3. Suggested fix: persist
`lastEditedFile` + a timestamp in the store or a sidecar, with a staleness
window.

**MCP server writes back its startup snapshot without re-reading, erasing CLI
writes.** `bin/mcp-server.js` loads `intelligence.json` once and every `save()`
writes the whole in-memory object (`atomicWriteFileSync`, 0.3.3). Any CLI write
between two MCP saves (`hooks coedit-record`, `post-edit`, `seed` flows) is
silently lost. Suggested fix: re-read and merge (or compare-and-swap on mtime)
before save.

## Related

- `docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`
- `docs/solutions/logic-errors/write-freeze-invariant-omits-passive-hook-path.md`
- `docs/solutions/code-quality/ruvector-hook-rewrite-builtin-cli-delegation.md`
- `plans/complete/yellow-ruvector-0-3-3-plugin-managed-install.md`
