---
title: 'userConfig `required: true` fires at MCP startup, not install'
category: build-errors
track: bug
problem: 'userConfig `required: true` does not block plugin install — error surfaces at MCP startup via variable substitution, leaving users with no actionable feedback'
date: 2026-05-13
tags:
  - userConfig
  - MCP
  - plugin-install
  - claude-code-bugs
---

# `required: true` on userConfig fields does NOT block plugin install

## TL;DR

Setting `userConfig.<field>.required: true` in `plugin.json` does NOT block
plugin install when the user dismisses the prompt. The value only surfaces
as an error at MCP-server startup time (variable substitution), producing
a confusing "Missing required user configuration value" message that
suggests pre-validation should have caught it.

Reference: [anthropics/claude-code#39827](https://github.com/anthropics/claude-code/issues/39827)
(open as of 2026-05-13).

## Symptoms

- Plugin installs and shows as "enabled" in `claude plugin list --json`.
- The bundled MCP server fails to start.
- `claude doctor` reports: `Missing required user configuration value:
  <field>. This should have been validated before variable substitution.`
- Tools provided by the bundled MCP are invisible to the current session.
- On platforms where the initial enable-prompt doesn't fire at all
  (see [#39455](https://github.com/anthropics/claude-code/issues/39455)),
  users see this with NO way to know what to enter.

## Why It Happens

Per the [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference)
schema, `required: true` is documented as "validation fails when the field
is empty." In practice the validation does not run at install time — it
runs at MCP startup, when Claude Code substitutes `${user_config.<field>}`
into the `env`, `args`, `url`, or `headers` blocks. If the value is empty,
the substitution engine refuses, the MCP fails to start, and the user is
left with no actionable error.

## How to Avoid It

**Do not use `required: true` for credential fields on graceful-degradation
plugins.** Instead:

1. Mark the field as optional (omit `required`).
2. Use the 3-element fallback wrapper pattern
   (yellow-research/yellow-morph precedent) — see
   `plugins/yellow-core/skills/multi-host-fleet/SKILL.md`:
   ```json
   {
     "env": {
       "FOO_API_KEY_USERCONFIG": "${user_config.foo_api_key}",
       "FOO_API_KEY": "${FOO_API_KEY:-}"
     }
   }
   ```
   And a wrapper script in `bin/start-foo.sh`:
   ```bash
   if [ -n "${FOO_API_KEY_USERCONFIG:-}" ]; then
     export FOO_API_KEY="$FOO_API_KEY_USERCONFIG"
   fi
   unset FOO_API_KEY_USERCONFIG
   [ -z "${FOO_API_KEY:-}" ] && unset FOO_API_KEY
   exec foo-mcp-server "$@"
   ```
3. If you need to BLOCK MCP startup when both userConfig and shell env are
   empty (the yellow-composio case, to prevent `claude doctor` cascade
   failure), do that in the wrapper script with an explicit non-zero exit:
   ```bash
   [ -z "${FOO_API_KEY:-}" ] && {
     printf '[start-foo] Error: FOO_API_KEY is not set. The bundled MCP will not start; other MCPs are unaffected.\n' >&2
     exit 1
   }
   ```
   This is the actual safeguard — `required: true` cannot perform it.

## Detection in the Marketplace

The `validate-plugin.js` script (RULE 12, added in v1.16.0) emits a warning
on any `${user_config.X}` interpolation in `mcpServers.<server>.env` that
lacks a companion `${X:-}` shell-env-passthrough entry. Plugins that follow
the wrapper pattern pass cleanly; plugins that interpolate userConfig
directly trigger the warning at validation time.

## Related Bugs

- [#39827](https://github.com/anthropics/claude-code/issues/39827) —
  `required: true` validates at substitution time
- [#39455](https://github.com/anthropics/claude-code/issues/39455) —
  userConfig values not prompted on enable (some platforms)
- [#51581](https://github.com/anthropics/claude-code/issues/51581) —
  `${VAR}` substitution in HTTP MCP `headers` field doesn't work (closed
  as "completed" Apr 2026, fix version unknown)
- [#41156](https://github.com/anthropics/claude-code/issues/41156) —
  `${CLAUDE_PLUGIN_DATA}` write triggers protected-directory prompt in
  bypassPermissions mode

## Affected Plugins (as of 2026-05-13)

| Plugin | Was Affected? | Resolved In |
|--------|---------------|-------------|
| yellow-composio | yes (v1.2.x had `required: true`) | v1.3.0 (stdio wrapper + required removed) |
| All others | no (never used `required: true` for sensitive credentials) | n/a |
