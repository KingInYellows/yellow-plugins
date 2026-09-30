---
'yellow-core': patch
---

Document the `resolve_pr` keys `/review:resolve` now reads from
`yellow-plugins.local.md`: `cluster_cap`, `verify_command`,
`verify_timeout_seconds`, `repass_wait_seconds` and `resolve_human_threads`,
each with its default and invalid-value fallback. Unattended runs skip
`verify_command` when the config file is tracked by git.
