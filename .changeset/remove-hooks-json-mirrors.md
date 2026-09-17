---
'yellow-ruvector': patch
'yellow-ci': patch
'yellow-morph': patch
'yellow-debt': patch
'gt-workflow': patch
'github-workflow': patch
---

Remove the `hooks/hooks.json` reference mirrors. Claude Code auto-discovers
that file and also loads the inline `hooks` block in `plugin.json`, so every
hook in these plugins was registered twice and startup printed
`hooks.json: unknown key "_comment" ignored`. The inline `plugin.json` block
(generated from `catalog/`) is now the only Claude-side hook source;
`hooks/codex-hooks.json` is unchanged. `pnpm validate:plugins` (RULE 7) now
errors on any `hooks/hooks.json`, with or without inline hooks.
