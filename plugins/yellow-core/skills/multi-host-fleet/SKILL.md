---
name: multi-host-fleet
description: Multi-host plugin credential and config reference for yellow-plugins. Use when setting up a new workstation, configuring CI/devcontainer, replicating credentials across a fleet, or wiring a secrets manager. Documents the canonical shell env var names for every credential-bearing plugin.
user-invokable: true
---

# Multi-Host Fleet Reference

## What It Does

Documents the canonical shell environment variable for every
credential-bearing plugin in this marketplace, with patterns for replicating
credentials across multiple hosts (workstations, CI runners, ephemeral
sandboxes, devcontainers) without re-running `/plugin disable && /plugin
enable` per host.

The yellow-plugins marketplace adopts a 3-element credential resolution
pattern for credential-bearing plugins that bundle a stdio MCP server
(yellow-research, yellow-morph, yellow-semgrep, yellow-composio):

1. `userConfig` value (stored in OS keychain) — **preferred** for single-host
   installs
2. Shell env var (canonical name, see table below) — **fallback** for fleet
   and CI usage
3. Unset → MCP server either fails to start (composio) or starts in
   degraded mode (research, semgrep)

Plugins with HTTP-only MCPs (yellow-devin) accept the same userConfig OR
shell env var sources, but commands read shell env directly rather than
flowing through a wrapper.

