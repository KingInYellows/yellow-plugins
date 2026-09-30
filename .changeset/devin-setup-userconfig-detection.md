---
'yellow-devin': patch
---

fix(yellow-devin): `/devin:setup` detects userConfig credentials stored in the
credentials store (`.pluginSecrets`) and under `<name>@<marketplace>` plugin
ids, and no longer reports jq exit 4 (key absent) as a parse error.
