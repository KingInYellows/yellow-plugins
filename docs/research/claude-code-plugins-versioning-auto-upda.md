# Claude Code Plugin Versioning and Auto-Update Mechanisms

**Date:** 2026-03-03
**Sources:** Anthropic Official Docs (code.claude.com), Perplexity Deep Research, Tavily Web Search, GitHub Issues (anthropics/claude-code), community articles (workingbruno.com, medium.com)

---

## Summary

Claude Code's plugin system uses a multi-layered versioning model: plugins declare their version in a `.claude-plugin/plugin.json` manifest using semantic versioning, marketplaces distribute and catalog plugins via `marketplace.json` (supporting GitHub, npm, git URL, and local path sources), and the auto-update mechanism works by comparing installed commit SHAs or semantic versions against what is current in the marketplace. As of Claude Code v2.0.70+, native per-marketplace auto-update is supported, but third-party marketplace auto-pulls still have documented bugs. The critical rule is: **if you do not bump the version in `plugin.json` (or `marketplace.json`), users will not receive updates due to caching**.

---

## Key Findings

### 1. How the Installation and Auto-Update Mechanism Works

Claude Code maintains a **plugin cache** at `~/.claude/plugins/cache/` and a marketplace clone directory at `~/.claude/plugins/marketplaces/<name>/`. Two tracking files control the system:

- `~/.claude/plugins/installed_plugins.json` — records installed plugin name, cache path, `gitCommitSha`, `installedAt` timestamp, and version
- `~/.claude/plugins/known_marketplaces.json` — records marketplace source, `lastUpdated` timestamp, `autoUpdate` flag, and `installLocation`

