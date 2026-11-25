# Measure the shipped MCP server footprint

## Overview

Measure the server instructions and advertised tools that a Claude Code
installation can discover. Use the current marketplace as the inventory,
including plugins that reference a separate MCP manifest. Record the
observation date, source revision and package or service version.

## Linear Issues

- CLAUDE-310

## Planning handoff

Follow the roadmap’s `/flow:plan` sequence for this measurement-only task.
The scoped implementation target for `/flow:work` is
[`docs/research/mcp-server-footprint.md`](../docs/research/mcp-server-footprint.md).
The unresolved input is authenticated tool discovery on gated endpoints.

## Implementation

1. Enumerate marketplace plugins, resolve inline and file-backed MCP server
   definitions, and compare the count with roadmap track T8.
2. For each HTTP server, initialize an anonymous MCP session and request
   every page of tools. For stdio servers, initialize the declared version
   with its plugin's tool options in a disposable directory. Use listing
   only. Record where a service requires an authenticated session.
3. Measure UTF-8 bytes in server instructions and compact tool descriptors.
   Count tools after pagination. Inspect the first 4,096 Unicode characters
   of each measured instruction for wording that helps a user or agent
   choose the service.
4. Compare the measured tools with CLIs the same plugin already uses.
   Document overlap, scope limits and any justified follow-up issue.
5. Publish one row per server in the research baseline. Use a gap label
   whenever the service could not be measured. Distinguish zero instructions
   from unknown instructions.

## Acceptance Criteria

- Every shipped server has exactly one table row.
- Every observed count has a defined byte or tool unit.
- Each unmeasured field names the prerequisite for a future measurement.
- Each trim or removal candidate is linked to an issue.
- Keep the measurement independent of provider tools that access user data.

## References

- [Roadmap track T8](claude-code-quality-and-cost-roadmap.md#t8--mcp-and-tool-output)
- [Linear measurement request](https://linear.app/kinginyellow/issue/CLAUDE-310)
