---
title: 'ruvector: hooks_remember refused by ADR-210 provenance check while hooks_recall keeps working'
date: 2026-09-16
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
  `OK` / `MISMATCH` (whole-stamp equality against the dry-run's
  `targetProvenance`, naming the differing fields), or `UNKNOWN` (dry-run
  failed or timed out — the CLI's `error`/`hint` come as a stdout JSON
  line, not stderr) — and prints the remediation above. Detection covers
  only `$PROJECT_DIR/.ruvector`; a nested-launch session or a server that
  cached the machine-global `~/.ruvector` during the heal window is not
  seen by the hook.

## Related

- `plugins/yellow-ruvector/skills/memory-query/SKILL.md` "Retrieval floor"
  section — mixed provenance degrades recall to near zero (the read-side
  symptom of the same stamp mismatch).
- `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md` Step 6
  (post-seed reembed) and Step 5.2 (`STATUS: NEEDS_FRESH_SESSION` — why a
  reembed must be followed by a restart).
- Upstream: https://github.com/ruvnet/RuVector/blob/main/docs/adr/ADR-210-default-on-semantic-embeddings-minilm.md
