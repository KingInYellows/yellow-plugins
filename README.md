# yellow-plugins

Personal Claude Code plugin marketplace — 20 plugins for Git workflows, code
review, CI, research, testing, documentation, code editing, security
remediation, and cross-lineage code council.

## Requirements

- Node.js `22.22.0` or later and below `25.0.0`
- pnpm `8.0.0` or later

## Install

Add the marketplace, then install individual plugins:

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install gt-workflow@yellow-plugins
```

## Plugins

| Plugin                | Description                                                                                                                            | Components                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `gt-workflow`         | Graphite-native workflow commands for stacked PRs, smart commits, sync, and stack navigation                                           | 7 commands, 2 hooks, 1 MCP                     |
| `github-workflow`     | GitHub-native stacked-PR provider — full command surface (setup, status, plan, submit, amend, sync, nav, cleanup, merge)               | 9 commands, 9 skills, 2 hooks                  |
| `yellow-browser-test` | Autonomous web app testing with agent-browser — auto-discovery, structured flows, and bug reporting                                    | 3 agents, 4 commands, 2 skills                 |
| `yellow-ci`           | CI failure diagnosis, workflow linting, and runner health management for self-hosted GitHub Actions runners                            | 4 agents, 9 commands, 8 skills, 1 hook         |
| `yellow-codex`        | OpenAI Codex CLI wrapper with review, rescue, and analysis agents for workflow integration                                             | 3 agents, 4 commands, 2 skills                 |
| `yellow-composio`     | Composio MCP integration with usage tracking and budget guardrails                                                                     | 2 commands, 1 skill, 1 MCP                     |
| `yellow-core`         | Dev toolkit with review agents, research agents, and workflow commands for TS/Py/Rust/Go                                               | 21 agents, 19 commands, 23 skills              |
| `yellow-council`      | On-demand cross-lineage code review fanning out to an in-process Claude reviewer plus the Codex, Gemini, and OpenCode CLIs in parallel | 3 agents, 2 commands, 1 skill                  |
| `yellow-cursor`       | Cursor Cloud Agent delegation — launch, track, and manage remote coding agents via a typed CLI (pilot Cursor distribution target)      | 10 commands, 2 skills                          |
| `yellow-debt`         | Technical debt audit and remediation with parallel scanner agents for AI-generated code patterns                                       | 7 agents, 6 commands, 2 skills, 1 hook         |
| `yellow-devin`        | Devin.AI V3 API integration — delegate tasks, manage sessions, orchestrate plan-implement-review chains (legacy — see yellow-cursor)   | 1 agent, 9 commands, 1 skill, 1 MCP            |
| `yellow-jules`        | Google Jules integration (experimental) — delegate, supervise, and review sessions under owner-written grants (Codex reference skills)  | 10 commands, 2 skills                          |
| `yellow-docs`         | Documentation audit, generation, and Mermaid diagram creation for any repository                                                       | 10 agents, 6 commands, 2 skills                |
| `yellow-goal`         | Process bridge to the yellow-goal `goal-gen` engine (setup/request, stub run, approval-gated real run that may spend)                  | 4 commands                                     |
| `yellow-linear`       | Linear MCP integration with PM workflows for issues, projects, initiatives, cycles, and documents                                      | 3 agents, 9 commands, 1 skill, 1 MCP           |
| `yellow-morph`        | Intelligent code editing and search via Morph Fast Apply and WarpGrep                                                                  | 2 commands, 1 MCP                              |
| `yellow-research`     | Deep research with Ceramic, DeepWiki, Perplexity, Tavily, EXA, and Parallel Task MCPs                                                  | 2 agents, 4 commands, 3 skills, 6 MCPs         |
| `yellow-review`       | Multi-agent PR review with adaptive agent selection, parallel comment resolution, and stack review                                     | 16 agents, 8 commands, 2 skills                |
| `yellow-ruvector`     | Persistent vector memory and semantic code search for Claude Code agents via ruvector                                                  | 2 agents, 8 commands, 3 skills, 4 hooks, 1 MCP |
| `yellow-semgrep`      | Semgrep security finding remediation — fetch, fix, and verify "to fix" findings from the Semgrep platform                              | 2 agents, 5 commands, 1 skill, 1 MCP           |

## Codex Distribution

The private/local Codex catalog selects nine plugins and 29 skills. The six new
workflow slices are worktree inventory, documentation audit, complexity scan,
public DeepWiki research, offline Cursor planning and local Codex readiness. See
the exact support, setup, cache-refresh and unsupported states in
[Codex distribution](docs/codex-distribution.md). WSL CLI evidence does not
establish Windows desktop support. Claude command/setup behavior stays separate.

## Cursor Distribution (pilot)

`yellow-cursor` is also generated as a native Cursor plugin
(`.cursor-plugin/plugin.json` + a listing in the root
`.cursor-plugin/marketplace.json`), alongside its normal Claude Code install
path. `yellow-review` is the second Cursor-enabled plugin, exposing a single
read-only skill (`yellow-thermonuclear-review`) and nothing else. Cursor support
is **explicit opt-in per plugin** — this repo does not claim repository-wide
Cursor support. See [docs/cursor-distribution.md](docs/cursor-distribution.md)
for the full opt-in model, generated-artifact shape, and verification status.

## MCP Servers & Authentication

Eight plugins bundle MCP servers. Authentication requirements vary by server.

| Plugin            | MCP Server | Auth                                                                                                                                         |
| ----------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `gt-workflow`     | Graphite   | Local stdio (`gt mcp`) — requires Graphite CLI login                                                                                         |
| `yellow-composio` | Composio   | Browser OAuth on `https://connect.composio.dev/mcp` (native HTTP, no API key). Headless `claude mcp add` with a consumer key is the fallback |
| `yellow-devin`    | Devin      | `DEVIN_SERVICE_USER_TOKEN` & `DEVIN_ORG_ID` required                                                                                         |
| `yellow-linear`   | Linear     | OAuth (browser popup on first use)                                                                                                           |
| `yellow-morph`    | Morph      | `MORPH_API_KEY` required                                                                                                                     |
| `yellow-research` | Ceramic    | OAuth (browser popup on first `ceramic_search` use)                                                                                          |
| `yellow-research` | DeepWiki   | None (public repos only)                                                                                                                     |
| `yellow-research` | Perplexity | `PERPLEXITY_API_KEY` required                                                                                                                |
| `yellow-research` | Tavily     | `TAVILY_API_KEY` required                                                                                                                    |
| `yellow-research` | EXA        | `EXA_API_KEY` required                                                                                                                       |
| `yellow-research` | Parallel   | No API key — auto-authenticated by Claude Code                                                                                               |
| `yellow-ruvector` | ruvector   | Local stdio — no auth required                                                                                                               |
| `yellow-semgrep`  | semgrep    | `SEMGREP_APP_TOKEN` required                                                                                                                 |

