---
'yellow-research': major
'yellow-core': patch
'yellow-debt': patch
'yellow-review': patch
'yellow-composio': patch
---

Remove the bundled ast-grep MCP server and use the `ast-grep` CLI directly.
The MCP server needed `uvx`, git, Python 3.13 and the binary on the PATH
Claude Code launched with, and `/research:setup` could never confirm it: its
probe called `find_code` without the required `project_folder`, uv was only
installed when ast-grep was missing, and an install mid-session could not
start a server that had already failed. The four
`mcp__plugin_yellow-research_ast-grep__*` tools are gone.

`code-researcher` and yellow-debt's duplication and complexity scanners now
run `ast-grep run` / `ast-grep scan --inline-rules` through Bash when
`ast-grep` is on PATH and fall back to Grep otherwise. `research-conductor`
and yellow-review's `silent-failure-hunter` and `type-design-analyzer` have no
Bash and use their existing search tools. `install-ast-grep.sh` no longer
installs uv or pre-warms Python, `/research:setup` reports the CLI as a local
tool (MCP sources now count out of six), and `/setup:all` no longer probes the
removed tool or checks `uv` (yellow-research bundled sources now count out of
five).
