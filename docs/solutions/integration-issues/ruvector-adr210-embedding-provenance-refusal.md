---
title: 'ruvector: hooks_remember refused by ADR-210 provenance check while hooks_recall keeps working'
date: 2026-09-17
category: integration-issues
track: bug
problem: 'A .ruvector store stamped by the old hash embedder (64d) silently refuses every hooks_remember once ruvector 0.2.34 defaults to onnx-minilm (384d); reads still succeed so the write loss goes unnoticed'
tags:
  - ruvector
  - embedding-provenance
  - adr-210
  - hooks_remember
  - reembed
  - session-start
components:
  - plugins/yellow-ruvector/hooks/scripts/session-start.sh
  - plugins/yellow-ruvector/commands/ruvector/status.md
  - plugins/yellow-ruvector/commands/ruvector/seed-solutions.md
  - plugins/yellow-ruvector/skills/memory-query/SKILL.md
---

# ruvector: `hooks_remember` refused by ADR-210 provenance check while `hooks_recall` keeps working

## Symptom

Every `mcp__plugin_yellow-ruvector_ruvector__hooks_remember` call fails with a
provenance refusal — upstream's `ProvenanceMismatchError`, paraphrased:
"Embedding-provenance mismatch (ADR-210): refusing vector write … store
records `{ embedder=hash, dim=64, … }` but the active embedder is
`{ embedder=onnx-minilm, dim=384, … }` (differs on: …)" — while
`hooks_recall`, the SessionStart learnings
injection, and `/ruvector:memory` all keep returning results. Nothing in the
session says memory writes stopped landing; the `/flow:work` Phase 4
learning-record step degrades silently ("skip silently if unavailable").

Store stamp, seen with `jq '.embeddingProvenance' .ruvector/intelligence.json`:

```json
{ "embedderKind": "hash", "modelId": null, "dimension": 64, "normalize": true, "prefixPolicy": "none" }
```

## Why reads still work

ADR-210 gates **writes** on a full stamp match — `compareProvenance` diffs
`embedderKind`, `modelId`, `dimension`, `normalize` and `prefixPolicy`, and
`assertProvenanceMatch` refuses on any difference — so a store never holds
vectors from two embedders. Two adjacent states matter: a store with
vectors but no stamp at all (pre-provenance) is refused with
`ERR_LEGACY_STORE_READONLY`; a stamp-less store with no vectors is fresh and
the first write stamps it.
Reads are not gated: a query is embedded with the active embedder and
compared against whatever vectors are stored. With a hash-stamped store and
an ONNX query the similarity scores are near zero rather than an error, so
recall returns low-quality results instead of failing — the only visible
signal is the write refusal, and only if something reports it.

The store got here because the default embedder switched from hash to
onnx-minilm in 0.2.34 (ADR-210 "default-on semantic embeddings"); a store
created earlier keeps its hash stamp until reembedded.

## Remediation

1. Quiesce writes — finish or abandon any ruvector-writing command in the
   session (`/ruvector:seed-solutions`, `/ruvector:learn`).
2. Reembed with the pinned CLI (the same version the MCP server runs):

   ```bash
   npx -y --ignore-scripts ruvector@0.2.34 hooks reembed --dry-run   # expect wouldDrop: 0
   npx -y --ignore-scripts ruvector@0.2.34 hooks reembed             # ~1 min / 750 vectors, 6 workers
   ```

   The dry-run's `wouldReembed` is the store's re-embeddable vector count
   (`memories.length - missing` in `bin/cli.js`), not a pending count — it
   reads the same before and after a completed reembed. The stamp is written
   only after every vector succeeds, so an interrupted run leaves the old
   stamp and still reports as a mismatch.
3. **Restart Claude Code.** The running MCP server initialised from the
   pre-reembed file and holds that snapshot in memory; its next save would
   overwrite the reembedded store with hash vectors (the same-run clobber
   `seed-solutions.md` Step 2 / Step 5.2 describe). Do not call
   `hooks_remember` in the session that ran the reembed.
4. In the fresh session: `hooks_remember` a test line, `hooks_recall` it,
   and run `/ruvector:status` — expect `PROVENANCE: OK`.

## Detection now shipped

- `session-start.sh` appends one line to the SessionStart `systemMessage`
  when the store stamp is `hash` and neither `RUVECTOR_EMBEDDER=hash` nor
  `RUVECTOR_ONNX=0` is set (jq only; inside the 3 s budget; silent for an
  unstamped fresh/legacy store).