`yellow-review` bundles no MCP server but can reach one. When the optional
`yellow-linear` plugin is installed, its `save_issue` tool is discoverable, and
the branch name carries a Linear ID, `/review:resolve` in `yellow-review` uses
`yellow-linear`'s OAuth-backed Linear MCP server for reads, marker searches and
follow-up issue creation. It writes to Linear only in that case, and
authentication is the `yellow-linear` login above. If any condition is missing,
or a Linear call fails, follow-ups are filed on GitHub instead. See "Optional
integrations" in `plugins/yellow-review/README.md`.

### Context7 (user-level MCP)

Provides up-to-date library documentation for LLMs. Works without an API key but
with lower rate limits.

**Free (no key):** Works out of the box. The plugin connects to
`https://mcp.context7.com/mcp` with no configuration needed.

**Free API key (higher rate limits):** Create an account at
[context7.com/dashboard](https://context7.com/dashboard) and generate an API key
(format: `ctx7sk_...`). Then configure it in your Claude Code settings:

```bash
# In Claude Code, run /mcp → select context7 → edit config → add header:
# "headers": { "CONTEXT7_API_KEY": "ctx7sk_your_key_here" }
```

### DeepWiki (yellow-research)

Works out of the box at `https://mcp.deepwiki.com/mcp`. No authentication needed
— public repositories only, no private-repo path. `/devin:wiki` (yellow-devin)
still queries it as a backward-compatible fallback, discovering the tool at its
current location at runtime.

### Devin (yellow-devin)

Devin sessions require a `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID`.

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export DEVIN_SERVICE_USER_TOKEN="cog_your_token_here"
export DEVIN_ORG_ID="your-org-id"

# Create a service user at: Enterprise Settings > Service Users
# Find your org ID at: Enterprise Settings > Organizations
```

Never commit tokens to version control.

### Linear (OAuth)

On first MCP tool call, Claude Code opens a browser popup to authenticate with
your Linear account. Tokens are stored in your system keychain and refresh
automatically.

To re-authenticate or revoke access: run `/mcp` in Claude Code, select the
server, and choose "Clear authentication".

With Graphite's merge queue, Linear moves an issue to Done only through
commit magic words, which needs a one-time GitHub push webhook from Linear's
GitHub integration. The plugin never sees that webhook's secret; the setup
steps are in `plugins/yellow-linear/README.md` "Graphite Merge Queue".

These plugins require browser access and **will not work in headless SSH
sessions**.

### Morph (yellow-morph)

Morph runs as a local MCP server via `npx` and requires a `MORPH_API_KEY`.

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export MORPH_API_KEY="your_key_here"
```

Restart Claude Code after setting the key, then run `/morph:setup` to verify API
health and tool availability.

### yellow-research (API keys)

Bundles six MCP servers for multi-source deep research. Three search providers
require API keys. Ceramic and Parallel use OAuth managed by Claude Code (no
API key), and DeepWiki needs none. The optional `ast-grep` CLI is a local
binary, not an MCP server.

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export PERPLEXITY_API_KEY="pplx-..."
export TAVILY_API_KEY="tvly-..."
export EXA_API_KEY="..."
```

Source or restart your shell, then restart Claude Code — MCP servers read
environment variables at startup.

- **Perplexity:**
  [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api)
- **Tavily:** [app.tavily.com](https://app.tavily.com)
- **EXA:** [dashboard.exa.ai](https://dashboard.exa.ai)
- **Ceramic:** No API key needed for the MCP — OAuth 2.1 (browser popup on first
  `ceramic_search` use)
- **Parallel Task MCP:** No API key needed — Claude Code handles authentication
  automatically
- **ast-grep CLI (optional):** No API key needed — install the `ast-grep` binary
  locally or run `/research:setup`

Plugins degrade gracefully: if a key is missing, that provider is skipped and
research continues with the remaining sources.

### Semgrep (yellow-semgrep)

Semgrep runs as a local MCP server and also requires a Semgrep AppSec Platform
API token:

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export SEMGREP_APP_TOKEN="sgp_your_token_here"
```

The plugin also expects the `semgrep` CLI, `curl`, `jq`, and Graphite CLI
(`gt`). Run `/semgrep:setup` to validate credentials, detect your deployment
slug, and verify MCP tools.

### Jev shadow pre-filter (yellow-core, optional)

yellow-core's Stop hook can ask TypeSafe's Jev model whether a finished session
looks worth staging for knowledge capture, and log the answer without changing
what is staged. It is off unless both variables are set in the environment
Claude Code's hooks inherit, and it sends redacted session text to TypeSafe:

```bash
export COMPOUND_JEV_PREFILTER=shadow
export TYPESAFE_API_KEY="..."
```

See `docs/security.md` "Jev Shadow Pre-Filter" for exactly what is sent.

### ruvector (yellow-ruvector)

Runs locally as a stdio MCP server through the plugin's own launcher, which
installs the pinned ruvector into the plugin data directory on first use (no
global or `npx` install; the first run needs network for the npm packages and
the ~90MB embedding model). Requires Node.js 20+. No external services or API
keys required. Run `/ruvector:setup` to install ahead of time and initialize the
project's `.ruvector/` store.

### yellow-goal (process bridge)

`/goal:setup`, `/goal:request`, and `/goal:run-stub` stay zero-spend. The
fourth command, `/goal:run-real`, is user-only: it displays the engine
manifest, forwards an operator-supplied approval path, and may spend. Default
`--auth-mode subscription` uses the operator Claude Code login.
`--auth-mode api-key` forwards `ANTHROPIC_API_KEY` from the environment.
Never commit that key. Put the pinned `goal-gen` binary on PATH, then run
`/goal:setup`.

## Usage

After installing, use `/plugin install <name>@yellow-plugins` to activate
individual plugins. Each plugin's commands are namespaced (e.g., `/ci:diagnose`,
`/linear:create`, `/devin:delegate`, `/research:deep`, `/morph:status`,
`/semgrep:fix`).

