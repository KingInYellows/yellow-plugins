---
'yellow-research': patch
---

fix(yellow-research): `/research:setup` now finds userConfig API keys in the
credentials store (`.pluginSecrets` in `~/.claude/.credentials.json` on Linux)
and matches plugin ids of the form `<name>@yellow-plugins`, instead of only
checking `settings.json` and reporting configured keys as NOT SET. jq exit 4
(no output) now counts as "absent" rather than a parse error. The SessionStart
credential-status hook now locates yellow-core in the installed plugin cache
(`cache/<marketplace>/<plugin>/<version>/`), so `credential-status.json` is
actually written for `/setup:all`.
