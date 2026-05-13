---
'yellow-plugins-root': patch
---

feat(validate-plugin): warn on credential userConfig interpolation without shell-env fallback

Adds RULE 12 to `scripts/validate-plugin.js` (warning, non-blocking) that flags
`mcpServers.<server>.env.<KEY>: "${user_config.X}"` patterns lacking a
companion `${KEY:-}` shell-env-passthrough entry. The diagnostic recommends
the 3-element wrapper pattern (yellow-research/yellow-morph precedent) so
power users on multi-host fleets can resolve credentials from shell env
without per-host userConfig prompts.

Detection: iterates each mcpServers entry's env block, matches
`${user_config.<field>}`, skips entries with the conventional `_USERCONFIG`
suffix (which signals the plugin already uses the wrapper pattern), and
warns when no companion fallback is found.

This is a warning, not an error — existing plugins that don't follow the
pattern continue to pass validation. New plugins authors see the
recommendation surfaced at validation time.