Run `/plugin` to browse all available plugins in the Discover tab.

## Update, Disable, Remove

```
/plugin marketplace update yellow-plugins
/plugin disable <plugin-name>@yellow-plugins
/plugin uninstall <plugin-name>@yellow-plugins
```

## Local Install (Development)

Clone the repo and add it as a local marketplace:

```bash
git clone https://github.com/KingInYellows/yellow-plugins.git
cd yellow-plugins
pnpm install
```

Then in Claude Code:

```
/plugin marketplace add ./
/plugin install gt-workflow@yellow-plugins
```

Verify `${CLAUDE_PLUGIN_ROOT}` resolves correctly after local install — local
installs copy plugins to `~/.claude/plugins/cache/`.

## Create a New Plugin

A new plugin lives under `plugins/`:

```text
plugins/my-plugin/
  .claude-plugin/
    plugin.json      # generated — do not create by hand
  commands/
    my-command.md
  CLAUDE.md
  package.json
```

`package.json` (`"name"` + semver `version` + `"private": true`) and
`catalog/plugins/my-plugin.json` are the two files you write by hand;
`pnpm generate:manifests` emits `plugin.json` and the marketplace entry from
them. The full numbered procedure (catalog fields, `pluginOrder`, `setup/all.md`
wiring, the lockfile/changeset/validation steps) lives in
[CONTRIBUTING.md "Adding a Plugin"](CONTRIBUTING.md#adding-a-plugin) — that is
the canonical checklist; `docs/plugin-template.md` has the full worked example
with concrete JSON.

See each plugin's `CLAUDE.md` for conventions, component details, and usage
guides.

## Project Structure

```
yellow-plugins/
├── .claude-plugin/
│   └── marketplace.json       # Plugin catalog
├── plugins/
│   ├── gt-workflow/           # Graphite workflow (7 commands, 2 hooks, 1 MCP)
│   ├── github-workflow/       # GitHub-native stacked-PR provider (9 commands, 9 skills, 2 hooks)
│   ├── yellow-browser-test/   # Browser testing (3 agents, 4 commands, 2 skills)
│   ├── yellow-ci/             # CI toolkit (4 agents, 9 commands, 8 skills, 1 hook)
│   ├── yellow-codex/          # Codex CLI wrapper (3 agents, 4 commands, 1 skill)
│   ├── yellow-composio/       # Composio MCP (2 commands, 1 skill, 1 MCP)
│   ├── yellow-core/           # Dev toolkit (21 agents, 19 commands, 22 skills)
│   ├── yellow-council/        # Cross-lineage code council (3 agents, 2 commands, 1 skill)
│   ├── yellow-cursor/         # Cursor Cloud Agent delegation, pilot target (10 commands, 1 skill)
│   ├── yellow-debt/           # Debt audit (7 agents, 6 commands, 1 skill, 1 hook)
│   ├── yellow-devin/          # Devin.AI, legacy (1 agent, 9 commands, 1 skill, 1 MCP)
│   ├── yellow-docs/           # Documentation (10 agents, 6 commands, 1 skill)
│   ├── yellow-goal/           # yellow-goal engine bridge (4 commands)
│   ├── yellow-jules/          # Google Jules, experimental, grant-gated (10 commands, 2 skills)
│   ├── yellow-linear/         # Linear PM (3 agents, 9 commands, 1 skill, 1 MCP)
│   ├── yellow-morph/          # Morph code editing and search (2 commands, 1 MCP)
│   ├── yellow-research/       # Deep research (2 agents, 4 commands, 2 skills, 7 MCPs)
│   ├── yellow-review/         # PR review (16 agents, 8 commands, 2 skills)
│   ├── yellow-ruvector/       # Vector memory (2 agents, 8 commands, 3 skills, 4 hooks, 1 MCP)
│   └── yellow-semgrep/        # Semgrep remediation (2 agents, 5 commands, 1 skill, 1 MCP)
├── packages/                  # Validation tooling (domain, infrastructure, cli)
├── schemas/                   # JSON schemas
└── docs/                      # Validation guides, operational docs, and solutions
```

## Troubleshooting

### `claude doctor` says "descriptions dropped"

If `claude doctor` shows a warning like
`157 descriptions dropped (4.9%/1% of context)`, your skill listing budget is
too small for the total skill descriptions installed across all your plugins.
This is a **per-user Claude Code setting**, not a plugin problem —
yellow-plugins skill descriptions are well under the official 1,536-char
per-skill cap (per
[code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)).

The default budget is 1% of the context window, with an 8,000-character
fallback. Two ways to give Claude Code more room:

1. **Raise `skillListingBudgetFraction`** — edit `~/.claude/settings.json`:

   ```jsonc
   {
     "skillListingBudgetFraction": 0.04,
   }
   ```

   `0.04` (4%) is enough to fit the full yellow-plugins marketplace plus typical
   adjacent installs, at the cost of roughly 8K extra characters reserved from
   the per-session context window. Note: this setting is community-discovered
   (decompiled from Claude Code 2.1.129) and not yet in the official docs — it
   may be renamed before public documentation.

2. **Set `SLASH_COMMAND_TOOL_CHAR_BUDGET`** as an environment variable for a
   one-off raise without editing settings. Default is 15,000 characters; set
   higher (e.g. `SLASH_COMMAND_TOOL_CHAR_BUDGET=40000`) to fit larger skill
   listings.

(Disabling skills via `/skills` or `skillOverrides` is intentionally omitted:
those knobs apply to user-scoped skills, not plugin-provided skills, and would
not reduce yellow-plugins' contribution to the budget.)

The warning is informational — Claude Code drops the lowest-priority
descriptions first. Critical skills you use frequently stay listed.

## License

MIT