Setting the canonical shell env var on a new host lets the plugin operate
without ever populating the userConfig keychain entry. The enable-time
userConfig prompt still fires on platforms where prompting works
(see [#39455](https://github.com/anthropics/claude-code/issues/39455));
dismissing or skipping it is safe when the shell env var is set.

## When to Use

- Setting up a new workstation, laptop, WSL2 instance, or VM
- Configuring a CI job (GitHub Actions, GitLab CI, CircleCI) that runs
  Claude Code
- Building a devcontainer image with pre-injected credentials
- Wiring a secrets manager (direnv, 1Password CLI, HashiCorp Vault,
  Doppler, AWS Secrets Manager) so credentials flow into Claude Code
- Diagnosing why a plugin reports PARTIAL or NEEDS SETUP on one host but
  READY on another

## Usage

### Canonical Env-Var Contract

| Plugin | Shell Env Var | userConfig Field | Sensitive | Notes |
|--------|---------------|------------------|-----------|-------|
| yellow-research | `PERPLEXITY_API_KEY` | `perplexity_api_key` | yes | |
| yellow-research | `TAVILY_API_KEY` | `tavily_api_key` | yes | |
| yellow-research | `EXA_API_KEY` | `exa_api_key` | yes | |
| yellow-research | `CERAMIC_API_KEY` | (none) | yes | REST live-probe only; MCP uses OAuth |
| yellow-morph | `MORPH_API_KEY` | `morph_api_key` | yes | |
| yellow-semgrep | `SEMGREP_APP_TOKEN` | `semgrep_app_token` | yes | `sgp_` prefix |
| yellow-composio | `COMPOSIO_MCP_URL` | `composio_mcp_url` | no | Must start with `https://` |
| yellow-composio | `COMPOSIO_API_KEY` | `composio_api_key` | yes | |
| yellow-devin | `DEVIN_SERVICE_USER_TOKEN` | `devin_service_user_token` | yes | HTTP MCP; commands read shell env directly |
| yellow-devin | `DEVIN_ORG_ID` | `devin_org_id` | no | HTTP MCP; commands read shell env directly |

The userConfig path uses the system keychain when available (macOS,
Windows) or `~/.claude/.credentials.json` (0600 perms) on minimal Linux.
The shell env path is what makes multi-host fleets practical.

### Dev hosts (dotfiles + shell rc + direnv)

For a typical developer workstation, store secrets in shell rc files or
direnv:

```bash
# In ~/.zshrc or ~/.bashrc (NOT version-controlled in plaintext)
export PERPLEXITY_API_KEY="$(cat ~/.secrets/perplexity 2>/dev/null)"
export TAVILY_API_KEY="$(cat ~/.secrets/tavily 2>/dev/null)"
export EXA_API_KEY="$(cat ~/.secrets/exa 2>/dev/null)"
export MORPH_API_KEY="$(cat ~/.secrets/morph 2>/dev/null)"
export SEMGREP_APP_TOKEN="$(cat ~/.secrets/semgrep 2>/dev/null)"
export COMPOSIO_MCP_URL="https://mcp.composio.dev/your-customer-id"
export COMPOSIO_API_KEY="$(cat ~/.secrets/composio 2>/dev/null)"
export DEVIN_SERVICE_USER_TOKEN="$(cat ~/.secrets/devin-token 2>/dev/null)"
export DEVIN_ORG_ID="your-org-id"
```

Or with [direnv](https://direnv.net) (per-project `.envrc`, not committed):

```bash
# .envrc (gitignored)
export PERPLEXITY_API_KEY="$(cat ~/.secrets/perplexity 2>/dev/null)"
# ... etc
```

`~/.secrets/` files at 0600 perms are the simplest portable secret store.
For shared workstations or higher-sensitivity environments, use the
secrets-manager patterns below.

### CI/CD (GitHub Actions, GitLab CI, devcontainer)

**GitHub Actions:**

```yaml
- name: Run /workflows:work
  env:
    PERPLEXITY_API_KEY: ${{ secrets.PERPLEXITY_API_KEY }}
    EXA_API_KEY: ${{ secrets.EXA_API_KEY }}
    SEMGREP_APP_TOKEN: ${{ secrets.SEMGREP_APP_TOKEN }}
    COMPOSIO_MCP_URL: ${{ vars.COMPOSIO_MCP_URL }}
    COMPOSIO_API_KEY: ${{ secrets.COMPOSIO_API_KEY }}
  run: claude -p "/workflows:work ..." 
```

Add each canonical env var name to **Repository Settings → Secrets and
variables → Actions**. The `composio_mcp_url` can live in `vars` (not
secrets) since it's non-sensitive; everything else goes in `secrets`.

**GitLab CI:**

Define each canonical env var as a Project CI/CD variable (mask sensitive
ones). They auto-propagate to job environments.

**devcontainer.json:**

```json
{
  "containerEnv": {
    "PERPLEXITY_API_KEY": "${localEnv:PERPLEXITY_API_KEY}",
    "EXA_API_KEY": "${localEnv:EXA_API_KEY}",
    "SEMGREP_APP_TOKEN": "${localEnv:SEMGREP_APP_TOKEN}"
  }
}
```

Pulls from the host's env (which must be set per the dev hosts section
above). For ephemeral cloud devcontainers (Codespaces, Coder), inject via
the platform's secret-management UI.

### Secrets managers (tool-agnostic)

**direnv (recommended for local dev — simplest):**

```bash
# .envrc (per-project, gitignored)
dotenv ~/.secrets/yellow-plugins.env

# ~/.secrets/yellow-plugins.env (0600 perms, gitignored)
PERPLEXITY_API_KEY=pk_...
EXA_API_KEY=...
```

direnv loads env vars when you `cd` into the project. Use `direnv allow`
to authorize the `.envrc`.

**1Password CLI (`op run`):**

```bash
# .envrc.template (committed)
export PERPLEXITY_API_KEY="op://Personal/Perplexity API/credential"
export EXA_API_KEY="op://Personal/EXA API/credential"

# Then launch Claude Code via:
op run --env-file=.envrc.template -- claude
```

**HashiCorp Vault (envconsul):**

```bash
envconsul -vault-addr=https://vault.internal -secret=secret/yellow-plugins claude
```

**Doppler:**

```bash
doppler run --project yellow-plugins -- claude
```

**Generic env-file pattern (any tool):**

The contract is: by the time `claude` starts, the canonical env vars
must be in the process environment. Any tool that achieves this works.
The wrapper scripts inside each plugin will pick them up.

## Examples

### Complete `.zshrc` snippet (uncomment what you use)

```bash
# === yellow-plugins env-var contract ===
# Source of truth: plugins/yellow-core/skills/multi-host-fleet/SKILL.md

# yellow-research
# export PERPLEXITY_API_KEY="$(cat ~/.secrets/perplexity 2>/dev/null)"
# export TAVILY_API_KEY="$(cat ~/.secrets/tavily 2>/dev/null)"
# export EXA_API_KEY="$(cat ~/.secrets/exa 2>/dev/null)"
# export CERAMIC_API_KEY="$(cat ~/.secrets/ceramic 2>/dev/null)"  # REST probe only

# yellow-morph
# export MORPH_API_KEY="$(cat ~/.secrets/morph 2>/dev/null)"

# yellow-semgrep
# export SEMGREP_APP_TOKEN="$(cat ~/.secrets/semgrep 2>/dev/null)"

# yellow-composio
# export COMPOSIO_MCP_URL="https://mcp.composio.dev/your-customer-id"
# export COMPOSIO_API_KEY="$(cat ~/.secrets/composio 2>/dev/null)"

# yellow-devin
# export DEVIN_SERVICE_USER_TOKEN="$(cat ~/.secrets/devin 2>/dev/null)"
# export DEVIN_ORG_ID="your-org-id"
```

### Verifying credentials resolve correctly

After setting env vars, run `/setup:all` to verify each plugin reports
READY. Look at the "Credential Status Files" section — each
credential-bearing plugin should show `source: shell_env` (not `absent`)
for fields you set via env.

If a plugin shows the OLD source (e.g., `source: userConfig` from a
previous keychain entry) but you want the shell env value to win,
remember: **userConfig wins over shell env**. To prefer shell env, run
`/plugin disable <name>` then `/plugin enable <name>` and dismiss the
userConfig prompt (or unset the keychain entry).

## Security

- Never commit `.env`, `.envrc`, or `~/.secrets/*` files. Use
  `.gitignore` patterns: `.env`, `.envrc`, `*.secret`, `!.envrc.template`.
  Do not use a bare `.env*` glob — it also matches `.envrc.template`, which
  this guide recommends committing.
- Keep `~/.secrets/` at 0700 directory perms and 0600 file perms.
- For sensitive plugins (semgrep, perplexity, exa, tavily, morph,
  composio_api_key), prefer keychain (userConfig) over shell env when
  running on a single host. Shell env is the only practical option for
  fleets.
- `COMPOSIO_MCP_URL` is non-sensitive (URL pattern, no secret) and can
  safely live in committed `.envrc.template` or GitHub Actions `vars`.
- The wrapper script in yellow-composio (`bin/start-composio.sh`) rejects
  non-HTTPS URLs to prevent cleartext key transmission.
- Env vars are visible to MCP subprocesses spawned by Claude Code. Don't
  store keys with broader scope than needed.
