---
title: 'Plugin Install Scripts Must Smoke-Test the MCP Entrypoint Subcommand'
date: 2026-04-28
category: 'code-quality'
---

## Summary

Plugins that bundle an MCP server in `plugin.json` declare a `command` (or
`args`) that Claude Code invokes when the server is needed. Install scripts
that verify the binary exists (`command -v <tool>`) and the version is
acceptable (`<tool> --version`) typically stop there — but those checks
do **not** prove that the specific subcommand named in `plugin.json` is a
valid invocation.

If the subcommand is missing (renamed in a new release, removed in a fork,
not yet shipped in the installed version), the MCP server silently fails to
start. Claude Code reports zero MCP tools from the plugin, and the user
sees no diagnostic — install completed, version is current, but the plugin
is functionally broken.

## Anti-Pattern

```json
// plugin.json
{
  "mcpServers": {
    "mempalace": {
      "command": "mempalace",
      "args": ["mcp"]
    }
  }
}
```

```bash
# install-mempalace.sh — verifies binary + version, but never exercises
# the `mcp` subcommand the plugin will actually call.
mempalace --version
success "mempalace ${installed_version} installed via ${INSTALL_METHOD}"
```

If `mempalace` ships in a future version that renames `mcp` to `serve`, the
plugin breaks at first use, not at install time.

## Pattern

After all version/PATH checks, exercise the exact subcommand `plugin.json`
will invoke. Use `--help` (cheap, no side effects) and warn — don't error —
on failure so install still succeeds for users who can fix it manually:

```bash
# Smoke-test the MCP entrypoint that plugin.json will invoke. If this
# subcommand is absent, the MCP server silently fails to start with no
# diagnostics, leaving the user with 0 tools.
#
# Inline the command substitution into the `if` condition. The two-step
# `var=$(cmd); if [ $? -ne 0 ]` form silently aborts under `set -e` on
# the failing assignment — the warning never fires. `if ! var=$(cmd)`
# suppresses errexit for the assignment and works under either mode.
if ! MCP_CHECK=$(mempalace mcp --help 2>&1); then
  printf '[install-mempalace] Warning: "mempalace mcp --help" failed — MCP entrypoint may differ in this version.\n' >&2
  printf '[install-mempalace] Output: %s\n' "$MCP_CHECK" >&2
  printf '[install-mempalace] Verify plugin.json mcpServers.mempalace.command matches the installed CLI.\n' >&2
fi

success "mempalace ${installed_version} installed successfully via ${INSTALL_METHOD}"
```

Why warn rather than error: the binary itself is healthy, the user has a
working install. The MCP integration may be broken, but the user can repair
it without re-running install. Erroring would block the install for a
problem that isn't fatal to the binary.

## Detection

When authoring or auditing a plugin install script:

1. Read the plugin's `plugin.json` `mcpServers.<name>.command` + `args`.
2. Grep the install script for the exact subcommand string (e.g., `mcp`).
3. If the subcommand appears only in `plugin.json`, not in the install
   script, the smoke test is missing.

```bash
# Example check (the `// []` fallback handles servers with no `args` field):
jq -r '.mcpServers | to_entries[] | "\(.key): \(.value.command) \((.value.args // []) | join(" "))"' plugins/<name>/.claude-plugin/plugin.json
```

## Generalization

Same pattern applies to:

- Plugins wrapping any external CLI's MCP server (yellow-ruvector,
  yellow-mempalace, future entries).
- Plugins that delegate to a subcommand of a versioned tool where the
  subcommand surface may evolve (e.g., `gh extension`, `aws <service>`).
- Hooks that exec a tool's subcommand — verify the subcommand at install
  time rather than at first hook fire.

## Origin

PR #248 (yellow-mempalace plugin), architecture-strategist agent + code-
reviewer. Plan doc had originally specified this smoke test; install
script omitted it. Detected during multi-agent review; fix added before
merge.

## See Also

- MEMORY.md "Plugin Manifest Validation" — local CI ≠ remote validation
  pattern; same idea: validate at the layer that will actually exercise
  the contract.
