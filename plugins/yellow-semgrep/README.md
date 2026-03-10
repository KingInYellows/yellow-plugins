# yellow-semgrep

Semgrep security finding remediation — fetch "to fix" findings from the Semgrep
AppSec Platform, apply fixes (deterministic autofix first, LLM fallback),
verify via re-scan, and update triage state.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-semgrep@yellow-plugins
```

## Prerequisites

- `SEMGREP_APP_TOKEN` environment variable (Web API scope, `sgp_` prefix)
- `curl` and `jq` installed
- `semgrep` CLI installed, version **1.146.0+** (`pipx install semgrep`)
- Graphite CLI (`gt`) for branch management

## Setup

### 1. Create an API Token

Go to **Organization Settings > API Tokens** in the Semgrep web app. Create a
token with **Web API** scope (not CI scope).

### 2. Set Environment Variables

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export SEMGREP_APP_TOKEN="sgp_your_token_here"
```

Never commit tokens to version control.

### 3. Verify Setup

Run `/semgrep:setup` to validate your token, detect your deployment slug, and
verify MCP tool availability.

## Commands

| Command | Description |
|---|---|
| `/semgrep:setup` | Validate token, detect deployment slug, verify MCP tools |
| `/semgrep:status` | Dashboard: findings by triage state and severity |
| `/semgrep:scan` | Local scan, compare with platform findings |
| `/semgrep:fix` | Fix single finding: fetch → analyze → fix → verify → triage |
| `/semgrep:fix-batch` | Fix multiple findings with approval between each |

## Agents

| Agent | Description |
|---|---|
| `finding-fixer` | Deterministic autofix first, LLM fallback for complex fixes |
| `scan-verifier` | Post-fix re-scan and regression detection |

## Skills

| Skill | Description |
|---|---|
| `semgrep-conventions` | State mappings, API patterns, fix strategy, security |

## MCP Servers

| Server | Command | Auth | Min Version |
|---|---|---|---|
| semgrep | `semgrep mcp` | `SEMGREP_APP_TOKEN` env var | 1.146.0+ |

## Typical Workflow

```
/semgrep:setup                    # Validate credentials and MCP tools
/semgrep:status                   # See what needs fixing
/semgrep:fix 12345                # Fix a specific finding by ID
/semgrep:fix-batch --max 5        # Work through the to-fix queue
```

## Troubleshooting

**"SEMGREP_APP_TOKEN not set"** — Export your token in your shell profile. Create
one at Organization Settings > API Tokens with Web API scope.

**"Token validation failed (401)"** — Your token was rejected. Verify it has Web
API scope (not CI scope) and has not expired.

**"semgrep CLI not found"** — Run `/semgrep:setup` which offers to install
semgrep automatically via pipx (preferred) or pip. Or install manually:
`pipx install semgrep`.

**"MCP tools not found"** — The MCP server is built into the semgrep binary
(v1.146.0+). Ensure semgrep is up to date: `pipx upgrade semgrep`. Run
`/semgrep:setup` to verify.

**"Finding not found in 'fixing' state"** — The finding may have been resolved
or is in a different triage state. Check `/semgrep:status` for current state.

## Architecture

Three-layer hybrid design:

- **Layer 1 (Read):** REST API for finding retrieval and triage queries
- **Layer 2 (Remediate):** Semgrep CLI for autofix + LLM fallback for complex fixes
- **Layer 3 (Lifecycle):** REST API for triage state mutations

MCP server is used for local scanning and AST analysis only. REST API handles
all platform interactions (better pagination, dedup, triage mutations).

## Limitations

- **SAST only** — SCA/dependency findings not supported in v1
- **REST API rate limit** — ~60 requests/minute; batch operations add 1s delays
- **`semgrep_whoami` does not work with API tokens** — only OAuth JWTs; plugin
  uses REST `GET /api/v1/me` for validation
- **MCP tool names must be verified** — actual names may differ; `/semgrep:setup`
  verifies them
- **No webhook/push support** — finding status is polled, not pushed
- **Pagination limit** — REST API defaults to `page_size=100`

## License

MIT
