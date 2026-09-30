---
title: 'Ruvector Embedder Mismatch'
date: 2026-09-29
category: integration-issues
track: knowledge
problem: 'Ruvector searches return nothing when the store embedder dimension differs from the MCP embedder dimension.'
tags: [ruvector, embedder-mismatch, vector-store, workflow]
components: [yellow-ruvector]
source: compound-staging
---

# Ruvector Embedder Mismatch

## Context

Ruvector embedder mismatch: if .ruvector/intelligence.json is stamped with a 64-dim hash embedder but MCP runs 384-dim onnx-minilm, searches find nothing. Run `hooks reembed` (verified: 388 memories re-embedded to 384-dim). yellow-ruvector bash blocks fail in zsh, the Bash tool's shell; write to a script and run `bash <script>`.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`394983d5-0363-4094-8dcd-635002066498` (priority 0.85, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
