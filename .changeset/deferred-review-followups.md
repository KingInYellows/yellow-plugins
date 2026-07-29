---
"yellow-ruvector": patch
"yellow-semgrep": patch
"yellow-ci": patch
"yellow-mempalace": patch
"yellow-devin": patch
"yellow-debt": patch
"yellow-linear": patch
"yellow-core": patch
---

Correctness, contract-wording, and sweep-completeness follow-ups deferred
from the PR #666/#667 review loops

- yellow-ruvector: memory-manager queue rewrite retains entries whose
  processing failed (failed `file_change` re-index included), not only
  failed `hooks_remember` stores.
- yellow-semgrep: `/semgrep:fix` verify-outcome language aligned with
  scan-verifier's findings-at-modified-lines WARNING contract.
- yellow-ci: runner-diagnostics SSH rule now covers its own Step 3
  connectivity check ("Steps 3 and 4").
- yellow-mempalace: `/mempalace:kg` closet definition moved out of the
  render placeholder into prose.
- yellow-devin: devin-orchestrator documents the non-interactive default
  for the `max_acu_limit` question; devin-workflows tier table points at
  the in-file M3 definition.
- yellow-debt / yellow-linear: bare "(M3)" jargon rewritten to
  confirmation-gate plain language (same class as the PR #666 sweep).
- yellow-core: `/plan:complete` states rules inline instead of citing the
  maintainer-local MEMORY.md; the AskUserQuestion `Other`-label rule is
  standardized to one canonical phrasing across `decompose`,
  `expand-shell`, `spec`, and `work`, with expand-shell's `Other` option
  moved last to match its siblings.
