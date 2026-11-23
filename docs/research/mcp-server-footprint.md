# Shipped MCP server footprint

Measured November 23, 2026 against yellow-plugins `b5be57b65`. Eight
marketplace plugins register 13 MCP servers. Seven plugins declare 12 inline.
The eighth, gt-workflow, points to a separate file that declares Graphite.
Eight servers returned raw tool lists. The authenticated Claude client
reported counts for four more; one count comes solely from vendor docs. [Implementation plan](../../plans/mcp-server-footprint.md).

| Plugin | Server | Instructions B | Input schemas B | Tool descriptors B | Tools | Discovery wording in first 4,096 characters |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| gt-workflow | graphite | 0 | 614 | 3,980 | 2 | None supplied. |
| yellow-composio | composio-server | — | — | — | 12 via client | Unknown. Anonymous initialization returned 401. The vendor documents seven meta-tools. [Connect tools](https://docs.composio.dev/docs/composio-connect) |
| yellow-devin | devin | — | — | — | 20 documented | Unknown. Anonymous initialization returned 401. Published count excludes legacy aliases. [Available tools](https://docs.devin.ai/work-with-devin/devin-mcp#available-tools) |
| yellow-linear | linear | — | — | — | 78 via client | Unknown. Anonymous initialization returned 401. Record the OAuth scope when measuring this endpoint. [Linear MCP](https://linear.app/docs/mcp) |
| yellow-morph | morph | 0 | 1,693 | 3,945 | 2 | None supplied. |
| yellow-research | ceramic | — | — | — | 1 via client | Unknown. Anonymous initialization returned 401. |
| yellow-research | deepwiki | 3,926 | 748 | 1,709 | 3 | Yes. The opening says “AI-powered documentation for GitHub repositories”; the prefix names the public wiki tools and describes private-only tools. |
| yellow-research | exa | 0 | 6,436 | 9,285 | 7 | None supplied. |
| yellow-research | parallel | — | — | — | 4 via client | Unknown. Anonymous initialization returned 401. [Upstream Task MCP](https://github.com/parallel-web/task-mcp/tree/bc0daf6b76cf0e403c0c3aeac15ff67452adf018) |
| yellow-research | perplexity | 616 | 3,861 | 7,388 | 4 | Yes. The opening says “web-grounded search, research, and reasoning” and names which tool to use for URLs, cited answers, deep research and analysis. |
| yellow-research | tavily | 0 | 6,452 | 7,378 | 5 | None supplied. |
| yellow-ruvector | ruvector | 0 | 804 / 94 | 1,408 / 363 | 5 / 2 | None supplied in either profile. Full allowlist first, fresh-store guard second. |
| yellow-semgrep | semgrep | 0 | 3,075 | 54,079 | 7 | None supplied. |

A dash marks a field the probe could not measure. On the five 401 rows,
the installed Claude Code 2.1.330 client's `mcp_status` control request
reported tool counts for four matching authenticated URLs. Composio
reported server version 0.1.0, Linear 1.0.2, Parallel 1.0.5 and Ceramic
1.23.3. These counts describe that client's access on the measurement date.
Its status response omits raw tool schemas and initialization instructions.
Devin reported `needs-auth`, so its count comes from vendor documentation.
For those five byte measurements, repeat raw initialization and pagination
with an authorized MCP client that exposes both fields, and record its
scope and service version. A discovery result of
“None supplied” means the measured instruction string had zero bytes.
Descriptions on individual tools still provide a separate discovery surface.

## How to repeat the measurement

1. Read the marketplace plugin sources and resolve each generated Claude
   manifest’s `mcpServers` object or file path. For the file-backed Graphite
   definition, read the plugin’s `.mcp.json`.
2. Send JSON-RPC `initialize` (client protocol `2025-03-26`, empty client
   capabilities), then `notifications/initialized` and `tools/list`.
   Follow every `nextCursor` before measuring. Use newline-delimited JSON
   for stdio or Streamable HTTP with JSON and SSE response support. No
   provider tool invocation is needed.
3. Count UTF-8 bytes in `initialize.result.instructions` (absent means
   zero). Examine the first 4,096 Unicode code points for wording that
   tells the client when to select this server or search for its tools.
4. Serialize with Python `json.dumps(value, ensure_ascii=False,
   separators=(',', ':'))` and encode in UTF-8. “Input schemas” sums the
   serialized `inputSchema` objects. “Tool descriptors” counts the compact
   array of all returned tool objects, including names, descriptions,
   schemas, annotations, array brackets and commas. Exclude transport
   envelopes, headers and cursors. These are protocol sizes; a client can
   defer schema loading, so session token use needs a separate observation.

The local probes used disposable working directories and homes. Packages
and flags came from the shipped wrappers. Placeholder keys allowed
credential-gated local packages to list their tools. HTTP probes were
anonymous; the separate client status query used existing sessions. Local package versions were `gt` 1.8.6, Morph 0.8.181,
Exa 3.1.8, Perplexity 0.8.2, Tavily 0.2.17, RuVector 0.3.3 and Semgrep
CLI 1.154.0. DeepWiki advertised server version 4.0.2. Graphite and
Semgrep depend on the installed CLI, so record its version on repeat runs.

Morph used `WORKSPACE_MODE=true` and disabled `github_codebase_search`.
Exa used the seven-tool manifest wrapper selection. RuVector exposed its
five configured tools with the explicit hash embedder. Replaying the
fresh-store guard’s effective allow/deny lists returned
`hooks_stats` and `hooks_capabilities`. The guard also depends on model
readiness, so report which profile was sampled.

## CLI overlap and follow-ups

- Graphite exposes `run_gt_cmd` and `learn_gt`; its plugin already requires
  and uses the same CLI. Verify help/discovery and host parity before making
  MCP optional. Existing Graphite stacks still need their provider.
  [CLAUDE-386](https://linear.app/kinginyellow/issue/CLAUDE-386)
- Semgrep’s supply-chain tool accounts for 40,675 of 54,079 descriptor
  bytes. The plugin already invokes `semgrep scan` and separately consumes
  platform findings. Evaluate a narrower tool list and CLI coverage for the
  existing workflows. [CLAUDE-387](https://linear.app/kinginyellow/issue/CLAUDE-387)
- Composio offers a CLI-based plugin, but the shipped yellow-composio
  workflows discover and invoke MCP meta-tools. A switch would introduce a
  new required interface. The endpoint’s authenticated schema size is still
  unknown. [Composio agent plugins](https://docs.composio.dev/docs/agent-plugins)
