---
'gt-workflow': patch
'yellow-ci': patch
'yellow-composio': patch
'yellow-core': patch
'yellow-debt': patch
'yellow-morph': patch
'yellow-research': patch
'yellow-ruvector': patch
'yellow-semgrep': patch
---

Quote `${CLAUDE_PLUGIN_ROOT}` in every hook command. Claude Code runs
shell-form hook commands through `sh -c`, so an unquoted placeholder
word-splits when the plugin cache lives under a path with a space and the
hook fails open — a PreToolUse guard silently never runs. All commands now
use `bash "${CLAUDE_PLUGIN_ROOT}/…"` / `node "${CLAUDE_PLUGIN_ROOT}/…"`, as
the hooks reference recommends. `pnpm validate:plugins` (RULE 6) now warns
on an unquoted placeholder and applies its existence and containment checks
to `node` entrypoints as well as `bash` scripts.
