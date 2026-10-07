# Waves 1–2 contracts

Wave 1 selects yellow-core existing worktree list behavior, exposed as
worktree-inventory. Input: current local Git checkout. Tools: Git and read-only
file tools; no auth. Output: status plus path, branch/detached, bare, locked and
prunable flags per worktree; dirty state unknown. Use native Git list; no
manager import, config writes, environment copying, create/switch/remove or
provider operation. Non-Git and missing Git are blocked. Mutation-capable stack
operations remain excluded and require current provider resolution.

Wave 2 selects yellow-docs documentation audit. Input: current Git checkout and
a focus question. Scope remains the current checkout, without arbitrary path or
revision operands. Tools: read-only Git/file reads/search. Output: bounded
P1/P2/P3 findings, evidence, measured coverage or unknown, health score and
three proposed actions. No auth, siblings, writes or generation. Codex follows
the audit sequentially without Claude agent dispatch. Unsupported: non-Git and
unavailable reads. History absence means unknown staleness. Existing conventions
are bundled in a flat reference.

## Final installed acceptance

The candidate gates passed before target enablement. Final generated-marketplace
receipts: developer-docs-final.json. All declared cases passed on Codex 0.157.0.
The integrated report distinguishes native operations, live DeepWiki responses
and fixtures; owner authentication metadata and tested project/plugin hashes
remain unchanged. Final support is limited to the selected allowlists.
