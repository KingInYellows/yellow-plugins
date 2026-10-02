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
`docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`
and the remediation block of `plugins/yellow-ruvector/commands/ruvector/status.md`):

1. Quiesce writes. Finish or abandon any ruvector-writing command in the session.
2. Run the plugin-pinned wrapper with `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ruvector-cli.sh" hooks reembed --dry-run`. If `wouldDrop` is nonzero, confirm with the user before accepting the loss of those memories (`--drop-missing` discards them).
3. Confirm with the user before the real reembed, whatever `wouldDrop` is: an agent asks via `AskUserQuestion`, because the reembed rewrites `.ruvector/intelligence.json`. Settle everything below before running the command:
   - If `wouldDrop` is nonzero, tell the user the dropped memories are lost irreversibly.
   - Create a backup first: `cp .ruvector/intelligence.json ".ruvector/intelligence.json.bak-$(date +%Y%m%d-%H%M%S)"`.
   - The user's answer decides whether `--drop-missing` is added. Without it, reembed refuses to proceed when `wouldDrop` is nonzero.

   Then run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/ruvector-cli.sh" hooks reembed`,
   adding `--drop-missing` only after the user confirmed the drop.
4. Restart Claude Code before any further write. The running MCP server holds
   the pre-reembed snapshot, and its next save would overwrite the reembedded
   store.
5. In the fresh session, run `/ruvector:status` and expect `PROVENANCE: OK`.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`394983d5-0363-4094-8dcd-635002066498` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
