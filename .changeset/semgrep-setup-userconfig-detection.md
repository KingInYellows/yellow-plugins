---
'yellow-semgrep': patch
---

fix(yellow-semgrep): `/semgrep:setup` detects a userConfig
`semgrep_app_token` stored in the credentials store (`.pluginSecrets`) and
under `<name>@<marketplace>` plugin ids, and no longer reports jq exit 4 (key
absent) as a parse error. The SessionStart credential-status hook now locates
yellow-core in the installed plugin cache, so `credential-status.json` is
written for `/setup:all`.
