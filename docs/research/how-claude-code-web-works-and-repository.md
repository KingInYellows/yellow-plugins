# Claude Code Web: How It Works and How to Configure Repositories for It

**Date:** 2026-05-18
**Sources:** code.claude.com/docs (official, multiple pages), docs.anthropic.com, EXA deep research (exa-research-pro), Perplexity deep research (sonar), Tavily pro research

---

## TL;DR

- **Ephemeral Ubuntu 24.04 VMs, fresh clone per session.** Each run gets 4 vCPUs / 16 GB RAM / ~30 GB disk. Sessions are isolated per task; anything not committed to git is gone when the session ends. A filesystem snapshot cache from a setup script survives ~7 days before it is rebuilt.
- **Everything the web agent can use must live in the repository.** User-level configs (`~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `claude mcp add` entries that wrote to `~/.claude.json`) are not accessible. Project-committed files — `.mcp.json`, `.claude/settings.json`, `.claude/rules/`, `agents/`, `skills/`, `commands/` — are all loaded. Plugins declared in the repo's `.claude/settings.json` are installed at session start.
- **STDIO MCP servers do not work in the web sandbox.** Only HTTP and SSE (Streamable HTTP) transports are reachable. Any MCP server wired via `claude mcp add --transport stdio` that only wrote to the user scope will not be available.
- **No dedicated secrets store yet.** Secrets are set as environment variables in the cloud environment UI (per environment, not per repo). Interactive auth (AWS SSO, browser OAuth flows) cannot run in the sandbox. For CI via GitHub Actions, `ANTHROPIC_API_KEY` goes into GitHub repository secrets.
- **A `setup:claude-web` command should focus on four things:** scaffolding `.claude/settings.json` with a `SessionStart` hook pointing to a bootstrap script; writing an idempotent `scripts/install_pkgs.sh` gated on `CLAUDE_CODE_REMOTE=true`; auditing `.mcp.json` for STDIO-only servers; and ensuring plugins and their required env vars are declared at project scope.
- **Many important details are confirmed by official docs; a short list of specifics require empirical testing** — notably the exact byte-level CLAUDE.md size limit, whether docker-in-docker actually works end-to-end, and the precise behavior of branch protection rules with Auto-fix.

---

## Part A — How Claude Code Web Actually Works

### A.1 Product Surface and Access Model

Claude Code Web is the browser-hosted execution surface for Claude Code, accessible at `https://claude.ai/code`. As of May 2026 it is available to users on **Claude Pro, Max, Team, and Enterprise** plans (Enterprise requires premium or Chat + Claude Code seats). The agent can be invoked:

- Directly from the browser at `claude.ai/code`
- Via the local CLI with `claude --remote` to push a task to a cloud session
- Via the `/schedule` command for periodic tasks
- Via the mobile app (iOS/Android) to monitor and review running sessions
- Via the GitHub Actions workflow using `anthropics/claude-code-action`

**GitHub authentication** is established via one of two paths — the **Claude GitHub App** (recommended for teams, required for Auto-fix) or the **`/web-setup` command** which syncs a local `gh` CLI token to the account. Both grant access to all repositories the linked GitHub account can see; access is constrained by GitHub team/repo membership, not by a separate Claude-level allowlist. Team and Enterprise admins can disable `/web-setup` in `claude.ai/admin-settings/claude-code`. Organizations with Zero Data Retention enabled cannot use cloud session features at all.

Sources: [code.claude.com/docs/en/claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web), [code.claude.com/docs/en/web-quickstart](https://code.claude.com/docs/en/web-quickstart)

---

### A.2 Execution Environment

Each cloud session runs in a **fresh Anthropic-managed VM** provisioned on demand. Key specs confirmed by official docs:

| Property | Value |
|---|---|
| OS | Ubuntu 24.04 |
| vCPUs | 4 |
| RAM | 16 GB |
| Disk | ~30 GB ephemeral |
| Session inactivity timeout | Session terminates; conversation history restored on reopen |
| Setup script timeout | **5 minutes** — if exceeded, cache build fails |

**Pre-installed tooling** (official docs, `code.claude.com/docs/en/claude-code-on-the-web`):

- Python 3.x: pip, poetry, uv, black, mypy, pytest, ruff
- Node.js 20, 21, 22 via nvm: npm, yarn, pnpm, bun, eslint, prettier
- Ruby 3.1–3.3 with gem and rbenv
- PHP 8.4 with Composer
- OpenJDK 21 with Maven and Gradle
- Go (latest stable), Rust (cargo), GCC, Clang, cmake, ninja, conan
- Docker, dockerd, docker compose (available but with known limitations — Docker-in-Docker behavior in the sandbox is not fully documented; community reports note partial functionality)
- PostgreSQL 16 and Redis 7 (pre-installed, not running by default — must be started via hook or instruction)
- git, jq, yq, ripgrep, tmux, vim, nano

**Ephemeral model:** The VM is provisioned fresh per session. A session "persists" in the sense that the conversation transcript and the repository state (via git commits) survive; the running processes, installed packages (unless cached), and any in-memory state do not.

**Caching:** When a cloud environment's setup script runs successfully, Anthropic snapshots the filesystem. Subsequent sessions start from this snapshot rather than re-running the script. The cache expires after ~7 days, or when the setup script or allowed network hosts change.

---

### A.3 Repo Connection Model

- Cloud sessions perform a **fresh `git clone`** of the repository at session start.
- Authentication for the clone goes through **an Anthropic-hosted GitHub proxy** — the git credential never lives inside the VM. Inside the sandbox, git authenticates with a scoped, short-lived credential; the proxy translates it to the user's actual GitHub token.
- Access scope: any repository visible to the connected GitHub account.
- **Monorepo limitation (confirmed, open GitHub issue #23627):** The platform assumes one session = one repository = one branch = one PR. Subdirectory targeting within a monorepo is not natively supported. The `--add-dir` flag can grant access to additional directories, but CLAUDE.md files from those directories do not load by default without `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.
- Non-GitHub remotes (GitLab, Bitbucket) can be sent as a local bundle (`< 100 MB` constraint) but the session cannot push back without GitHub authentication.
- Self-hosted GitHub Enterprise Server is supported for Team and Enterprise plans.

Sources: [code.claude.com/docs/en/claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web), GitHub issue [#23627](https://github.com/anthropics/claude-code/issues/23627)

---

### A.4 Git / Branch / PR Flow

Claude Code Web integrates native GitHub tools that route through Anthropic's GitHub proxy:

- **Commits** are authored under the connected GitHub identity. The agent stages changes, writes commit messages, creates branches, and pushes.
- **PRs** are opened via the GitHub App token; PR descriptions are generated from commit context. Teams can specify conventions (Conventional Commits, naming patterns) in CLAUDE.md.
- **Auto-fix:** When enabled (requires GitHub App, not just `/web-setup`), Claude subscribes to PR webhooks. On CI failure or review comment, it investigates and pushes a fix if one is unambiguous. Architecturally significant comments trigger a confirmation ask rather than an automatic push.
- **Branch protection:** The platform respects GitHub branch protection rules; it cannot bypass them. Known limitation: branch protection rules using wildcard patterns are incompatible with GitHub merge queues (GitHub community issue [#154383](https://github.com/orgs/community/discussions/154383)).
- **`GH_TOKEN` env var:** For advanced `gh` CLI commands (beyond what the built-in GitHub tools cover), set `GH_TOKEN` as an environment variable in the cloud environment UI.

---

### A.5 Network and Secrets Posture

**Network access levels** (configured per cloud environment in the UI):

| Level | Behavior |
|---|---|
| `None` | No outbound network except Anthropic API |
| `Trusted` (default) | Package registries (npm, PyPI, RubyGems, crates.io, Docker Hub, ghcr.io), Anthropic services, major cloud platforms |
| `Custom` | User-defined allowlist, supports `*.subdomain.example.com` wildcards |
| `Full` | Any domain |

GitHub operations use a separate proxy independent of the network access level setting. MCP connector traffic routes through Anthropic's servers, so enabled connectors work without being added to the allowed domains list.

**Secrets:** There is **no dedicated secrets store** as of May 2026. Environment variables are set per cloud environment in the UI (not per-repo; per-environment). They are visible to anyone with edit access to the environment. What is explicitly not supported: interactive auth (AWS SSO, browser-based OAuth), `~/.aws/credentials`, anything in the user's local filesystem. For CI runs, `ANTHROPIC_API_KEY` is stored as a GitHub repository secret.

Sources: [code.claude.com/docs/en/claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web), [code.claude.com/docs/en/security](https://code.claude.com/docs/en/security)

---

### A.6 MCP Servers in the Web Sandbox

**Confirmed from official docs (code.claude.com/docs/en/claude-code-on-the-web):**

> MCP servers you added with `claude mcp add` — **No.** Those write to your local user config, not the repo. Declare the server in `.mcp.json` instead.

**Transport support in the web sandbox:**
- HTTP (Streamable HTTP) — supported
- SSE — supported (deprecated but still functional; prefer HTTP)
- **STDIO — NOT supported in the web sandbox.** STDIO servers require a locally spawned process, which cannot run inside the cloud VM without the binary being available and being declared in `.mcp.json` with an executable command.

Caveat: STDIO servers *can* technically be declared in `.mcp.json` with a `command:` entry if the binary is pre-installed in the cloud environment (e.g., `npx`, `python`, `node`). What doesn't work is connecting to a process running on the developer's local machine. The official MCP connector docs at `platform.claude.com/docs/en/agents-and-tools/mcp-connector` state: "The server must be publicly exposed through HTTP. Local STDIO servers cannot be connected directly."

MCP servers from user scope (`~/.claude.json`, added via `claude mcp add` without `--scope project`) are not available in the web sandbox. Only project-scope entries in the committed `.mcp.json` are loaded.

---

### A.7 Plugins in the Web Sandbox

**Confirmed availability table from official docs:**

| Config | Available in web? | Reason |
|---|---|---|
| Repo's `CLAUDE.md` | Yes | Part of the clone |
| Repo's `.claude/settings.json` hooks | Yes | Part of the clone |
| Repo's `.mcp.json` MCP servers | Yes | Part of the clone |
| Repo's `.claude/rules/`, `skills/`, `agents/`, `commands/` | Yes | Part of the clone |
| Plugins declared in `.claude/settings.json` | Yes | Installed at session start from declared marketplace. Requires network access to marketplace source. |
| User's `~/.claude/CLAUDE.md` | No | Lives on local machine |
| Plugins in `~/.claude/settings.json` (`enabledPlugins`) | No | User-scoped; not in repo |

**UserConfig / API keys for plugins:** Since there is no dedicated secrets store, plugin userConfig values (e.g., API keys) must be provided as environment variables in the cloud environment UI. Plugins that require interactive OAuth or browser-based configuration cannot be provisioned in the web sandbox. For repos using `yellow-research` or similar plugins that need API keys, those keys must be pre-set in the cloud environment's environment variables.

---

### A.8 Failure Modes Specific to the Web Sandbox

These are confirmed or commonly reported failure modes that do not typically occur in local CLI usage:

1. **Setup script timeout:** Script must complete in under 5 minutes. Large or slow installs that run serially will time out, leaving the cache unbuilt. Every subsequent session incurs the full install cost until the script is fixed.
2. **Missing `CLAUDE_CODE_REMOTE` gate:** Bootstrap scripts that run unconditionally will execute on every local session too. Always gate with `if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi`.
3. **STDIO MCP server silently missing:** An MCP server declared only in user scope or using a binary not available in the sandbox will fail to connect. The agent proceeds without that server, and the failure may not be obvious unless `/mcp` is checked.
4. **Plugin install network failure:** Plugins from a marketplace require the marketplace host to be reachable. If network access is set to `None` or the marketplace domain isn't in the trusted list, plugin install silently fails.
5. **User settings not loaded:** Anything in `~/.claude/settings.json` (including `enabledPlugins`) is absent. This is the single most common misconfiguration when a setup that works locally fails in the web sandbox.
6. **Interactive auth blocked:** AWS SSO, GitHub OAuth device flow, and any other browser-redirect auth cannot complete in the sandbox. The call either hangs or errors.
7. **Session expiry loses ephemeral state:** If the session times out before changes are committed, all non-git state is lost. Resumed sessions restore conversation history but start a fresh VM.
8. **Large repo clone timeout:** Very large repositories can time out during the initial clone. Community workaround: use `.gitignore`/`.claudeignore` to reduce what is accessible to the agent, and keep binary assets in external storage.
9. **CRLF line endings in shell scripts:** WSL2-authored scripts committed with CRLF will fail with `bad interpreter` errors in the Ubuntu-based sandbox.
10. **`host_not_allowed` errors:** Outbound calls to hosts not in the trusted/allowed list return `x-deny-reason: host_not_allowed`. Common with private registries, internal APIs, or niche package sources.
11. **Context window overflow from large CLAUDE.md:** The first 200 lines (or 25 KB, whichever comes first) of `MEMORY.md` applies analogously to CLAUDE.md in practice. Excessively large CLAUDE.md files consume context headroom on every session. No official hard byte limit is documented; community guidance treats 200 lines as the threshold.

Sources: [code.claude.com/docs/en/errors](https://code.claude.com/docs/en/errors), [code.claude.com/docs/en/web-quickstart](https://code.claude.com/docs/en/web-quickstart), GitHub issues #29885, #29515, community reports.

---

## Part B — How to Configure a Repository for Claude Code Web

### B.1 CLAUDE.md and AGENTS.md

**What to include for cloud agent use:**

- Keep CLAUDE.md **under ~200 lines** (official recommendation). The file is loaded at every session start; oversized files eat context budget immediately.
- Add an explicit **"Bootstrap"** or **"Environment setup"** section that tells the agent where its setup script is and what it does. The web agent cannot interactively ask you where to find things.
- Add a **"Cloud-session notes"** section documenting which env vars are needed (names, not values) and where they should be set (cloud environment UI), which plugins are required, and which MCP servers are available in the web sandbox vs. local-only.
- If your project has a monorepo structure, add explicit path-based guidance since monorepo navigation is not natively scoped. Use `.claude/rules/` path-scoped files for per-subdirectory conventions rather than putting everything in root CLAUDE.md.
- **Do not include** secrets, tokens, or local machine paths. Do not use YAML folded scalars in frontmatter; do not include instructions that assume an interactive user is present (e.g., "press enter to confirm").

**AGENTS.md:** Not a Claude Code Web-specific file; this is a project-convention file. Include it if your repo defines agent authoring rules (as `yellow-plugins` does). The web agent will load it as part of the clone.

---

### B.2 Setup / Bootstrap Scripts

**Two mechanisms, different scopes:**

| | Setup scripts | SessionStart hooks |
|---|---|---|
| Configured in | Cloud environment UI | `.claude/settings.json` in repo |
| Runs | Before Claude Code launches; only when no cached environment is available | After Claude Code launches; on every session including resumed |
| Can install OS packages | Yes (`apt install`) — root access | No — user-space only |
| Cached | Yes (~7 days) | No — runs every session (keep fast) |
| Available locally | No — cloud only | Yes — also runs on local CLI |

**Recommended pattern:** Use a **SessionStart hook** pointing to a script in the repo for dependency installation (npm/pip/cargo/etc.). Use a cloud environment **setup script** (configured in the UI, not committed) for OS-level package installs.

**Canonical file name and location:** No single mandated name. Official docs use `scripts/install_pkgs.sh`. Commit it to the repo, reference it from `.claude/settings.json`.

**SessionStart hook structure (from official docs):**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/scripts/install_pkgs.sh"
          }
        ]
      }
    ]
  }
}
```

**Bootstrap script canonical pattern:**

```bash
#!/bin/bash
# Gate: only run full installs in cloud sessions
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

npm ci
pip install -r requirements.txt
exit 0
```

Key rules:
- Always gate on `CLAUDE_CODE_REMOTE=true`
- Always `exit 0` explicitly on all paths (SessionStart must output `{"continue": true}` — the command type does this automatically, but a non-zero exit will block the session)
- Use `npm ci` not `npm install` for reproducibility
- Keep the script under 5 minutes total runtime
- Run independent installs in parallel with `&` + `wait` if the script is slow

Source: [code.claude.com/docs/en/claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web), [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)

---

### B.3 Dev Container / Environment Hints

**What Claude Code Web actually consumes:**

| File | Consumed by web agent? | Notes |
|---|---|---|
| `.claude/settings.json` | Yes | Loaded at session start |
| `.mcp.json` | Yes | Project-scope MCP servers |
| `CLAUDE.md` | Yes | Loaded at session start |
| `.claude/rules/`, `agents/`, `skills/`, `commands/` | Yes | Loaded per-scope |
| `.devcontainer/devcontainer.json` | **Not confirmed** | Potentially consumed for environment hints, but no official doc confirms the web agent reads devcontainer.json. Community sources treat it as local-dev-only. |
| `.github/workflows/*` | Not directly | The agent can read them as code; CI is not auto-triggered by the agent reading workflow files |
| `Dockerfile` | Not consumed | Not used to provision the sandbox |
| `mise.toml`, `.tool-versions`, `.nvmrc`, `.node-version` | Not confirmed as auto-read | Version managers may need explicit invocation in bootstrap |
| `package.json#engines` | Not consumed by sandbox provisioning | |
| `.gitattributes` | Respected by git clone | Affects line ending handling |

**Practical implication:** The `devcontainer.json` file is useful for **local developer onboarding** and to document the intended environment (especially `containerEnv` variables), but it does not provision the web sandbox. The web sandbox OS and tooling come from Anthropic's base image. Customization goes through the cloud environment UI's setup script (OS packages) and the repo's SessionStart hook (language packages).

---

### B.4 Settings and Permissions

**`.claude/settings.json` keys that matter most in the web sandbox:**

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run lint)",
      "Bash(npm test)",
      "Bash(pnpm validate:schemas)"
    ],
    "deny": [
      "Read(**/.ssh/**)",
      "Read(**/.aws/**)"
    ]
  },
  "env": {
    "NODE_ENV": "test"
  },
  "hooks": {
    "SessionStart": [...]
  }
}
```

**Cloud-specific considerations:**

- **`permissions.allow` is critical for unattended runs.** In interactive local use, the agent can ask for approval. In the web sandbox (especially when triggered by `/schedule` or Auto-fix), no human is available to respond to permission prompts. Pre-approve all Bash commands the agent needs to run.
- **`permissions.deny` for sensitive paths.** The web sandbox clones the full repo; if `.env` files or secret files end up committed (they shouldn't, but defense in depth matters), deny rules prevent them from being read.
- **`env` for non-secret variables.** Safe to commit non-sensitive env vars (e.g., `NODE_ENV`, `LOG_LEVEL`) here. Never commit secret values.
- **User-scope settings are ignored.** `~/.claude/settings.json` and `settings.local.json` do not exist in the web sandbox.

Source: [code.claude.com/docs/en/settings](https://code.claude.com/docs/en/settings), [code.claude.com/docs/en/claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web)

---

### B.5 Plugin / Marketplace Declaration

**From official docs:** Plugins are declared in the repo's `.claude/settings.json` under `enabledPlugins` (not in user settings). They are installed at session start from the declared marketplace, requiring network access to the marketplace source.

The `yellow-plugins` repo's `.claude-plugin/marketplace.json` is the source-of-truth for plugins distributed from this repo, but for a *consuming* repo, plugins are declared as:

```json
{
  "enabledPlugins": ["plugin-name-1", "plugin-name-2"]
}
```

with a corresponding marketplace declaration pointing to the plugin source. The exact key and format for `plugin_marketplaces` as used in the GitHub Action is documented at [code.claude.com/docs/en/github-actions](https://code.claude.com/docs/en/github-actions).

**`CLAUDE_CODE_PLUGIN_SEED_DIR`:** For CI or containerized environments, set this env var to a directory containing a pre-populated plugins directory, so Claude Code starts with plugins already available without cloning them at runtime.

**UserConfig / API keys for plugins:** No automatic injection. Each plugin that needs an API key requires that key to be set as an environment variable in the cloud environment UI. The setup command should detect what userConfig keys each enabled plugin needs and emit a warning listing which env vars must be pre-configured.

---

### B.6 MCP Server Declarations

**Where to declare for web agent access:** `.mcp.json` at the repository root, committed to version control.

**Format:**

```json
{
  "mcpServers": {
    "my-http-server": {
      "type": "http",
      "url": "${MCP_SERVER_URL}",
      "headers": {
        "Authorization": "Bearer ${MCP_API_KEY}"
      }
    }
  }
}
```

**Scope hierarchy:** local > project > user. In the web sandbox, only project-scope (`.mcp.json`) is available.

**What works / what doesn't:**

| Transport | Works in web sandbox? |
|---|---|
| `type: http` (Streamable HTTP) | Yes |
| `type: sse` | Yes (deprecated but functional) |
| `type: stdio` with `command: "npx ..."` where `npx` is pre-installed | **Conditional** — the binary must be available in the sandbox. Works for Node-based servers, may work for Python-based servers. Does NOT work for servers that require native binaries not pre-installed. |
| `type: stdio` pointing to local machine process | No |
| User-scope servers (`~/.claude.json`) | No |

**`${VAR}` expansion** is supported in `.mcp.json` for `command`, `args`, `env`, `url`, and `headers` fields. Use this pattern to avoid committing credentials.

Source: [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp), [code.claude.com/docs/en/claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web)

---

### B.7 Secrets / Env Vars

**Recommended patterns:**

| Secret type | Where to put it |
|---|---|
| `ANTHROPIC_API_KEY` (CI/Actions) | GitHub repository secret |
| Plugin API keys, MCP server tokens | Cloud environment UI (env vars) |
| Non-secret env vars | `.claude/settings.json` `env` block (committed) |
| Personal/local overrides | `.claude/settings.local.json` (gitignored) |
| Long-lived API keys for cloud agent | Cloud environment UI — no other option currently |

**`.claude/settings.local.json`** should be in `.gitignore`. It is never loaded in the web sandbox.

**`CLAUDE_ENV_FILE`:** Available in SessionStart and Setup hooks. Write `export KEY=value` lines to `$CLAUDE_ENV_FILE` from a hook script to persist environment variables into the Claude process environment for the remainder of the session.

**What to add to `.gitignore`:** `.env`, `.env.local`, `.env.*`, `*.pem`, `*.key`, `.aws/`, `.ssh/`, `secrets/`, `credentials/`. Community security research ([knostic.ai](https://knostic.ai/blog/claude-loads-secrets-without-permission)) has shown Claude Code reads `.env` files by default unless blocked — add `permissions.deny` entries for these paths as defense in depth.

---

### B.8 CI Integration

**Canonical file:** `.github/workflows/claude.yml`

**Official action:** `anthropics/claude-code-action@v1`

**Required parameters:** `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`

**Minimal workflow pattern:**

```yaml
name: Claude Code
on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created]

permissions:
  contents: write
  pull-requests: write
  issues: read

jobs:
  claude:
    runs-on: ubuntu-latest
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Auto-fix pattern:** Requires the Claude GitHub App installed (not just `/web-setup`). When Auto-fix is active, the web agent monitors the PR for CI failures and review comments and pushes fixes automatically. No workflow file change is needed to enable Auto-fix — it is activated from the session or via `/autofix-pr` on the branch.

**CI interaction from the agent:** The agent can read CI status via the GitHub API and respond to failures. It does not trigger CI directly — CI triggers from git pushes as normal.

Source: [code.claude.com/docs/en/github-actions](https://code.claude.com/docs/en/github-actions)

---

### B.9 Repo Hygiene That Matters More in the Cloud

- **LF line endings.** The sandbox is Ubuntu 24.04. Shell scripts with CRLF produce `bad interpreter` errors. Ensure `.gitattributes` sets `* text=auto` and `*.sh eol=lf`. This matters more in the cloud than locally because WSL2 is a common authoring environment that silently introduces CRLF.
- **`.gitignore` coverage.** The full repo is cloned. Anything committed is accessible to the agent. Sensitive files that are present but gitignored on the developer's machine are not in the clone — but files accidentally committed are.
- **Lockfile consistency.** The bootstrap script uses `npm ci` (not `npm install`) to respect lockfiles. Missing or stale lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `uv.lock`, `Cargo.lock`) cause non-reproducible installs. Ensure lockfiles are committed.
- **Large binary files.** Large assets in the repo slow down or time out the initial clone. Use Git LFS or external storage. There is no built-in Git LFS support documented for the web sandbox — if your repo uses LFS, verify it works; this is an empirical question.
- **Submodules.** Not specifically documented for the web sandbox. Treat as high-risk; test empirically.
- **Executable bits on scripts.** Scripts called via SessionStart hooks must be executable (`chmod +x`). Since git preserves executable bits, set them before committing.
- **CLAUDE.md size.** No documented hard limit in bytes, but the "~200 lines" recommendation is official. Large CLAUDE.md files degrade session quality by consuming context budget.

---

## Part C — Design Implications for a `setup:claude-web` Command

Below is a concrete checklist of checks the command should run, with detection logic, what to write/modify if missing, and idempotency strategy. Items are marked **[CONFIRMED]** (backed by official docs), **[COMMUNITY]** (backed by community sources), or **[ASSUMPTION]** (logical inference, needs empirical validation).

---

### C.1 `.claude/settings.json` — Permissions and Hooks

- **Detect:** Does `.claude/settings.json` exist? Does it have a `permissions.allow` block? Does it have a `hooks.SessionStart` entry?
- **Write if missing:** Scaffold a minimum-viable `settings.json` with an empty `permissions.allow` list and a commented-out SessionStart hook template.
- **Idempotency:** Read and merge — do not overwrite existing keys. Use a JSON merge strategy.
- **[CONFIRMED]**

---

### C.2 Bootstrap Script — Detect Package Manager and Write `scripts/install_pkgs.sh`

- **Detect:** Presence of lockfiles in repo root:
  - `pnpm-lock.yaml` → pnpm (`pnpm install --frozen-lockfile`)
  - `yarn.lock` → yarn (`yarn install --frozen-lockfile`)
  - `package-lock.json` → npm (`npm ci`)
  - `uv.lock` or `requirements.txt` → Python (`uv sync` or `pip install -r requirements.txt`)
  - `Cargo.lock` → Rust (`cargo build`)
  - `Gemfile.lock` → Ruby (`bundle install`)
  - `composer.lock` → PHP (`composer install --no-interaction`)
  - `go.sum` → Go (`go mod download`)
- **Write if missing:** `scripts/install_pkgs.sh` gated on `CLAUDE_CODE_REMOTE=true`, using the detected package manager. Always `chmod +x`.
- **Wire into `.claude/settings.json`:** Add or update the `SessionStart` hook to call `"$CLAUDE_PROJECT_DIR"/scripts/install_pkgs.sh`.
- **Idempotency:** Check if `scripts/install_pkgs.sh` already exists; if so, inspect it for the `CLAUDE_CODE_REMOTE` gate and warn if missing. Don't overwrite a user-customized script.
- **[CONFIRMED]**

---

### C.3 MCP Servers — Audit `.mcp.json` for Sandbox Incompatibility

- **Detect:** Does `.mcp.json` exist? For each entry, check `type`:
  - `"stdio"` with `command` pointing to a binary not in the pre-installed tooling list → warn: "this MCP server uses stdio transport with a binary that may not be available in the web sandbox"
  - `"stdio"` with `command: "npx"` or `command: "python"` → note: "may work if the package is installable; add package install to scripts/install_pkgs.sh"
  - User-scope servers (not in `.mcp.json`, but detectable via `claude mcp list` output or `~/.claude.json`) → warn: "these servers are not available in the web sandbox; move them to `.mcp.json` with project scope if needed"
- **Write if missing:** If no `.mcp.json` exists and the user has user-scope MCP servers they want in the web agent, scaffold a template `.mcp.json` with `${VAR}` placeholders.
- **Idempotency:** Only append new entries; never remove existing ones.
- **[CONFIRMED for transport rules, ASSUMPTION for binary detection logic]**

---

### C.4 Plugins — Audit `enabledPlugins` and Warn About Missing Env Vars

- **Detect:** Is `enabledPlugins` in `.claude/settings.json`? (Note: may also be `~/.claude/settings.json` for user-local-only plugins.) For each enabled plugin, check its `plugin.json` for `userConfig` entries that have no `default` value.
- **If user-scope only:** Warn that these plugins won't load in the web sandbox; suggest moving the declaration to `.claude/settings.json`.
- **For each required `userConfig` key without a default:** Emit a warning listing the env var name the user must configure in the cloud environment UI.
- **[CONFIRMED for the "user-scope not available" rule; ASSUMPTION for the userConfig env-var-name mapping]**

---

### C.5 `.github/workflows/claude.yml` — CI Integration

- **Detect:** Does `.github/workflows/claude.yml` exist (or any workflow using `anthropics/claude-code-action`)?
- **Write if missing and repo has GitHub Actions workflows:** Scaffold a minimal `claude.yml` using `anthropics/claude-code-action@v1`. Include a comment noting `ANTHROPIC_API_KEY` must be set as a repository secret.
- **Idempotency:** Don't overwrite an existing workflow. If a workflow exists but doesn't use `anthropics/claude-code-action`, note it and skip.
- **[CONFIRMED for the action and its required parameters]**

---

### C.6 `.gitattributes` — LF Line Endings

- **Detect:** Does `.gitattributes` exist? Does it contain `* text=auto` and `*.sh eol=lf`?
- **Write if missing:** Add minimum entries. If file exists but missing shell script rule, append.
- **Idempotency:** Check before appending; never duplicate lines.
- **[COMMUNITY + confirmed WSL2 behavior in this repo]**

---

### C.7 CLAUDE.md Size Check

- **Detect:** Count lines in `CLAUDE.md`. Count bytes.
- **Warn if:** > 200 lines or > 25 KB (conservative threshold; no official byte limit is documented).
- **Do not modify** — size reduction requires human judgment.
- **[COMMUNITY for the 200-line recommendation; ASSUMPTION for 25 KB byte threshold]**

---

### C.8 `.gitignore` — Sensitive File Coverage

- **Detect:** Is `.gitignore` present? Does it cover: `.env`, `.env.*`, `.env.local`, `*.pem`, `*.key`, `.aws/`, `.ssh/`, `secrets/`?
- **Write if missing:** Add missing patterns.
- **Also emit:** Suggest adding `permissions.deny` entries to `.claude/settings.json` for the same paths as defense-in-depth.
- **[COMMUNITY — community security research; official docs recommend deny rules for sensitive paths]**

---

### C.9 Script Executable Bits

- **Detect:** For every `*.sh` file referenced in `.claude/settings.json` hooks, check if it has executable bit set (via `git ls-files --format='%(objectmode) %(path)'`).
- **Fix:** `chmod +x` + re-add to git index if executable bit is missing.
- **[ASSUMPTION — inferred from how SessionStart hooks invoke scripts; no explicit official guidance on this]**

---

### C.10 Lockfile Consistency

- **Detect:** If a package manager was detected (step C.2), does its lockfile exist and is it tracked by git?
- **Warn if:** `package.json` exists but no lockfile, or lockfile is in `.gitignore`.
- **[CONFIRMED as best practice; implied by `npm ci` usage in official docs]**

---

### C.11 Summary Output

The command should emit:
1. A list of files created/modified
2. A list of env vars that must be manually configured in the cloud environment UI (with plugin/MCP server names)
3. A list of warnings for items that need human review (large CLAUDE.md, STDIO MCP servers with unknown binaries, etc.)
4. A "Next steps" block with: link to cloud environment setup UI, instruction to install Claude GitHub App if not done, instruction to set `ANTHROPIC_API_KEY` as a GitHub secret

---

## Open Questions / What to Verify Empirically

| Question | Risk | How to Verify |
|---|---|---|
| Does `.devcontainer/devcontainer.json` affect the web sandbox environment in any way? | Low-medium — if yes, we're missing a configuration point | Create a test repo with a devcontainer; inspect the sandbox environment variables |
| What is the exact CLAUDE.md byte limit before context degradation is measurable? | Medium | Run sessions with CLAUDE.md at 5K, 10K, 25K bytes; measure effective context |
| Do STDIO MCP servers with `command: "npx"` reliably work in the sandbox if the package is npm-installable? | High — this affects many community MCP servers | Test `npx -y @modelcontextprotocol/server-filesystem` in a live web session |
| Does Docker-in-Docker work end-to-end (not just docker CLI available, but dockerd actually running)? | High — many repos use `docker compose up` in their dev flow | Run a `docker compose up` from a SessionStart hook; check if the daemon is accessible |
| Does Git LFS work in the web sandbox clone? | Medium | Clone a repo with LFS assets; check whether they are available |
| How do submodules behave during the fresh clone? | Medium | Clone a repo with submodules and verify recursive initialization |
| What is the exact format for declaring plugin marketplaces in `.claude/settings.json` (vs. the GitHub Action `plugin_marketplaces` param)? | High for `setup:claude-web` correctness | Read a live session's settings with `/status`; inspect what keys are honored |
| Can the `CLAUDE_CODE_PLUGIN_SEED_DIR` approach be used in the web sandbox environment (i.e., is it settable in the cloud env UI)? | Medium | Set the variable in the cloud env UI and verify plugin pre-population |
| When a setup script times out, does the session start with no packages at all, or with partial state? | High for debugging | Let a slow script run past 5 minutes; observe session state |

---

## Sources

- [Use Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) — primary reference for execution environment, availability table, SessionStart hooks, network access, secrets posture. Official Anthropic docs (2025–2026).
- [Hooks reference](https://code.claude.com/docs/en/hooks) — SessionStart event definition, matcher values, `CLAUDE_ENV_FILE`, hook types. Official Anthropic docs.
- [MCP — Connect to tools](https://code.claude.com/docs/en/mcp) — `.mcp.json` format, scope hierarchy, transport types, `${VAR}` expansion. Official Anthropic docs.
- [Settings](https://code.claude.com/docs/en/settings) — `permissions.allow/deny`, `env`, hooks structure, settings precedence. Official Anthropic docs.
- [Security](https://code.claude.com/docs/en/security) — credential protection, proxy architecture, deny patterns for sensitive files. Official Anthropic docs.
- [GitHub Actions](https://code.claude.com/docs/en/github-actions) — `claude-code-action@v1` parameters, required secrets, permissions. Official Anthropic docs.
- [Web quickstart](https://code.claude.com/docs/en/web-quickstart) — troubleshooting setup failures, session management. Official Anthropic docs.
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) — marketplace configuration, `CLAUDE_CODE_PLUGIN_SEED_DIR`, restriction policies. Official Anthropic docs.
- [Errors reference](https://code.claude.com/docs/en/errors) — `host_not_allowed`, session expiry patterns. Official Anthropic docs.
- [MCP connector (platform)](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) — HTTP-only constraint for remote MCP. Official Anthropic platform docs.
- [GitHub issue #23627](https://github.com/anthropics/claude-code/issues/23627) — monorepo one-session-one-repo limitation. Community (Anthropic repo).
- [GitHub community discussion #154383](https://github.com/orgs/community/discussions/154383) — merge queue wildcard branch protection incompatibility. Community.
- [knostic.ai — Claude loads secrets without permission](https://knostic.ai/blog/claude-loads-secrets-without-permission) — `.env` file default read behavior. Community security research.
- EXA deep research report (exa-research-pro, 2026-05-18) — synthesized from official docs and community sources.