**The official Anthropic marketplace** (`claude-plugins-official`) is pulled on every session start. **Third-party marketplaces** are only auto-pulled on the initial installation day — this is a documented bug (GitHub issue #26744, filed Feb 2026). The workaround until the fix ships is to manually `git pull` inside `~/.claude/plugins/marketplaces/<your-marketplace>/` and then run `/plugin update <plugin>@<marketplace>`.

**Update detection** works by comparing the installed `gitCommitSha` in `installed_plugins.json` against the latest commit SHA at the marketplace's `ref` (branch or tag). For npm-sourced plugins, semver range resolution is used instead. If the SHAs or versions match, no update occurs.

**Background auto-updates** run at startup without interactive credential helpers. For private repositories this requires setting an environment token:

```bash
export GITHUB_TOKEN=<your-token>       # GitHub
export GITLAB_TOKEN=<your-token>       # GitLab
export BITBUCKET_TOKEN=<your-token>    # Bitbucket (app password)
```

### 2. Versioning Conventions for Claude Code Plugins

**Semantic versioning (semver) is the official and only supported convention.** The format is `MAJOR.MINOR.PATCH`:

- **MAJOR**: Breaking changes (incompatible API/interface changes)
- **MINOR**: New features (backward-compatible additions)
- **PATCH**: Bug fixes (backward-compatible)

Pre-release suffixes are supported: `2.0.0-beta.1`, `1.5.0-rc.1`.

The version appears in **one of two places** — you should pick one and be consistent:

1. `.claude-plugin/plugin.json` (the plugin manifest, wins over marketplace if both are set)
2. The plugin's entry in `marketplace.json` (recommended for relative-path plugins in the same repo)

**Critical warning from official docs:**

> "If you change your plugin's code but don't bump the version in `plugin.json`, your plugin's existing users won't see your changes due to caching."

**Another critical finding from community issue #36 (`affaan-m/everything-claude-code`):**

> If `marketplace.json` contains a `metadata.version` or a per-plugin `version` field, Claude Code uses that version string to construct the cache path (`~/.claude/plugins/cache/<name>/1.0.0/`). As long as that version string stays the same, `/plugin update` will not fetch changes. The **official Anthropic plugins do not have version fields in `marketplace.json`** — they rely entirely on git SHA comparison for update detection.

This is a subtle but important distinction: for **git-sourced plugins**, omitting the version from `marketplace.json` and relying on SHA comparison is more reliable for auto-updates than using explicit version fields.

### 3. The `claude mcp add` Command and MCP Server Versioning

`claude mcp add` manages **MCP servers** (individual tool connections), not Claude Code plugins. These are separate concepts:

- **Plugins**: bundles of skills, agents, hooks, MCP servers distributed through marketplaces
- **MCP servers**: individual protocol servers added directly to Claude's tool list via `claude mcp add`

For MCP servers via `claude mcp add`, versioning is handled entirely by **npm** or the binary's own distribution mechanism. Version is encoded in the command args:

```bash
# Pin to latest
claude mcp add myserver -- npx -y @company/mcp-server@latest

# Pin to a specific semver range
claude mcp add myserver -- npx -y @company/mcp-server@^2.0.0

# Pin to exact version
claude mcp add myserver -- npx -y @company/mcp-server@2.1.0
```

The `--` separator is mandatory — all flags (`--transport`, `--env`, `--scope`, `--header`) must come before the server name.

These configurations are written to:

| Scope | File |
|-------|------|
| `user` | `~/.claude.json` |
| `project` | `.mcp.json` at project root |
| `local` | `.claude/settings.local.json` |

For **MCP servers embedded inside a plugin**, the config lives in the plugin's `.mcp.json` or inline in `plugin.json`:

```json
{
  "mcpServers": {
    "plugin-api": {
      "command": "npx",
      "args": ["-y", "@company/mcp-server@^2.0.0", "--plugin-mode"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is the mandatory environment variable for referencing files within the plugin's cache directory.

### 4. Plugin Manifest (`plugin.json`) Structure

Located at `.claude-plugin/plugin.json`, the manifest is **optional** — Claude Code auto-discovers components in default directories (`commands/`, `agents/`, `skills/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`). Use the manifest when you need metadata or custom paths.

**Complete schema:**

```json
{
  "name": "my-plugin",
  "version": "2.1.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "commands": ["./custom/commands/special.md"],
  "agents": "./custom/agents/",
  "skills": "./custom/skills/",
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json"
}
```

**Required fields:** only `name` (if manifest is present at all).
**Version priority:** `plugin.json` version wins over `marketplace.json` version silently.

### 5. Plugin Marketplace (`marketplace.json`) and Auto-Fetch

**Location:** `.claude-plugin/marketplace.json` in the marketplace repository root.

**Full schema with versioning options:**

```json
{
  "name": "company-tools",
  "owner": {
    "name": "DevTools Team",
    "email": "devtools@example.com"
  },
  "metadata": {
    "description": "Internal development tools",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",
      "description": "Automatic code formatting",
      "version": "2.1.0"
    },
    {
      "name": "deploy-tools",
      "source": {
        "source": "github",
        "repo": "company/deploy-plugin",
        "ref": "v2.1.0",
        "sha": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
      },
      "description": "Deployment automation"
    },
    {
      "name": "npm-plugin",
      "source": {
        "source": "npm",
        "package": "@company/claude-plugin",
        "version": "^2.0.0"
      }
    },
    {
      "name": "gitlab-plugin",
      "source": {
        "source": "url",
        "url": "https://gitlab.com/team/plugin.git",
        "ref": "main"
      }
    }
  ]
}
```

**Source types and their version semantics:**

| Source type | Version mechanism | Auto-update trigger |
|-------------|-------------------|---------------------|
| Relative path (`"./plugins/foo"`) | Version in `marketplace.json` or `plugin.json` | SHA comparison on git pull |
| `github` | `ref` (branch/tag) + optional `sha` | New commit at `ref`, or `sha` mismatch |
| `url` (git URL ending `.git`) | `ref` + optional `sha` | Same as github |
| `npm` | `version` semver range | npm resolves newer satisfying version |
| `pip` | `version` semver range | pip resolves newer version |

### 6. How Auto-Fetching/Updating Is Triggered

The auto-update flow (as of v2.0.70+) is:

1. **Session start**: Claude Code checks `known_marketplaces.json` for marketplaces with `autoUpdate: true`
2. **Git pull**: For git-sourced marketplaces, Claude Code runs `git pull` on the marketplace clone at `~/.claude/plugins/marketplaces/<name>/`
3. **Version comparison**: For each installed plugin, compare the stored `gitCommitSha` against the current commit at the configured `ref`
4. **Cache invalidation**: If a new commit is detected AND the `version` in `plugin.json` has changed, the plugin is re-downloaded to a new cache directory
5. **Cache path construction**: Path is `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`

**The version bump is the trigger.** Without it, even if new commits exist, the cache is not invalidated.

For **manual update**:

```bash
claude plugin update my-plugin@my-marketplace
# or inside Claude Code:
/plugin update my-plugin@my-marketplace
```

For **manual marketplace refresh** (refreshes the catalog, not installed plugins):

```bash
/plugin marketplace update
```

### 7. Distribution Requirements: GitHub, npm, and Git

**Recommended distribution path: GitHub repository**

```
my-marketplace-repo/
├── .claude-plugin/
│   └── marketplace.json        # Marketplace catalog
└── plugins/
    ├── my-plugin/
    │   ├── .claude-plugin/
    │   │   └── plugin.json     # Plugin manifest with version
    │   ├── skills/
    │   │   └── my-skill/
    │   │       └── SKILL.md
    │   ├── agents/
    │   ├── commands/
    │   ├── hooks/
    │   │   └── hooks.json
    │   └── .mcp.json
    └── another-plugin/
        └── ...
