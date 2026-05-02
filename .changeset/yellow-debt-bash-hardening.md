---
"yellow-debt": patch
---

Bash hardening in `audit-synthesizer.md` Step 7 slug derivation:

- Consolidated jq `@sh` call now derives `$id`, `$severity`,
  `$content_hash`, and `$finding` in one invocation, capturing output
  to a variable before `eval` so the exit code is observable and
  checkable. The previous prose assumed `$id`/`$severity`/`$content_hash`
  were set by the surrounding loop, but each Bash code block runs in a
  fresh subprocess — those variables did not survive. This aligns the
  handoff with the guidance in
  `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  about avoiding yq/jq handoffs that depend on command-substitution
  state or exit-status behavior.
- SHA256 fallback now uses a portable helper that prefers `sha256sum`
  (Linux/WSL2) and falls back to `shasum -a 256` (macOS). The previous
  hard-coded `sha256sum` produced an empty fallback hash on macOS,
  yielding malformed todo filenames like `001-pending-high--<content_hash>.md`.
