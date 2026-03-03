# Morph-LLM and WarpGrep v3: Fit Assessment for Claude Code Plugins

**Date:** 2026-03-03
**Sources:** Perplexity Deep Research, Tavily Pro Research, yellow-plugins repo analysis
**Classification:** Complex (multi-entity evaluation + ecosystem fit + integration architecture)

## Executive Summary

Morph-LLM is a specialized AI infrastructure platform (founded 2025, by Tejas Bhakta) that provides two core capabilities: **Fast Apply** (a deterministic, structure-aware code merging engine running at 10,500+ tokens/second with 98%+ accuracy) and **WarpGrep** (an RL-trained code search subagent achieving 0.73 F1 in 3.8 steps -- 3x faster than frontier model search). Both tools are designed to be integrated into AI coding agents via an MCP server, SDK, or direct API calls. They ship with explicit Claude Code support and would represent a strong addition to the yellow-plugins ecosystem as a new `yellow-morph` plugin providing enhanced code editing and semantic search capabilities.

**Critical clarification on "WarpGrep v3":** No public evidence exists for a distinct "WarpGrep v3" release. The latest publicly documented version is **WarpGrep v2** (announced via Morph's blog with RL training improvements). The "v3" in the user query likely refers to the **morph-v3-fast** and **morph-v3-large** model identifiers used by the underlying Morph models (which WarpGrep orchestrates), not a WarpGrep-specific version. The WarpGrep API model identifier is `morph-warp-grep-v1`. This report covers the latest available WarpGrep capabilities.

## Key Findings

### 1. Morph-LLM Platform Overview

**What it is:** Morph-LLM is not a general-purpose LLM. It is a suite of small, specialized models optimized for two specific bottlenecks in AI coding workflows: code editing (merging AI-suggested changes into files) and code search (finding relevant context in large repositories).

**Core components:**

| Component | Purpose | Performance |
|-----------|---------|-------------|
| **Fast Apply** | Semantic, structure-aware code merging | 10,500+ tok/s, 98%+ accuracy, 1.6s avg apply time |
| **WarpGrep** | RL-trained agentic code search subagent | 0.73 F1, 3.8 steps avg, sub-6s per search |
| **Morph Embedding** | 768-dim code-specific embeddings | Model: `morph-embedding-v3` |
| **Morph Reranker** | Code-focused result reranking | Cohere-compatible API |
| **MorphGit** | Git operations (init, clone, stage, commit, push, pull, branch) | SDK namespace |

**Architecture insight:** Rather than competing with frontier models (Claude, GPT), Morph builds specialized tools that run alongside them. The thesis: coding agents spend 60%+ of time searching for code, and existing edit mechanisms (search-and-replace, full-file rewrite, unified diff) all fail at scale. Morph addresses these specific bottlenecks with purpose-built models.

**Company/adoption:**
- Enterprise customer: Binance (5,000 developers, 50-70% productivity improvement reported)
- Available on: AWS Marketplace, OpenRouter, Mastra model router
- Serves 20+ coding services
- AWS case study published

### 2. Fast Apply: Deep Capabilities

**Problem solved:** Traditional AI code editing has three approaches, all flawed:
1. **Full-file rewrite** -- 100+ seconds, expensive, hallucination-prone above 400 lines
2. **Search-and-replace** -- Brittle, 86% accuracy even with Claude Sonnet 4, breaks on whitespace
3. **Unified diff** -- Struggles with ambiguous line numbers, requires correction loops

**How Fast Apply works:**
- Accepts "lazy edit snippets" using `// ... existing code ...` markers
- The AI model only specifies what changes; Morph handles the merge deterministically
- Uses speculative decoding (fast draft model + target validation model) for 4-5x speedup
- Language-agnostic and framework-agnostic
- Scales to 1,500-line files at 99.2% accuracy (traditional approaches degrade above 200 lines)

**API details:**
```
Endpoint: OpenAI-compatible (https://api.morphllm.com/v1/chat/completions)
Models:
  - morph-v3-fast: 16K context, $0.80/$1.00 per 1M tokens (input/output)
  - morph-v3-large: 32K context, $0.90/$2.00 per 1M tokens (input/output)
  - Auto-routing model available

SDK: morph.fastApply.execute(input, overrides)
  Input: { target_filepath, instructions, code_edit }
  Output: { success, mergedCode, changes, udiff, error }
```

**Benchmark data:**
- Fast Apply with Claude Sonnet 4: 18.9s total, 100% success rate
- Search-and-replace with Claude Sonnet 4: 32.7s total, 95% success rate
- Apply phase alone: 1.6s avg (vs. 35s for correction iterations in search-and-replace)
- 10x faster than Cursor's apply model (10,500 vs. 1,000 tokens/second)

### 3. WarpGrep: Deep Capabilities

**Problem solved:** Coding agents spend 60%+ of execution time searching for relevant code. Two existing approaches both fail:
1. **grep/ripgrep** -- Fast (ms) but finds patterns, not intent. Cannot answer "how does billing handle failed payments?"
2. **Semantic embeddings** -- Cannot represent causal code relationships; stale embeddings cause 20% performance decline; Claude Code itself avoids embeddings for this reason

**How WarpGrep works:**
- Runs as a **separate subagent in an isolated context window** (prevents main model context pollution)
- Has access to three local tools: `grep` (ripgrep), `read` (file sections), `list_dir` (directory exploration)
- Requires **no embeddings, no vector database, no indexing** -- works instantly on any repo
- Issues up to **8 parallel grep operations per turn** (breadth-first search)
- RL-trained with weighted F1 (beta=0.5), favoring **precision over recall** (one irrelevant file can derail the main model; missing a file is less harmful)
- Typically completes in 3.8 steps (vs. 12.4 steps for Claude Haiku at equivalent F1)

**API details:**
```
SDK: morph.warpGrep.execute(input, overrides)
  Input: { query, repoRoot, excludes?, includes?, streamSteps?, provider? }
  Output: Structured results with file paths and relevant code sections

MCP tool name: warpgrep_codebase_search
  Accepts natural language search query, returns relevant code sections

Model identifier: morph-warp-grep-v1
Pricing: $0.80/$0.80 per 1M tokens (input/output)
Default timeout: 30,000ms (configurable via MORPH_WARP_GREP_TIMEOUT)
```

**Benchmark data:**
- WarpGrep F1: 0.73 in 3.8 steps
- Claude Haiku F1: 0.72 in 12.4 steps (3x more steps, same quality)
- Sub-6 second searches for complex queries
- With Claude Opus 4.6: +2.1 points on SWE-Bench Pro, 15.6% cheaper per task, 28% faster

**WarpGrep v2 improvements (latest documented version):**
- RL training specifically optimized for parallel search
- Reward signal tuned with weighted F1 (beta=0.5)
- Optimized for NVIDIA B200 GPUs (900 tok/s)
- Pushed Claude Code to 57.5% on SWE-bench Pro

**Auto-excluded directories:** node_modules, vendor, build output, cache directories, .git

### 4. MCP Server and Claude Code Integration

Morph ships an official MCP server package: `@morphllm/morphmcp`

**Setup (one command):**
```bash
npx -y @morphllm/morph-setup --morph-api-key YOUR_API_KEY
```
This auto-detects Claude Code, Cursor, VS Code, and Codex and configures them automatically.

**Manual Claude Code setup:**
```bash
claude mcp add morph-mcp -e MORPH_API_KEY=YOUR_API_KEY -- npx @morphllm/morphmcp
```

**MCP tools exposed:**

| Tool Name | Function |
|-----------|----------|
| `edit_file` | Fast Apply code editing |
| `warpgrep_codebase_search` | WarpGrep intelligent code search |

**Environment variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `MORPH_API_KEY` | (required) | API authentication |
| `ENABLED_TOOLS` | `edit_file,warpgrep_codebase_search` | Which tools to expose |
| `WORKSPACE_MODE` | `true` | Auto-detect repo root |
| `DEBUG` | `false` | Verbose logging |
| `MORPH_API_URL` | `https://api.morphllm.com/v1` | Custom endpoint for enterprise |
| `MORPH_WARP_GREP_TIMEOUT` | `30000` | Timeout in ms |

**Behavior:** When configured, Claude Code automatically prefers `edit_file` over search-and-replace and `warpgrep_codebase_search` over native grep-based search.

### 5. SDK and Framework Adapters

**NPM package:** `@morphllm/morphsdk` (latest: 0.2.127)
**Python package:** `morph-python-sdk`

**SDK namespaces:**
```typescript
import { MorphClient } from '@morphllm/morphsdk';

const morph = new MorphClient({ apiKey, debug?, timeout?, retry? });

morph.fastApply.execute(input, overrides)   // Code editing
morph.warpGrep.execute(input, overrides)    // Agentic search
morph.codebaseSearch.search(input, overrides) // Embedding-based search
morph.git.*                                   // Git operations
```

**Framework adapters:**

| Framework | Functions | Purpose |
|-----------|-----------|---------|
| Anthropic | `createEditFileTool`, `createCodebaseSearchTool` | Claude tool definitions |
| OpenAI | Equivalent functions | GPT tool definitions |
| Vercel AI SDK | Streaming Fast Apply | Vercel AI streaming integration |

**Helper functions:**
- `createWarpGrepTool` -- Generate tool definition for any agent framework
- `createFastApplyTool` -- Generate Fast Apply tool definition
- `createBrowserTool` -- Browser automation tool

### 6. Pricing Model

| Tier | Price | Credits | Rate Limits |
|------|-------|---------|-------------|
| Free | $0/mo | 250K credits (200 req/mo) | Strict |
| Starter | $20/mo | 2M credits | Moderate |
| Pro | $60/mo ($5 first month) | 8M credits | Generous |
| Scale | $400/mo | 80M credits | Near-unlimited |
| Enterprise | Custom | Custom | Dedicated instances, 99.9% SLA |

**Credit consumption estimates:**
- Fast Apply edit: 2,000-5,000 credits
- WarpGrep search: 500-2,000 credits
- Individual edit cost: $0.001-$0.005
- Individual search cost: ~$0.001

**Enterprise deployment options:**
- Cloud-hosted managed infrastructure
- Self-hosted on-premises / private cloud
- Zero-data-retention (ZDR) mode with end-to-end encryption
- SOC-2 Type II controls, NIST secure deletion, TLS 1.3+, AES-256

### 7. Fit Assessment for yellow-plugins Ecosystem

#### Current Ecosystem Context

The yellow-plugins monorepo contains 11 plugins:

| Plugin | Domain | Relevance to Morph |
|--------|--------|-------------------|
| `yellow-core` | Dev toolkit, review/research agents | **High** -- Fast Apply would improve code editing in all workflows |
| `yellow-review` | Multi-agent PR review | **High** -- WarpGrep for finding related code during reviews |
| `yellow-ruvector` | Vector memory and semantic search | **Medium** -- Overlapping but complementary to WarpGrep |
| `yellow-debt` | Technical debt scanning | **High** -- WarpGrep for pattern finding, Fast Apply for remediation |
| `yellow-research` | Deep research (Perplexity, Tavily, EXA) | **Low** -- Different domain |
| `yellow-ci` | CI failure diagnosis | **Medium** -- Fast Apply for fix application |
| `yellow-linear` | Linear PM integration | **Low** -- Different domain |
| `yellow-devin` | Devin.AI delegation | **Medium** -- WarpGrep as alternative to Devin search |
| `yellow-browser-test` | Browser testing | **Low** -- Different domain |
| `yellow-chatprd` | ChatPRD integration | **Low** -- Different domain |
| `gt-workflow` | Graphite stacked PRs | **Low** -- Different domain |

#### Overlap Analysis with yellow-ruvector

Both WarpGrep and ruvector provide code search, but they are **complementary, not competing**:

| Dimension | WarpGrep | ruvector |
|-----------|----------|----------|
| **Search type** | Agentic (LLM-orchestrated ripgrep) | Embedding-based vector similarity |
| **Indexing required** | No | Yes (one-time index step) |
| **Persistence** | Stateless per query | Persistent memory across sessions |
| **Best for** | "Find where billing handles failures" | "Find code similar to this pattern" |
| **Speed** | 3-6 seconds | Sub-100ms after indexing |
| **Memory/learning** | None | Stores learnings, mistakes, patterns |
| **Accuracy** | 0.73 F1 (agentic precision) | Depends on embedding quality |

**Recommendation:** Keep both. WarpGrep excels at intent-based search on fresh codebases. ruvector excels at persistent memory, cross-session learning, and similarity-based retrieval on indexed code. A `yellow-morph` plugin can reference ruvector conventions and recommend combined usage.

#### Workflows That Would Benefit

1. **Code editing in all plugins** -- Any agent that edits code (review agents, debt remediation, CI fixes) would benefit from Fast Apply's 98%+ accuracy vs. search-and-replace's 86%
2. **PR review code discovery** -- `yellow-review` agents could use WarpGrep to find related code across the codebase when reviewing changes
3. **Debt scanning and remediation** -- `yellow-debt` can use WarpGrep to find anti-patterns and Fast Apply to remediate them in one pass
4. **Large codebase refactoring** -- Any multi-file refactoring workflow benefits from Fast Apply's ability to handle 1,500-line files reliably
5. **Context gathering for any agent** -- Any agent that needs to understand code context before acting (review, planning, debugging) benefits from WarpGrep's precision

### 8. Integration Path Recommendations

#### Recommended: New `yellow-morph` Plugin

Create a new `yellow-morph` plugin following the existing plugin architecture pattern.

**Plugin structure:**
```
plugins/yellow-morph/
  .claude-plugin/
    plugin.json          # MCP server config for @morphllm/morphmcp
  agents/
    morph-edit/          # Agent for intelligent code editing workflows
    morph-search/        # Agent for semantic code search
  commands/
    morph/
      setup.md           # /morph:setup -- API key config, ripgrep check, MCP server install
      search.md          # /morph:search -- WarpGrep search with structured output
      edit.md            # /morph:edit -- Fast Apply edit workflow
      status.md          # /morph:status -- API health, credit balance, model info
  skills/
    morph-conventions/   # Plugin conventions and tool naming patterns
    morph-edit/          # Skill for Fast Apply usage patterns
    morph-search/        # Skill for WarpGrep usage patterns
  hooks/                 # Optional: auto-prefer morph tools when available
  tests/
  CLAUDE.md
  README.md
  CHANGELOG.md
  package.json
```

**plugin.json MCP server configuration:**
```json
{
  "name": "yellow-morph",
  "version": "1.0.0",
  "description": "Intelligent code editing and search via Morph Fast Apply and WarpGrep",
  "mcpServers": {
    "morph-mcp": {
      "command": "npx",
      "args": ["@morphllm/morphmcp"],
      "env": {
        "MORPH_API_KEY": "${MORPH_API_KEY}",
        "ENABLED_TOOLS": "edit_file,warpgrep_codebase_search",
        "WORKSPACE_MODE": "true"
      }
    }
  }
}
```

**MCP tool naming convention (per AGENTS.md rules):**
```
mcp__plugin_yellow-morph_morph-mcp__edit_file
mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search
```

#### Integration Pattern: MCP Server (Primary)

This is the recommended primary path because:
1. Morph ships an official MCP server package -- zero custom code needed
2. Claude Code automatically prefers MCP tools when available
3. Updates to Morph capabilities roll out via npm without plugin changes
4. Matches the existing pattern used by ruvector, Linear, ChatPRD, and research plugins

#### Integration Pattern: SDK (Secondary, for Custom Agents)

For custom agent logic (e.g., a debt remediation agent that chains WarpGrep search with Fast Apply edits), import the SDK directly:
```typescript
import { MorphClient } from '@morphllm/morphsdk';
```

This would be useful for:
- `yellow-debt` agents that need to search-then-fix in one workflow
- `yellow-review` agents that need to find related code for context
- Any workflow requiring programmatic control over the search/edit pipeline

#### Dependencies and Prerequisites

| Requirement | Purpose | Check |
|-------------|---------|-------|
| `ripgrep` (rg) | WarpGrep local search | `which rg` |
| Node.js 18+ | SDK and MCP server | `node --version` |
| `MORPH_API_KEY` | API authentication | Environment variable |
| Network egress | API calls to morphllm.com | Port 443 |

The `/morph:setup` command should validate all prerequisites, prompt for API key, install the MCP server, and verify connectivity.

#### Licensing Consideration

There is a noted discrepancy in Morph's licensing:
- The open-source Morph framework repo: **Apache-2.0**
- The `@morphllm/morphsdk` npm package: reported as **AGPLv3** in some sources

**Recommendation:** Verify the SDK license before distributing. AGPLv3 has copyleft implications. Since yellow-plugins is MIT-licensed, the plugin would only configure the MCP server (no SDK bundling), avoiding the license concern. The MCP server runs as a separate process, not linked code.

### 9. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| API key management | Medium | Use env vars, never commit; same pattern as DEVIN_SERVICE_USER_TOKEN |
| Data privacy (code sent to API) | Medium | Enterprise ZDR mode; self-hosted option; free tier retains 90 days |
| Vendor lock-in | Low | MCP abstraction; standard tool interface; can swap providers |
| Cost unpredictability | Low | Credit-based model is transparent; free tier for testing |
| AGPLv3 SDK license | Medium | Use MCP server (separate process) rather than bundling SDK |
| WarpGrep requires ripgrep | Low | ripgrep is already standard in most dev environments |
| No "v3" of WarpGrep exists | Informational | Latest is v2; morph-v3-* refers to the underlying model, not WarpGrep version |

## Sources

- [Morph-LLM Official Site](https://morphllm.com) -- Platform overview, benchmarks, pricing
- [Morph-LLM Documentation](https://docs.morphllm.com) -- SDK reference, API docs, MCP quickstart, Claude Code guide
- [Morph SDK Reference](https://docs.morphllm.com/sdk/reference) -- Full SDK API documentation
- [WarpGrep Product Page](https://www.morphllm.com/products/warpgrep) -- WarpGrep capabilities and benchmarks
- [WarpGrep Tool Docs](https://docs.morphllm.com/sdk/components/warp-grep/tool) -- WarpGrep SDK integration
- [WarpGrep v2 Blog Post](https://www.morphllm.com/blog/warpgrep-v2) -- RL training, SWE-Bench Pro results
- [MCP Quickstart](https://docs.morphllm.com/mcpquickstart) -- MCP server setup for Claude Code
- [Claude Code Guide](https://docs.morphllm.com/guides/claude-code) -- Explicit Claude Code integration docs
- [Fast Apply Model](https://morphllm.com/fast-apply-model) -- Architecture and speculative decoding details
- [Morph Benchmarks](https://morphllm.com/benchmarks) -- Performance comparison data
- [Morph Pricing](https://www.morphllm.com/pricing) -- Tier details and credit model
- [Morph Privacy](https://morphllm.com/privacy) -- Enterprise data handling, ZDR mode
- [AWS Case Study](https://aws.amazon.com/solutions/case-studies/morph-case-study/) -- Binance deployment, enterprise infrastructure
- [NPM: @morphllm/morphsdk](https://www.npmjs.com/package/@morphllm/morphsdk) -- SDK package (v0.2.127)
- [OpenRouter: morph-v3-large](https://openrouter.ai/morph/morph-v3-large) -- Model availability on OpenRouter
- [Fly.io Blog: Build Better Agents with MorphLLM](https://fly.io/blog/build-better-agents-with-morphllm/) -- Architecture overview
- [Morph SWE-Bench Pro Results](https://www.morphllm.com/swe-bench-pro) -- WarpGrep impact on benchmark scores
- [Fondo Blog: WarpGrep Launches](https://fondo.com/blog/warpgrep-launches) -- WarpGrep architecture deep-dive
- [Lobehub: Morph WarpGrep Skill](https://lobehub.com/de/skills/letta-ai-skills-morph-warpgrep) -- Community integration example
- [Morph Claude Code Skills/MCP Plugins Page](https://morphllm.com/claude-code-skills-mcp-plugins) -- Official Claude Code plugin guidance
