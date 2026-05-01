---
"yellow-debt": patch
---

Bash hardening in `audit-synthesizer.md` Step 7 slug derivation:

- Consolidated jq `@sh` call now derives `$id`, `$severity`,
  `$content_hash`, and `$finding` in one invocation with explicit
  exit-code checking (`|| exit 1`). The previous prose assumed
  `$id`/`$severity`/`$content_hash` were set by the surrounding loop,
  but each Bash code block runs in a fresh subprocess — those variables
  did not survive. Per the canonical anti-pattern in
  `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  (yq/jq exit code lost when assigning subshell output).
- SHA256 fallback now uses a portable helper that prefers `sha256sum`
  (Linux/WSL2) and falls back to `shasum -a 256` (macOS). The previous
  hard-coded `sha256sum` produced an empty fallback hash on macOS,
  yielding malformed todo filenames like `001-pending-high--<content_hash>.md`.
