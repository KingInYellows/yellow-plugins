---
'yellow-devin': patch
---

fix(yellow-devin): `/devin:setup` detects userConfig credentials stored in the
credentials store (`.pluginSecrets`) and under `<name>@yellow-plugins` plugin
ids, and no longer reports jq exit 4 (key absent) as a parse error. Steps 3-4
now skip the curl probes when either credential is missing from the shell,
instead of sending an empty token or org ID.
