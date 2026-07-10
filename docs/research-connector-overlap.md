# Research Connector Overlap

How yellow-research's bundled MCP servers coexist with claude.ai native
connectors that expose the same providers. Sibling of
`docs/memory-routing-protocol.md` and
`docs/review-surface-routing-protocol.md`. Recorded after the 2026-07-09
full-marketplace audit surfaced the overlap as an undocumented coherence gap.

## The overlap

Two providers can be reachable through BOTH a plugin-bundled MCP server and a
claude.ai native connector in the same session:

| Provider | Bundled (yellow-research) | claude.ai native connector |
|---|---|---|
| Tavily | `mcp__plugin_yellow-research_tavily__*` (userConfig `tavily_api_key`) | `mcp__claude_ai_Tavily__*` (connector-managed auth) |
| EXA | `mcp__plugin_yellow-research_exa__*` (userConfig `exa_api_key`) | `mcp__claude_ai_Exa__*` (connector-managed auth) |

The tool SURFACES differ slightly (the native connectors expose a smaller
tool set — e.g. native EXA lacks `get_code_context_exa` and the deep-research
pair), but for plain web search the calls are interchangeable and both bill
against a provider account.

## Priority order

Modeled on yellow-composio's three-prefix priority list
(`plugins/yellow-composio/commands/composio/setup.md`, Step 2). When
discovering Tavily or EXA tools via ToolSearch, prefer prefixes in this
order:

1. `mcp__plugin_yellow-research_<server>__*` — bundled by yellow-research
   (preferred: full tool surface, keychain-backed userConfig credentials,
   version-pinned by the plugin, referenced by the plugin's agents and
   commands by exact name).
2. `mcp__claude_ai_<Provider>__*` — claude.ai native connector (fallback:
   works with zero plugin configuration, but a smaller tool surface and
   auth managed outside the repo's credential conventions).
3. Neither — degrade per `research-patterns` (skip the provider, continue
   with remaining sources).

yellow-research's agents already reference the bundled names explicitly in
their `tools` frontmatter, so the bundled path is the de-facto primary today; this
document makes the ordering explicit rather than changing behavior.

## Practical notes

- **Double-billing risk is low but real**: a session with both surfaces
  active can hit the same provider twice for one research question if an
  agent free-searches with ToolSearch instead of using its `tools`
  list. Agents should not mix prefixes within one run.
- **No dual-OAuth issue** (unlike the context7 precedent that led to
  unbundling): Tavily/EXA bundled servers use API keys, not OAuth, so
  coexistence does not produce duplicate browser pop-ups.
- **Perplexity, Parallel, Ceramic, ast-grep** currently have no native
  connector equivalents in observed sessions; this document covers them
  only if that changes.

## Follow-up (out of scope here)

- If a maintainer decides the native connectors should be primary instead,
  the bundled-preferred assertion currently lives in several coupled
  surfaces: this document's own "Priority order" section, the "Native
  Connector Overlap" section of `plugins/yellow-research/README.md`, and the
  `tools` lists of `research-conductor` and `code-researcher` (which name the
  bundled tools explicitly). New ToolSearch priority guidance, if added,
  would go in `plugins/yellow-research/skills/research-patterns/SKILL.md`.
  Sweep all in one PR (multi-doc drift discipline).
