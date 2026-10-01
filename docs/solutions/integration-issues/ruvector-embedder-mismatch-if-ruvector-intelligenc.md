---
title: 'Ruvector Embedder Mismatch'
date: 2026-09-29
category: integration-issues
track: knowledge
problem: 'A hash-stamped (64d) .ruvector store with an onnx-minilm (384d) MCP embedder refuses hooks_remember writes while reads keep returning low-quality results.'
tags: [ruvector, embedder-mismatch, vector-store, workflow]
components: [yellow-ruvector]
source: compound-staging
---

# Ruvector Embedder Mismatch

## Context

If `.ruvector/intelligence.json` is stamped with the 64-dim hash embedder but the MCP server runs 384-dim onnx-minilm, every `hooks_remember` write is refused (ADR-210 provenance check). Reads still succeed: `hooks_recall` returns near-zero-similarity, low-quality results rather than failing, so the write loss is easy to miss.

Remedy, in order (full detail in
`ruvector-adr210-embedding-provenance-refusal.md`):

1. Quiesce writes. Finish or abandon any ruvector-writing command in the session.
2. Run the plugin-pinned wrapper with `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ruvector-cli.sh" hooks reembed --dry-run`. If `wouldDrop` is nonzero, confirm with the user before accepting the loss of those memories (`--drop-missing` discards them).
3. Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ruvector-cli.sh" hooks reembed` (verified once: 388 memories re-embedded to 384-dim). If `wouldDrop` was nonzero and the user confirmed the loss, add `--drop-missing`; without it reembed refuses to proceed.
4. Restart Claude Code before any further write. The running MCP server holds the pre-reembed snapshot, and its next save would overwrite the reembedded store.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`394983d5-0363-4094-8dcd-635002066498` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