```

Users install with:

```bash
/plugin marketplace add your-org/your-marketplace-repo
/plugin install my-plugin@your-marketplace-repo-name
```

**For npm distribution:**

The `package.json` should include the `.claude-plugin/` directory and all plugin component directories in `files`:

```json
{
  "name": "@company/my-claude-plugin",
  "version": "2.1.0",
  "description": "Claude Code plugin for team workflows",
  "type": "module",
  "files": [
    ".claude-plugin",
    "skills",
    "agents",
    "commands",
    "hooks",
    ".mcp.json",
    ".lsp.json"
  ],
  "keywords": ["claude-code", "plugin"],
  "repository": {
    "type": "git",
    "url": "https://github.com/company/my-claude-plugin"
  },
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  }
}
```

Reference from `marketplace.json`:

```json
{
  "name": "my-npm-plugin",
  "source": {
    "source": "npm",
    "package": "@company/my-claude-plugin",
    "version": "^2.0.0"
  }
}
```

**For Desktop Extensions (MCPB) — Claude Desktop auto-update path:**

This is a separate distribution system from the Claude Code plugin marketplace. MCPB bundles are `.mcpb` files (formerly `.dxt`) that include a `manifest.json`:

```json
{
  "mcpb_version": "0.1",
  "name": "my-extension",
  "version": "1.2.0",
  "author": { "name": "Author Name" },
  "server": {
    "type": "node",
    "entry": "./dist/index.js"
  }
}
```

Extensions from the **official Anthropic directory** update automatically. Privately distributed MCPB files require manual reinstallation of updated `.mcpb` files. Package with `mcpb pack`.

### 8. The Role of `mcp.json`, `CLAUDE.md`, `package.json` in Plugin Versioning

| File | Role in Versioning |
|------|-------------------|
| `.claude-plugin/plugin.json` | **Primary version authority** for the plugin. Must be bumped for cache invalidation and update detection. |
| `.claude-plugin/marketplace.json` | **Marketplace catalog** — lists plugins with their sources and optional version overrides. Version here is overridden by `plugin.json` if both are set. |
| `.mcp.json` (in plugin root) | Defines MCP servers bundled with the plugin. Contains npm `@version` specifiers for npm-distributed servers. Not directly a versioning file but pins MCP server versions. |
| `package.json` | Required for npm distribution. `version` field here is what npm publishes and what marketplace `source.version` resolves against. Must stay in sync with `plugin.json` version. |
| `CLAUDE.md` | Project context instructions; no role in versioning. |
| `~/.claude.json` | User-scope MCP server configs (written by `claude mcp add`). Stores npm version specifiers like `@latest`. |
| `settings.json` (`.claude/settings.json`) | `enabledPlugins` map and `extraKnownMarketplaces` source configs. Not versioning per se, but `extraKnownMarketplaces` specifies the `ref` for fetching marketplace itself. |
| `installed_plugins.json` | Internal tracking file. Stores `gitCommitSha` and installed version. **Not edited by developers.** |
| `known_marketplaces.json` | Internal tracking file. Stores `autoUpdate` flag and `lastUpdated` per marketplace. **Not edited by developers.** |

### 9. Known Bugs and Workarounds (as of March 2026)

| Bug | Status | Workaround |
|-----|--------|-----------|
| Third-party marketplaces don't auto-pull on session start (only official marketplace does) | Open — GitHub #26744 | `cd ~/.claude/plugins/marketplaces/<name> && git pull`, then `/plugin update <plugin>@<marketplace>` |
| Plugin cache not invalidated when marketplace updates (#13799) | Closed as duplicate | Uninstall and reinstall: `/plugin uninstall`, `rm -rf ~/.claude/plugins/cache/<name>`, `/plugin install` |
| `version` field in `marketplace.json` prevents auto-updates (#36 in affaan-m/everything-claude-code) | Fixed in that repo by removing version fields | Remove `metadata.version` and per-plugin `version` from `marketplace.json`; rely on SHA comparison |
| `installed_plugins.json` shows "unknown" version after reinstall (#17032) | Open | Re-check version in `plugin.json` before reinstalling |
| Skills loading twice (symlink duplicates) | Widespread community report | See Reddit PSA thread; fix `installed_plugins.json` paths |
| npm-based Claude Code installation breaks Claude Code's own auto-update | Resolved — use native installer | `curl -fsSL https://claude.ai/install.sh \| bash` then `npm uninstall -g @anthropic-ai/claude-code` |

