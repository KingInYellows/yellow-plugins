# yellow-research

Deep research plugin for Claude Code. Bundles Ceramic, DeepWiki, Perplexity,
Tavily, EXA, and Parallel Task MCP servers with three workflows:

- **`/research:code`** — Inline code research for active development
- **`/research:deep`** — Multi-source deep research saved to `docs/research/`
- **`/flow:deepen-plan`** — Enrich plans with codebase + external research

## Installation

```
/plugin marketplace add KingInYellows/yellow-plugins
```

Then enable `yellow-research` from the plugin list.

**Optional:** Install the user-level `context7` MCP for library-docs support
in `/research:code` (`/plugin install context7@upstash`). If absent, the
code-researcher falls back to EXA. Install the `yellow-core` plugin for the
`repo-research-analyst` agent.

**ast-grep (optional):** `/research:code` runs the `ast-grep` CLI through Bash
for structural code search when it is on PATH, and uses Grep otherwise. Run
`/research:setup` to install it via npm, or install manually:
`npm install -g @ast-grep/cli`. There is no ast-grep MCP server.

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

EXA, Tavily and Perplexity are the only API keys. Ceramic and Parallel Task
authenticate via OAuth and need no key.

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
| DeepWiki | `mcp.deepwiki.com` | AI docs for public GitHub repos, no key |
| Perplexity | `@perplexity-ai/mcp-server` | Web-grounded research and reasoning |
| Tavily | `tavily-mcp` | Fast web search and page extraction |
| EXA | `exa-mcp-server` | Neural web search, code examples |
| Parallel Task | `task-mcp.parallel.ai` | Async long-horizon research reports |

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
| `/flow:deepen-plan [path]` | Enrich a plan with codebase validation + external research |

## Graceful Degradation

If a source MCP is unavailable (key not set, rate limited, connection error),
the plugin skips that source and continues with the rest. Research never fails
completely if at least one source is reachable.

## Shared public repository skill

`research-public-repo` answers one question about an indexed public GitHub
repository using the existing DeepWiki HTTP endpoint. It returns inline JSON
with evidence links and indexing limits. It discovers actual tool names, uses
only repository Q&A/wiki reads, and needs no API key or agent dispatcher.
Private repositories, local-code uploads, saved reports and other research
providers are outside this slice. Missing tools and authentication challenges
produce explicit statuses without login or credential inspection.

Codex support is limited to this skill and the DeepWiki server after installed
runtime acceptance. Claude's other MCP servers, userConfig substitution and
credential-status hook are not exported for this workflow. Windows desktop and
WSL CLI tool availability must be verified separately.

## Native Connector Overlap

Tavily and EXA may also be reachable via claude.ai native connectors
(`mcp__claude_ai_Tavily__*` / `mcp__claude_ai_Exa__*`) in the same session.
The bundled servers are preferred; see
[`docs/research-connector-overlap.md`](../../docs/research-connector-overlap.md)
for the priority order and rationale.

Installed Codex acceptance passed for the selected skill, including safe
failure and unrelated controls. Other plugin components remain excluded.
See [integrated evidence](../../docs/research/codex-phases-2-5-2026-10-06/report.md).