- `/ruvector:status` Step 6 computes the verdict in its bash block: `FRESH`
  (no file, or no stamp and no vectors), `UNSTAMPED` (vectors, no stamp),
  `OK` / `MISMATCH` (equality of the five enforced stamp fields —
  `embedderKind`, `modelId`, `dimension`, `normalize`, `prefixPolicy` —
  against the dry-run's `targetProvenance`, both sides projected so an
  informational extra key is ignored and a missing enforced field whose
  projected value differs from the other side is a mismatch (missing vs
  explicit `null` on optional fields such as `modelId` compares equal,
  matching upstream `(a.modelId ?? null)`), naming the differing fields),
  or `UNKNOWN` (the store
  file is not parseable by `jq`; no GNU-compatible `timeout`/`gtimeout` is on
  PATH, so the dry-run is skipped; the dry-run failed, timed out, or was
  SIGKILLed — exit 137 may be the 5 s `--kill-after` grace or an external
  signal such as the OOM killer, so the detail names both; the dry-run
  carried no object `targetProvenance` at all; or the five-field compare
  itself failed in jq, which must not read as "no differing fields" — the
  CLI's `error`/`hint` come as a stdout JSON line, not stderr) — and prints
  the remediation above. A corrupted store therefore reports the same
  `UNKNOWN` verdict as a CLI/model timeout; check the detail text rather than
  assuming a timeout. Detection covers only `$PROJECT_DIR/.ruvector`; a
  nested-launch session or a server that cached the machine-global
  `~/.ruvector` during the heal window is not seen by the hook.

## Non-atomic store write race

**Symptom.** `PROVENANCE:` flips from `OK` to `MISMATCH` (store `hash`/64d
against an `onnx-minilm`/384d target) on a store that was healthy shortly
before, and `.ruvector/intelligence.json.corrupt-<epoch>` appears next to
a much smaller `intelligence.json`. Trigger shape (observed 2026-09-17):
several subagents running in parallel, each firing yellow-ruvector's
PostToolUse hooks (which shell out to the `ruvector` CLI), while the MCP
server was saving a multi-MB store.

**Cause.** Upstream, not the plugin. ruvector 0.2.34 (the version every
hook pins) saves `intelligence.json` with a plain `fs.writeFileSync` in
both processes that write it — `bin/mcp-server.js:320` and
`bin/cli.js:3220` (`Intelligence.save()`; line numbers verified against the
installed `ruvector@0.2.34` package) — so a concurrent reader can observe a
torn, half-written file. A CLI process on the hook path that reads mid-write
judges the file corrupt, renames it aside as `.corrupt-<epoch>` (the
quarantine-on-corrupt read, `readIntelStoreSafe`, ships in ruvector ≥
0.2.41's `cli.js`; 0.2.34's own `load()` returns an empty store instead) and
starts a fresh store — hash-stamped, 64d, because the hook path resolved the
hash embedder. The MCP server still holds the good snapshot in memory, so
recall keeps answering from it until the server restarts. ruvector 0.2.41
and 0.3.1 fix the CLI side (`atomicWriteFileSync`: temp file in the same
directory + `rename()`, `cli.js:3282` / `:3331`) but `bin/mcp-server.js`
still writes plainly at line 396 in both, and its `load()` still degrades a
parse failure to an empty store — so the race remains reachable from the
server's save.

**Recovery.** The quarantined file is usually complete (it parses and holds
every memory). Stop the MCP server, move the fresh hash-stamped
`intelligence.json` aside (`intelligence.json.hash-fresh-<epoch>`), copy the
`.corrupt-<epoch>` file back over `intelligence.json`, restart, and confirm
with `/ruvector:status` — do not reembed; that would rebuild the small
fresh store, not restore the lost one.

**Avoidance.** Do not run many hook-firing subagents in parallel while the
MCP server has unsaved writes (a burst of `hooks_remember` calls followed
immediately by a parallel resolver fan-out is the exact shape). Keep the
`.corrupt-*` file until `/ruvector:status` reports `OK` on the restored
store. A `rename()`-based write alone would not fully close the window — a
reader that opened the file before the rename still reads the old inode,
and `npm/write-file-atomic#64` documents the same partial-protection
caveat — so the upstream fix also needs a parse-retry (or quarantine that
never overwrites) on the reader side.

**Upstream.** Filed as [RuVector#995](https://github.com/ruvnet/RuVector/issues/995)
(follow-up to #634 / #698, which fixed `cli.js` only).

## Related

- `plugins/yellow-ruvector/skills/memory-query/SKILL.md` "Retrieval floor"
  section — mixed provenance degrades recall to near zero (the read-side
  symptom of the same stamp mismatch).
- `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md` Step 6
  (post-seed reembed) and Step 5.2 (`STATUS: NEEDS_FRESH_SESSION` — why a
  reembed must be followed by a restart).
- Upstream: https://github.com/ruvnet/RuVector/blob/main/docs/adr/ADR-210-default-on-semantic-embeddings-minilm.md
