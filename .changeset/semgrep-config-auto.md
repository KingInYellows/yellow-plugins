---
'yellow-semgrep': patch
---

Stop pairing `--config auto` with `--metrics off`, which current semgrep
refuses. `/semgrep:scan` and the post-fix `scan-verifier` now scan with the
`p/default` ruleset (override with `YELLOW_SEMGREP_CONFIG`); the verifier also
adds the target rule so it is always checked (CLAUDE-195).
