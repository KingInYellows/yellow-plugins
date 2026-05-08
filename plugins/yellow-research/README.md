# yellow-research

Deep research plugin for Claude Code. Bundles Ceramic, Perplexity, Tavily,
EXA, Parallel Task, and ast-grep MCP servers with three workflows:

- **`/research:code`** — Inline code research for active development
- **`/research:deep`** — Multi-source deep research saved to `docs/research/`
- **`/workflows:deepen-plan`** — Enrich plans with codebase + external research

## Installation

```
/plugin marketplace add KingInYellows/yellow-plugins
```

Then enable `yellow-research` from the plugin list.

**Optional:** Install the user-level `context7` MCP for library-docs support
in `/research:code` (`/plugin install context7@upstash`). If absent, the
code-researcher falls back to EXA. Install the `yellow-core` plugin for the
`repo-research-analyst` agent.

**ast-grep:** The ast-grep MCP server requires the `ast-grep` binary. Run
`/research:setup` which offers to install it automatically via npm. Or install
manually: `npm install -g @ast-grep/cli`.

## API Key Setup

EXA / Tavily / Perplexity API keys are read from `userConfig` (system
keychain) by default. As of v3.1.0, each MCP server is launched via a
small wrapper in `bin/start-<server>.sh` that resolves the key with this
precedence:

1. `userConfig` value (preferred — keychain-encrypted)
2. Shell env fallback: `EXA_API_KEY`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`

If both are set, `userConfig` wins. If neither is set, the wrapper
unsets the empty value before exec; behavior then differs by server.
Perplexity's MCP hard-fails at startup so its tools are unavailable,
while Tavily and EXA start successfully and surface a runtime error
on the first tool call.

Recommended path (one-time per workstation, no restart needed):

```text
/plugin disable yellow-research
/plugin enable yellow-research
```

Claude Code prompts for each key on enable. Answer the prompts for the
sources you want; dismiss the others. Values persist in the system keychain
(or `~/.claude/.credentials.json` at 0600 on minimal Linux).

`CERAMIC_API_KEY` is the only shell-env key still in use — it powers the
`/research:setup` REST live-probe only (the Ceramic MCP itself authenticates
via OAuth):

```sh
export CERAMIC_API_KEY="..."   # https://platform.ceramic.ai/keys
                               # REST probe only; MCP uses OAuth
```

Get keys at:

- EXA — https://exa.ai/
- Tavily — https://tavily.com/
- Perplexity — https://www.perplexity.ai/settings/api

The **Parallel Task** and **Ceramic** MCP servers use OAuth — Claude Code
handles authentication automatically. You'll be prompted to authorize on
first use (no API key needed).

Power users who already export `EXA_API_KEY`, `TAVILY_API_KEY`, and/or
`PERPLEXITY_API_KEY` in their shell rc do not need to re-enter them via
`userConfig` — the bundled `bin/start-<server>.sh` wrappers pick up shell
env values automatically when no `userConfig` value is set.

## Usage

### Code Research (inline)

```
/research:code how does React Server Components work?
/research:code stripe webhooks typescript
/research:code difference between zod and valibot
```

Returns a concise answer in-context. No file saved.

### Deep Research (saved report)

```
/research:deep competitive analysis of vector databases 2026
/research:deep technical landscape of MCP server authentication patterns
/research:deep how do large language models handle long context
```

Saves a structured report to `docs/research/<slug>.md`. For major findings,
run `/compound` to add to institutional knowledge.

## MCP Servers

| Server | Package | Purpose |
|--------|---------|---------|
| Ceramic | `mcp.ceramic.ai` | Lexical web search, ~$0.05/1K queries |
| Perplexity | `@perplexity-ai/mcp-server` | Web-grounded research and reasoning |
| Tavily | `tavily-mcp` | Fast web search and page extraction |
| EXA | `exa-mcp-server` | Neural web search, code examples |
| Parallel Task | `task-mcp.parallel.ai` | Async long-horizon research reports |
| ast-grep | `ast-grep-mcp` (via uvx) | AST-based structural code search |

## Research Conductor

The `research-conductor` agent automatically selects sources based on topic
complexity:

- **Simple topics** → Ceramic first (keyword-tight); Perplexity fallback
- **Moderate topics** → Ceramic + Perplexity + Tavily in parallel
- **Complex topics** → Full fan-out: Ceramic + Perplexity + Tavily + async EXA + async Parallel Task

## Output Format

Deep research reports saved to `docs/research/<slug>.md`:

```markdown
# Topic Title

**Date:** 2026-02-21
**Sources:** Perplexity, EXA, Tavily

## Summary

Executive summary of findings.

## Key Findings

### Subtopic 1
...

## Sources

- [Source](URL) — what was found here
```

## Commands

| Command | Description |
|---|---|
| `/research:setup` | Check which API keys and MCP sources are active |
| `/research:code [topic]` | Inline code research — returns answer in-context, no file saved |
| `/research:deep [topic]` | Multi-source deep research — saves report to `docs/research/<slug>.md` |
| `/workflows:deepen-plan [path]` | Enrich a plan with codebase validation + external research |

## Graceful Degradation

If a source MCP is unavailable (key not set, rate limited, connection error),
the plugin skips that source and continues with the rest. Research never fails
completely if at least one source is reachable.