### 10. Release Channel Setup and Concrete Recommendations

**For a plugin that should auto-update reliably:**

1. **Never set `version` in `marketplace.json`** for git-sourced plugins (relative path, github, url). Rely on SHA comparison.
2. **Always bump `version` in `plugin.json`** before pushing changes. This is what invalidates the cache.
3. Use a **git tag** as the `ref` for stable releases: `"ref": "v2.1.0"`. Use a branch name for rolling updates: `"ref": "main"`.
4. For stable + beta channels, create **two marketplace entries** pointing to different refs:

```json
// stable-marketplace/.claude-plugin/marketplace.json
{ "plugins": [{ "name": "my-tool", "source": { "source": "github", "repo": "org/my-tool", "ref": "stable" } }] }

// beta-marketplace/.claude-plugin/marketplace.json
{ "plugins": [{ "name": "my-tool", "source": { "source": "github", "repo": "org/my-tool", "ref": "main" } }] }
```

5. **Automate version bumps** with Release Please or a simple CI script that increments `plugin.json` version on each merge to main.

**Recommended GitHub Actions workflow for automated release:**

```yaml
# .github/workflows/release.yml
name: Release Plugin
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          release-type: node

      # If npm distribution:
      - name: Publish to npm
        if: ${{ steps.release.outputs.release_created }}
        run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # Always: tag so marketplace ref stays current
      - name: Create git tag
        if: ${{ steps.release.outputs.release_created }}
        run: |
          git tag v${{ steps.release.outputs.major }}.${{ steps.release.outputs.minor }}.${{ steps.release.outputs.patch }}
          git push origin --tags
```

6. **For team distribution**, check `marketplace.json` into version control and configure auto-installation via `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "our-tools": {
      "source": {
        "source": "github",
        "repo": "your-org/claude-plugins"
      }
    }
  },
  "enabledPlugins": {
    "code-formatter@our-tools": true,
    "deploy-tools@our-tools": true
  }
}
```

7. **Validate before shipping:**

```bash
claude plugin validate .        # from marketplace or plugin directory
/plugin validate .              # from inside Claude Code
```

---

## Sources

- [Plugins Reference — Claude Code Docs](https://code.claude.com/docs/en/plugins-reference) — Official schema for `plugin.json`, version management rules, CLI commands, caching behavior
- [Create and Distribute a Plugin Marketplace — Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces) — Official `marketplace.json` schema, source types, auto-update config, release channels, managed restrictions
- [Claude Desktop Extensions (MCPB) — Anthropic Engineering](https://www.anthropic.com/engineering/desktop-extensions) — MCPB `manifest.json` format, auto-update for Desktop extensions
- [Third-party marketplace plugins don't auto-update — GitHub #26744](https://github.com/anthropics/claude-code/issues/26744) — Confirmed bug: only official marketplace auto-pulls on session start
- [marketplace.json version field prevents auto-updates — GitHub #36](https://github.com/affaan-m/everything-claude-code/issues/37/linked_closing_reference) — Key finding: version in `marketplace.json` breaks auto-update via cache path pinning
- [Plugin cache not invalidated when marketplace updates — GitHub #13799](https://github.com/anthropics/claude-code/issues/13799) — Bug report on stale cache path in `installed_plugins.json`
- [Plugin cache never refreshes — GitHub #17361](https://github.com/anthropics/claude-code/issues/17361) — Documented: `autoUpdate: true` pulls git but doesn't rebuild cache
- [Keeping Claude Code Plugins Up to Date — workingbruno.com](https://workingbruno.com/notes/keeping-claude-code-plugins-date) — Community analysis of update system mechanics; notes v2.0.70 added native auto-update
- [Claude Code Marketplace: Standardizing Development Across Teams — Medium](https://medium.com/@rana.ashutosh/claude-code-marketplace-standardizing-development-across-teams-78652459c958) — Practical team marketplace guide
- [Perplexity Deep Research](https://www.perplexity.ai) — Synthesis of official docs, npm versioning patterns, marketplace architecture
- [Smithery.ai Marketplace Manager Skill](https://smithery.ai/skills/jeremylongshore/marketplace-manager) — Community-sourced marketplace schema requirements
- [jeremylongshore/claude-code-plugins-plus-skills — GitHub](https://github.com/jeremylongshore/claude-code-plugins-plus-skills) — Community marketplace example with sync scripts
- [claude-plugins-official marketplace.json — GitHub (Anthropic)](https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json) — Official marketplace reference: no version fields, uses `source.url` pattern
- [PSA: Skills loading twice — Reddit r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1rij9tr/psa_your_claude_code_plugins_are_probably_loading/) — Community discovery of `installed_plugins.json` corruption patterns
