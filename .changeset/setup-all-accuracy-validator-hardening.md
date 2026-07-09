---
'yellow-core': patch
---

Fix `/setup:all` drift and harden its CI validator. Command fixes: remove the
orphaned `list_user_organizations` ToolSearch probe left by the yellow-chatprd
removal, add the missing yellow-council row to the illustrative dashboard
example, give yellow-devin a three-tier classification that detects
userConfig-stored credentials via `~/.claude/.credentials.json` (file-backed
installs such as Linux/WSL2; macOS keychain values remain undetectable by
file grep, where `/devin:setup` stays the authoritative check) and reports
PARTIAL with an explicit 401 warning instead of
a false NEEDS SETUP, surface yellow-debt's required yellow-core dependency and
yellow-ci's optional yellow-linear dependency, re-run the Step 1.6/1.7
credential-status and version-drift probes in the Step 5 before/after summary,
and halt classification when the plugin cache directory is missing instead of
misreporting every plugin as not installed. Validator hardening:
`validate-setup-all.js` now also checks the Step 1.5 probe list, the Step 1.6
credential-status plugin list (derived from hooks that actually emit
credential-status), and the dashboard example, reports `ERROR-SETUP-*` codes,
derives the command→plugin map from the markdown instead of a hand-duplicated
copy, and supports fixture path overrides with new integration test coverage.
