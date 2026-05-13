# Feature: Plugin Install Resilience — Cache Detection, Env Fallback Parity, and Multi-Host Sync

## Overview

Three pain points are blocking clean plugin installs across fleets:

1. **Cache/upgrade drift** — when a plugin (e.g., yellow-research) ships a new
   userConfig schema in an upgrade, Claude Code does not re-prompt; the only
   remediation is `/plugin disable && /plugin enable`. `/setup:all` has no
   detection for this state.
2. **Env-fallback parity gaps** — yellow-research and yellow-morph honor shell
   env vars as a fallback for userConfig; yellow-composio (userConfig-only,
   `type: http`) and yellow-semgrep (userConfig overwrites shell env with
   empty string) do not. Power users on multi-host fleets must enter creds
   per host.
3. **`/setup:all` misclassification** — `yellow-browser-test` reports
   NEEDS SETUP on every non-web-app repo; `yellow-research` classifies as
   PARTIAL when keys are in keychain (not shell env); `yellow-composio`
   reports NEEDS SETUP without distinguishing "no userConfig" from
   "userConfig set but MCP failed."

This plan also adds a multi-host SKILL.md documenting the env-var contract so
fleets can wire up dotfiles, direnv, or secrets managers without trial-and-error.

## Problem Statement

### Current Pain Points

- **yellow-research PARTIAL classification persists despite working MCPs.**
  setup:all reads only shell env (`EXA_API_KEY`, `TAVILY_API_KEY`,
  `PERPLEXITY_API_KEY`). If user answered the userConfig prompt (keychain),
  shell env is unset and the dashboard reports 0/6 sources even though all
  three MCPs are healthy.
- **yellow-composio cascade failure.** Empty `composio_mcp_url` (user dismissed
  prompt on a fleet host) registers an empty-URL MCP that breaks
  `claude doctor` for all other MCPs in the same session (`SDK auth failed:
  "/" cannot be parsed as a URL`). No env-var fallback exists; `required: true`
  does not block install (only causes startup failure per GH #39827).
- **yellow-semgrep regression.** `"SEMGREP_APP_TOKEN":
  "${user_config.semgrep_app_token}"` with no `:-` fallback. Empty userConfig
  overwrites a working shell env value with `""`, breaking the MCP for power
  users who set the token in `.zshrc` and dismissed the userConfig prompt.
- **yellow-browser-test noise.** Reports NEEDS SETUP on every dotfiles
  repo, server-only project, or CLI tool. No project-type detection in the
  dashboard.
- **No multi-host story.** Each plugin documents (or fails to document) its
  shell env name independently. Setting up a new host requires reading 18
  plugin READMEs to find the env-var contract.

### User Impact

Reported directly by the user on multiple hosts: "Still need attention" for
yellow-research, yellow-composio, yellow-browser-test even after API keys are
properly exported. Disable/enable cycle required per plugin per host —
operationally painful for users running on >2 machines (workstation, laptop,
WSL2, CI).

### Business Value

Marketplace adoption depends on first-install ergonomics. Every "PARTIAL"
banner that requires manual remediation is a churn risk. Env-var contract
parity makes the marketplace fleet-deployable (CI, devcontainers, dotfiles).

## Proposed Solution

### High-Level Architecture

Four coordinated workstreams, each independently shippable:

1. **Env-fallback parity** — extend the 3-element wrapper pattern
   (yellow-research/yellow-morph precedent) to yellow-composio and yellow-semgrep.
   Composio requires architectural change: `type: http` → `type: stdio` via a
   thin proxy shim that pipes stdio MCP JSON-RPC to the Composio HTTPS endpoint.

<!-- deepen-plan: codebase -->
> **Codebase:** Verified — no stdio↔HTTP MCP proxy precedent exists anywhere
> in this repo. The only `${CLAUDE_PLUGIN_DATA}` usage is yellow-morph's
> `bin/start-morph.sh` and `lib/install-morphmcp.sh`, which install a local
> npm binary (not an HTTP proxy). Composio's stdio conversion will be a
> novel pattern; reference implementations come from external packages
> (see Phase 3 external notes). Also: yellow-research mcpServers block
> spans lines 44–88 of `plugin.json` (plan originally cited 44–69).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Path B (stdio + proxy) is *more reliable* than Path A
> (keep type:http with `${VAR}` in headers) because `${VAR}` substitution
> in HTTP MCP `headers` fields is a confirmed Claude Code bug — see
> [issue #51581](https://github.com/anthropics/claude-code/issues/51581)
> (closed Apr 22 2026 as "completed" but no fix version cited) and the
> still-open [#47789](https://github.com/anthropics/claude-code/issues/47789)
> for `headersHelper` missing `${CLAUDE_PLUGIN_ROOT}`. Note: Composio's
> *officially recommended* integration is `claude mcp add --transport http
> composio https://connect.composio.dev/mcp --header "x-consumer-api-key:
> KEY"` — Path B diverges from upstream guidance. Trade-off is acceptable
> for env-var-fallback parity but should be documented in
> `plugins/yellow-composio/CLAUDE.md`.
<!-- /deepen-plan -->

2. **Status-file protocol + drift detection** — define
   `${CLAUDE_PLUGIN_DATA}/credential-status.json` schema; each credential-bearing
   plugin emits one via a SessionStart hook. `/setup:all` reads these files
   directly (no keychain probing).

<!-- deepen-plan: external -->
> **Research:** `${CLAUDE_PLUGIN_DATA}` is the officially documented
> persistent plugin-state directory
> ([plugins-reference](https://code.claude.com/docs/en/plugins-reference)).
> Two open bugs to track: [#41156](https://github.com/anthropics/claude-code/issues/41156)
> triggers a protected-directory prompt on writes even in
> `bypassPermissions` mode (still open May 2026), and
> [#51398](https://github.com/anthropics/claude-code/issues/51398) reports
> `${CLAUDE_PLUGIN_DATA}` is session-scoped (not persistent) in Cowork
> Desktop. Status-file hooks should fail gracefully when writes fail and
> not block SessionStart.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** No `credential-status.json` prototype exists anywhere in
> the repo today. The only similar pattern is yellow-composio's
> `.claude/composio-usage.json` (project-local, not `${CLAUDE_PLUGIN_DATA}`).
> The plan correctly chooses `${CLAUDE_PLUGIN_DATA}` (cross-project,
> per-plugin) over project-local for credential status.
<!-- /deepen-plan -->
3. **`/setup:all` enhancements** — version-drift detection via
   `claude plugin list --json --available` (cached to
   `${CLAUDE_PLUGIN_DATA}/version-check-cache.json` with 24h TTL);
   browser-test heuristic with proactive "create local.md?" prompt;
   classification block updates for composio/semgrep/research using new
   status files.
4. **Multi-host fleet SKILL.md** — comprehensive env-var contract reference
   for workstations + CI + ephemeral sandboxes. Tool-agnostic (direnv +
   shell rc primary; 1Password/Vault optional alternatives).

### Key Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Composio architecture | `type: stdio` + proxy shim (Path B) | Only path that supports the 3-element fallback. User-confirmed in planning. |
| D2 | browser-test exclusion | Permanent omit + proactive recommendation | User-confirmed "auto-detect and exclude." Re-scan adds a recommend-include step when web signals appear. |
| D3 | `plugin list --json --available` cache | 24h TTL at `${CLAUDE_PLUGIN_DATA}/version-check-cache.json` | Balances freshness with performance — version drift rarely changes within a day. |
| D4 | Status-file protocol | `${CLAUDE_PLUGIN_DATA}/credential-status.json` schema below | Defined once, used by all plugins; setup:all reads via jq. |
| D5 | Composio empty-URL wrapper | Exit non-zero, block MCP start | Prevents cascade failure to `claude doctor`. Trade graceful degradation for blast-radius containment. |
| D6 | Validator rules | Warning, not blocking | Future-proofing for new plugins; non-blocking avoids churn for existing manifests. |
| D7 | Env-var contract docs | New `plugins/yellow-core/skills/multi-host-fleet/SKILL.md` + table in `AGENTS.md` | Single source of truth for the contract; per-plugin READMEs reference the skill. |

### Trade-offs Considered

- **Composio proxy shim adds a dependency.** Verified: `@composio/mcp` or a
  60–120 LoC hand-rolled proxy in `bin/composio-proxy.mjs` can pipe stdio MCP
  to Composio's HTTPS endpoint (revised upward from the original ~30 LoC
  estimate after reference-implementation review — see Phase 3.1
  deepen-plan note). Per-session startup cost is one Node process
  (negligible).
- **Status files vs. live keychain probing.** Status files require SessionStart
  hook to have fired at least once. First-install state is ambiguous. Mitigation:
  setup:all treats "file absent" as "credential status unknown — restart Claude
  Code to populate."
- **`required: true` removal.** Composio currently uses `required: true` on
  both fields. Per research, this fires at MCP startup not install. Removing it
  (in favor of wrapper-side empty-string detection) makes the plugin install
  gracefully without prompting confusion when users dismiss prompts.

### Status File Schema (D4)

```json
{
  "plugin": "yellow-composio",
  "version": "1.3.0",
  "session_ts": "2026-05-11T22:08:35Z",
  "credentials": [
    {
      "field": "composio_mcp_url",
      "source": "userConfig",
      "present": true,
      "valid": true
    },
    {
      "field": "composio_api_key",
      "source": "shell_env",
      "present": true,
      "valid": null
    }
  ]
}
```

- `source`: one of `userConfig`, `shell_env`, `absent`
- `present`: boolean — non-empty value resolved from either path
- `valid`: optional — `null` if unverified, `true` after a live probe,
  `false` if probe failed
- File is rewritten on every SessionStart (no append; full overwrite)
- Cleanup: file deleted on `/plugin disable`; recreated on next SessionStart

## Implementation Plan

### Phase 1: Status-File Protocol Foundation

- [ ] 1.1 Author `docs/plugin-credential-status-protocol.md` documenting the
       schema, invalidation rules, and reader/writer responsibilities.
- [ ] 1.2 Add a reusable Bash helper at
       `plugins/yellow-core/lib/credential-status.sh` exposing
       `write_credential_status(plugin, version, fields_json)` for hooks to
       call. Source from `${CLAUDE_PLUGIN_ROOT}/lib/credential-status.sh`.

<!-- deepen-plan: codebase -->
> **Codebase:** `plugins/yellow-core/lib/` directory does NOT exist today.
> Only `plugins/yellow-morph/lib/` exists (`install-morphmcp.sh`). Phase 1.2
> creates the `yellow-core/lib/` directory from scratch. Because the helper
> lives in `yellow-core/lib/` (not the consuming plugin's own
> `${CLAUDE_PLUGIN_ROOT}/lib/`), adopter plugins source it via the
> cross-plugin path documented in `docs/plugin-credential-status-protocol.md`:
> `source "${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/credential-status.sh"`.
> Adopters that need yellow-core-independent install must copy the helper
> inline (also called out in the protocol doc's writer contract).
<!-- /deepen-plan -->
- [ ] 1.3 Unit test the helper with bats: file absent → write succeeds;
       file present + new schema → overwrite preserves valid JSON; jq
       missing → falls back to printf-based JSON construction with
       conservative defaults.
- [ ] 1.4 Add reference snippet to `AGENTS.md` "Credential Status Protocol"
       section so future plugins follow the same shape.

### Phase 2: yellow-semgrep Env-Fallback Fix (lowest-risk, highest-value)

- [ ] 2.1 Add `plugins/yellow-semgrep/bin/start-semgrep.sh` mirroring the
       `start-perplexity.sh` pattern:
       userConfig wins → shell env fallback → unset empty before exec.
- [ ] 2.2 Update `plugins/yellow-semgrep/.claude-plugin/plugin.json`:
       - Replace `"command": "semgrep", "args": ["mcp"]` with
         `"command": "${CLAUDE_PLUGIN_ROOT}/bin/start-semgrep.sh"`
       - Replace `"SEMGREP_APP_TOKEN": "${user_config.semgrep_app_token}"`
         with `_USERCONFIG` + bare-env-passthrough pair
- [ ] 2.3 Add SessionStart hook `hooks/write-credential-status.sh` invoking
       the lib helper. Wire in `plugin.json.hooks.SessionStart`.
- [ ] 2.4 Mark `chmod +x bin/start-semgrep.sh hooks/write-credential-status.sh`;
       add to `.gitattributes` LF rule.
- [ ] 2.5 Update `plugins/yellow-semgrep/CLAUDE.md` documenting the env-var
       contract and that `SEMGREP_APP_TOKEN` env now takes effect as a
       fallback when userConfig is empty.
- [ ] 2.6 Bats test: wrapper exec env where userConfig empty + shell env
       set → `SEMGREP_APP_TOKEN` non-empty in exec environment.

### Phase 3: yellow-composio Stdio Conversion + Env Fallback

- [ ] 3.1 Spike: verify `@composio/mcp` (or equivalent) exposes a stdio MCP
       relay accepting `--url` and `--header` flags. If not, write
       `plugins/yellow-composio/bin/composio-proxy.mjs` (60–120 LoC stdio↔HTTPS
       proxy using Node's built-in `https` and `process.stdin`/`stdout`; see
       the deepen-plan research note below for the revised LoC budget).

<!-- deepen-plan: external -->
> **Research:** Spike inputs identified:
> - `@composio/mcp@1.0.9` (npm, ISC license, 9.1K weekly downloads, 7
>   Composio maintainers, last published Aug 2025) — has `setup.ts` and
>   `start.ts` CLI subcommands. The `start` subcommand is the likely stdio
>   relay entrypoint. Expected invocation form (per OpenClaw integration):
>   `npx @composio/mcp@1.0.9 start --api-key $KEY` — but exact flags need
>   empirical verification because the package's public docs only cover the
>   `setup` subcommand.
> - `composio-mcp` (separate npm package referenced in OpenClaw's
>   `mcporter.json` as `{"command": "composio-mcp", "args": ["--api-key",
>   "KEY"], "transport": "stdio"}` proxying to
>   `https://connect.composio.dev/mcp`). Treat with moderate confidence —
>   may be an alias for `@composio/mcp`.
> - Generic fallback: [`mcp-proxy`](https://www.npmjs.com/package/mcp-proxy)
>   (npm v6.4.6) or PyPI v0.11.0 (287K downloads/month) — well-maintained
>   stdio↔Streamable HTTP/SSE bridge. Used by FastMCP.
> - Hand-roll reference: [inference-sh/mcp-bridge](https://github.com/inference-sh/mcp-bridge)
>   (MIT) — closest single-file reference for stdio→HTTP POST with auth
>   header. Hand-roll budget realistic at **60–120 LoC** (not the 30 LoC
>   originally claimed in this plan).
> - Spike order: try `npx @composio/mcp@latest start --help` first to
>   confirm the relay flags exist. If not, evaluate `mcp-proxy` next. Hand-roll
>   only if both fail.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** No stdio↔HTTP proxy precedent anywhere in this repo. The
> only `${CLAUDE_PLUGIN_DATA}` consumer is yellow-morph's wrapper that runs
> an npm-installed binary locally — fundamentally different from the
> network-proxy pattern needed here. yellow-composio will be establishing
> a new pattern; document the rationale prominently in
> `plugins/yellow-composio/CLAUDE.md` for future maintainers.
<!-- /deepen-plan -->
- [ ] 3.2 Convert `plugins/yellow-composio/.claude-plugin/plugin.json`
       `mcpServers.composio-server`:
       - `"type": "stdio"` (or omit; stdio is default for command-type)
       - `"command": "${CLAUDE_PLUGIN_ROOT}/bin/start-composio.sh"`
       - Add `env` block with the 4 entries from the Path B preview
         (`COMPOSIO_MCP_URL_USERCONFIG`, `COMPOSIO_MCP_URL`,
         `COMPOSIO_API_KEY_USERCONFIG`, `COMPOSIO_API_KEY`)
       - Drop `"url"` and `"headers"` blocks
       - Drop `"required": true` from both userConfig fields (per research:
         required fires at startup not install; wrapper handles graceful
         OFFLINE state)
- [ ] 3.3 Author `plugins/yellow-composio/bin/start-composio.sh`:
       - Resolve userConfig → shell env precedence for both URL and API key
       - If URL is empty OR non-HTTPS → printf clear error to stderr and
         `exit 1` (blocks MCP start, no cascade to `claude doctor`)
       - exec the proxy with resolved values

<!-- deepen-plan: external -->
> **Research:** MCP stdio transport framing per the
> [MCP transports spec](https://modelcontextprotocol.io/docs/concepts/transports):
> "Stdio messages are delimited by newlines and must not contain embedded
> newlines." Newline-delimited JSON, NOT Content-Length framed (LSP-style).
> One JSON-RPC object per line. If hand-rolling the proxy, this is the
> framing contract — `readline.createInterface({input: process.stdin})`
> and `console.log(JSON.stringify(...))` are correct primitives. Composio's
> `https://connect.composio.dev/mcp` endpoint is request/response HTTP
> (no persistent SSE/WebSocket required) — confirmed across Claude Code,
> Codex, Vercel AI SDK, and OpenClaw integration docs. Proxy can use plain
> Node 18+ `fetch()` with `await response.json()`.
<!-- /deepen-plan -->
- [ ] 3.4 Update `plugins/yellow-composio/hooks/check-mcp-url.sh` to also
       write the status file (or replace with a single SessionStart hook
       that does both warning + status emission).
- [ ] 3.5 Update `plugins/yellow-composio/CLAUDE.md`, README, and the
       command surface (`/composio:setup`, `/composio:status`) to reflect
       the new env-var contract (`COMPOSIO_MCP_URL`, `COMPOSIO_API_KEY`).
- [ ] 3.6 Migration note in changeset: existing users with a working
       userConfig install will be unaffected. Users on legacy install
       paths with `type: http` cached must run
       `/plugin disable yellow-composio && /plugin enable yellow-composio`
       after update.
- [ ] 3.7 Bats test: wrapper blocks startup with empty URL; wrapper resolves
       shell env when userConfig empty; wrapper rejects non-HTTPS URL.

### Phase 4: yellow-research Status File (env detection upgrade)

- [ ] 4.1 Add SessionStart hook at
       `plugins/yellow-research/hooks/write-credential-status.sh` emitting
       status for all 3 keys (perplexity, tavily, exa) + ceramic OAuth
       state + parallel OAuth state + ast-grep availability.
- [ ] 4.2 No `plugin.json` changes needed (3-element fallback is already in
       place). Just wire the hook.
- [ ] 4.3 Verify the SessionStart hook reads `CLAUDE_PLUGIN_OPTION_*` for
       userConfig presence detection without needing the keychain.

### Phase 5: `/setup:all` Dashboard Updates

- [ ] 5.1 Add a Step 1 sub-block (after env-var probes) that reads each
       credential-bearing plugin's status file:
       ```bash
       for plugin in yellow-research yellow-composio yellow-semgrep yellow-morph; do
         status_file="$HOME/.claude/plugins/data/${plugin}/credential-status.json"
         if [ -f "$status_file" ]; then
           # jq extract: present count, source breakdown
         else
           # file absent → label "credential status unknown"
         fi
       done
       ```
- [ ] 5.2 Update yellow-research classification block (lines 304-320 of
       `commands/setup/all.md`): READY = (status file shows ≥6/6 sources
       present) OR (legacy fallback to current shell-env-only check).
- [ ] 5.3 Update yellow-composio classification block (lines 370-375):
       NEEDS SETUP = status file shows URL absent OR file absent.
       PARTIAL = URL present, API key absent.
       READY = both present + ToolSearch confirms `mcp__plugin_yellow-composio_*` visible.
- [ ] 5.4 Add yellow-semgrep classification using status file (currently
       relies on shell env probe only).
- [ ] 5.5 Add Step 1.7 (new): version-drift check via
       `claude plugin list --json --available 2>/dev/null | jq ...`
       cached to `~/.claude/plugins/data/yellow-core/version-check-cache.json`
       with 24h TTL. On miss/staleness, run live. Report per-plugin:
       CURRENT / OUTDATED (with available version) / UNKNOWN.

<!-- deepen-plan: external -->
> **Research:** `claude plugin list --json --available` schema partially
> documented. Confirmed fields per `installed` entry: `id` (string),
> `version` (string), `scope` (`"user"|"project"|"local"`), `enabled`
> (boolean), `installPath` (string). The `available` array structure is
> not directly observed in public docs but likely mirrors marketplace.json
> fields (`name`, `description`, `version`, `repository`). Flag stability:
> confirmed stable in current Claude Code (used by Claude Desktop VM per
> [#31408](https://github.com/anthropics/claude-code/issues/31408)).
> [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
> documents the flag but not the full output schema — Phase 5.5 spike
> should run `claude plugin list --json --available > /tmp/sample.json`
> on a host with both updated and outdated plugins and snapshot the actual
> schema into the protocol doc.
<!-- /deepen-plan -->
<!-- deepen-plan: codebase -->
> **Codebase:** Line numbers verified against `commands/setup/all.md`:
> yellow-semgrep block lines **296–300**, yellow-research block lines
> **302–321** (plan originally said 304–320 — start is 302, not 304),
> yellow-browser-test block lines **359–363** (plan said 359–364; 363 is
> the actual end), yellow-composio block lines **370–375** (exact match).
> Step 1.5 ToolSearch probes (line 221+) currently run exactly 5: linear's
> `list_user_organizations`, `list_teams`, parallel's `createDeepResearch`,
> `ast-grep__find_code`, `ceramic_search`. Phase 5.5/5.6 must add probes
> here, not at a different location.
<!-- /deepen-plan -->

- [ ] 5.6 Update yellow-browser-test classification (lines 359-364):
       run web-app heuristic scan FIRST. If no signals AND
       `.claude/yellow-browser-test.local.md` absent → omit from dashboard
       entirely (no PARTIAL/NEEDS SETUP row). If signals present + file
       absent → emit "RECOMMENDED: web app detected; run
       `/browser-test:setup` to enable testing."
       Heuristic signals (any one positive):
       - `package.json` deps match
         `(next|react|vue|svelte|astro|nuxt|remix|express|fastify|koa|hono|gatsby|vite|webpack-dev-server|@angular/core|lit|solid-js|preact|alpinejs)`
       - `vercel.json`, `netlify.toml`, `fly.toml`, `render.yaml` present
       - `Gemfile` contains `rails`
       - `requirements.txt` or `pyproject.toml` matches
         `django|flask|fastapi|starlette|sanic`
       - `go.mod` matches `gin-gonic|echo|fiber|chi|gorilla/mux`
       - `Cargo.toml` matches `axum|actix-web|rocket|warp`
       - `docker-compose.yml` has any service with HTTP port mapping

<!-- deepen-plan: codebase -->
> **Codebase:** The `app-discoverer` agent at
> `plugins/yellow-browser-test/agents/testing/app-discoverer.md` already
> handles some of these signals (Rails `config/routes.rb`, Django `urls.py`
> mentioned in example at line 24). The "If no `package.json`" block at
> **lines 63–78** is the augmentation point for `go.mod`, `Cargo.toml`,
> `fly.toml`, `requirements.txt`, and `pyproject.toml` Python detection.
> Update the dashboard heuristic AND this agent together to keep
> classification and discovery in sync.
<!-- /deepen-plan -->

- [ ] 5.7 Add a Step 4 (new): consolidated remediation block. If any
       outdated plugins, print one consolidated `/plugin update <name>`
       command list. If any drift-detector status files show
       newly-added userConfig fields, print one consolidated
       `/plugin disable <name> && /plugin enable <name>` command list.

### Phase 6: Multi-Host SKILL.md

- [ ] 6.1 Create `plugins/yellow-core/skills/multi-host-fleet/SKILL.md` with
       three standard headings:
       - `## What It Does`: Document env-var contract for fleet-deployable
         plugins.
       - `## When to Use`: New host setup, CI deployment, devcontainer,
         WSL2 + Windows duality, ephemeral sandbox bootstrap.
       - `## Usage`: Three subsections:
         - `### Dev hosts (dotfiles + shell rc + direnv)`
         - `### CI/CD (GitHub Actions secrets, GitLab CI variables,
           devcontainer.json)`
         - `### Secrets managers (1Password CLI op run, Vault envconsul,
           Doppler, generic env-file pattern)` — tool-agnostic; brief
           per-tool example
- [ ] 6.2 Include canonical env-var contract table for all credential-bearing
       plugins:
       | Plugin | Env Var | userConfig field | Type |
       |--------|---------|------------------|------|
       | yellow-research | `EXA_API_KEY` | `exa_api_key` | sensitive |
       | yellow-research | `TAVILY_API_KEY` | `tavily_api_key` | sensitive |
       | yellow-research | `PERPLEXITY_API_KEY` | `perplexity_api_key` | sensitive |
       | yellow-research | `CERAMIC_API_KEY` | (none; OAuth + REST probe) | optional |
       | yellow-morph | `MORPH_API_KEY` | `morph_api_key` | sensitive |
       | yellow-semgrep | `SEMGREP_APP_TOKEN` | `semgrep_app_token` | sensitive |
       | yellow-composio | `COMPOSIO_MCP_URL` | `composio_mcp_url` | non-sensitive |
       | yellow-composio | `COMPOSIO_API_KEY` | `composio_api_key` | sensitive |
       | yellow-devin | `DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID` | (none) | sensitive (env-only) |
- [ ] 6.3 Add an `## Examples` subsection with a complete `.envrc` and
       `.zshrc` snippet (commented, so users can selectively enable).
- [ ] 6.4 Cross-reference: mention in
       `plugins/yellow-core/skills/mcp-health-probe/SKILL.md` and
       `plugins/yellow-research/CLAUDE.md`, README files.

### Phase 7: Validator Additions (D6 — warnings, not blocking)

<!-- deepen-plan: codebase -->
> **Codebase:** `scripts/validate-plugin.js` is 1122 lines with rules
> numbered RULE 1–11 in comments. Existing mcpServers parsing at lines
> **618–628** only does path validation; no content inspection. New rules
> should be RULE 12+ inserted between the end of RULE 11 (line 1004) and
> the summary block (line 1006). Entry point is `validatePlugin()` at
> line 485. New rules iterate `manifest.mcpServers` and inspect `env`
> values for bare `${user_config.xxx}` patterns (no `_USERCONFIG` suffix
> alongside a `${VAR:-}` passthrough = warning).
<!-- /deepen-plan -->

- [ ] 7.1 Add a `validate-plugin.js` rule (warning only):
       userConfig fields marked `required: true` AND `sensitive: true` SHOULD
       have an associated wrapper script + env-passthrough block. Emit
       `[warn] yellow-composio: composio_api_key is required+sensitive but no
       shell env fallback found — consider 3-element fallback pattern.`
- [ ] 7.2 Add a `validate-plugin.js` rule (warning only):
       MCP server `command` blocks that interpolate `${user_config.X}`
       directly (not via wrapper script) miss the empty-string-unset
       safety. Recommend wrapper indirection.
- [ ] 7.3 Test fixtures in `tests/unit/validate-plugin/`:
       - `fixture-required-no-fallback.json` (expects 1 warning)
       - `fixture-required-with-wrapper.json` (expects 0 warnings)
       - `fixture-direct-substitution.json` (expects 1 warning)
- [ ] 7.4 Update `docs/plugin-validation-guide.md` documenting the two new
       warning categories.

### Phase 8: Migration, Documentation, Release

- [ ] 8.1 Add `docs/solutions/build-errors/userconfig-required-fires-at-startup-not-install.md`
       documenting the GH #39827 + #39455 behavior and the wrapper-pattern
       workaround.
- [ ] 8.2 Update `AGENTS.md` "Critical Agent Authoring Rules" with a new
       entry: "Credential-bearing MCPs must use the 3-element wrapper
       pattern; see multi-host-fleet SKILL.md."

<!-- deepen-plan: codebase -->
> **Codebase:** `AGENTS.md` is 306 lines. Two candidate insertion points:
> "Plugin Manifest Rules" section starting at line **159** (preferred —
> the rule is about manifest shape, not security policy) or "Security &
> Prompt-Injection Rules" at line **216** (already lists `SEMGREP_APP_TOKEN`
> and `MORPH_API_KEY` in the never-commit list at line 238). Use the
> Plugin Manifest Rules location. Also: `.changeset/` currently has only
> `config.json` (no pending changesets), and the per-plugin changeset
> shape follows `@changesets/changelog-github` format.
<!-- /deepen-plan -->
- [ ] 8.3 Per-plugin changesets:
       - yellow-semgrep: minor (env-fallback added)
       - yellow-composio: minor (env-fallback + stdio conversion;
         migration note in changeset)
       - yellow-research: patch (SessionStart hook only; no behavioral
         change)
       - yellow-core: minor (setup:all enhancements + new SKILL.md)
- [ ] 8.4 Update root `README.md` if env-var contract belongs on the
       front page (skip if it's discoverable via the skill).
- [ ] 8.5 Run `pnpm release:check` and `pnpm validate:setup-all` per Phase.

## Technical Specifications

### Files to Modify

- `plugins/yellow-semgrep/.claude-plugin/plugin.json` — env block rewrite,
  command→wrapper, hooks block added
- `plugins/yellow-semgrep/CLAUDE.md` — env-var contract section
- `plugins/yellow-composio/.claude-plugin/plugin.json` — type:http →
  command+stdio, env block, required:true removal
- `plugins/yellow-composio/hooks/check-mcp-url.sh` — also emit status file
- `plugins/yellow-composio/CLAUDE.md` and `README.md` — env-var contract,
  migration note
- `plugins/yellow-research/hooks/` — new SessionStart hook (or extend
  existing if any)
- `plugins/yellow-core/commands/setup/all.md` — Step 1.5 status-file
  readers, Step 1.7 version drift, Step 4 consolidated remediation,
  classification block updates for browser-test/research/composio/semgrep
- `AGENTS.md` — credential-status protocol reference, new authoring rule
- `docs/plugin-validation-guide.md` — two new warning categories
- `scripts/validate-plugin.js` — two new rules (warnings only)

### Files to Create

- `plugins/yellow-core/lib/credential-status.sh` — reusable Bash helper
- `plugins/yellow-semgrep/bin/start-semgrep.sh` — wrapper
- `plugins/yellow-semgrep/hooks/write-credential-status.sh` — SessionStart
- `plugins/yellow-composio/bin/start-composio.sh` — wrapper
- `plugins/yellow-composio/bin/composio-proxy.mjs` — stdio↔HTTPS proxy
  (if external relay not viable)
- `plugins/yellow-research/hooks/write-credential-status.sh` — SessionStart
- `plugins/yellow-core/skills/multi-host-fleet/SKILL.md` — fleet doc
- `docs/plugin-credential-status-protocol.md` — protocol spec
- `docs/solutions/build-errors/userconfig-required-fires-at-startup-not-install.md`
- Bats test files in `plugins/yellow-semgrep/tests/`,
  `plugins/yellow-composio/tests/`, `plugins/yellow-core/tests/`

### Dependencies

- No new external runtime deps if `composio-proxy.mjs` is hand-rolled
  (60–120 LoC per the Phase 3.1 deepen-plan research above, using Node
  18+ builtin `https` and `process.stdin/stdout`).
- If external relay package is chosen (Phase 3.1 spike outcome), pin via
  `npx -y @composio/mcp@<version>` and document supported range.

### API Changes

**Composio MCP transport: HTTP → stdio.** Externally observable change
(invisible to tool callers; same MCP tool surface). MCP client (Claude
Code) connects via stdio to wrapper → wrapper proxies stdio JSON-RPC to
Composio's HTTPS endpoint. No tool name changes.

### Database Changes

N/A.

## Testing Strategy

### Unit Tests

- `credential-status.sh` lib: file absence, presence, malformed JSON,
  schema field validation, jq absence fallback
- `validate-plugin.js` new rules: fixture-based test additions
- `start-semgrep.sh`, `start-composio.sh` wrapper precedence (bats)

### Integration Tests

- `tests/integration/setup-all.test.ts`: mock status files in temp
  `${CLAUDE_PLUGIN_DATA}` directories, run setup:all classification, assert
  output reports correct READY/PARTIAL/NEEDS SETUP
- Composio proxy round-trip test: stdio JSON-RPC → HTTPS → response (uses
  test fixture server)

### Manual Testing Checklist

- [ ] Fresh install on Linux WSL2 with no shell env, answer userConfig
       prompts for all credential-bearing plugins → all READY
- [ ] Fresh install with all shell env vars exported, dismiss all userConfig
       prompts → all READY (env-fallback works end-to-end)
- [ ] Upgrade from yellow-composio v1.2.x (`type: http`) to v1.3.0
       (`type: stdio`) → MCP still works after `/plugin update` +
       Claude Code restart; status file populated after first SessionStart
- [ ] Dotfiles repo (no web app) → yellow-browser-test omitted from
       dashboard entirely; no NEEDS SETUP banner
- [ ] React project with no `.claude/yellow-browser-test.local.md` →
       RECOMMENDED banner with "/browser-test:setup" suggestion
- [ ] Stale plugin install (version drift detected) → consolidated
       `/plugin update` list shown in Step 4

## Acceptance Criteria

1. yellow-semgrep + yellow-composio honor shell env as a fallback when
   userConfig is empty. Verified by wrapper exec env test and live MCP
   startup with `SEMGREP_APP_TOKEN`/`COMPOSIO_API_KEY` exported.
2. yellow-composio with empty URL fails to start (wrapper exits non-zero)
   instead of cascading to `claude doctor` failures for other MCPs.
   Verified by `claude doctor` output before/after on a host with empty
   composio URL.
3. `/setup:all` correctly classifies yellow-research as READY when keys
   are in keychain (not shell env). Verified by setup-all output diff.
4. `/setup:all` omits yellow-browser-test from the dashboard on
   non-web-app repos. Verified by running in dotfiles repo with no
   web-app signals.
5. `/setup:all` reports plugin version drift when installed < catalog
   (with 24h cache). Verified by mocking outdated installed_plugins.json.
6. Multi-host SKILL.md is discoverable via `find-skills` and lists every
   credential-bearing plugin's env-var contract. Verified by
   `pnpm validate:agents`.
7. `pnpm release:check`, `pnpm validate:setup-all`, `pnpm test:unit`,
   `pnpm test:integration` all pass.

## Edge Cases & Error Handling

- **First-install state (no status file yet):** setup:all labels affected
  plugins "credential status unknown — restart Claude Code to populate."
  Not an error; expected ambiguity.
- **macOS keychain not readable from Bash:** setup:all does NOT attempt
  `security find-generic-password`. Relies on status file (SessionStart
  hook can read `CLAUDE_PLUGIN_OPTION_*` from its own subprocess env).
- **Inter-session window after `/plugin update`:** New userConfig fields
  added in an upgrade do not auto-re-prompt. setup:all Step 4 detects
  this via status file diff (fields in plugin.json not in status file)
  and emits "run `/plugin disable && /plugin enable`."
- **`claude plugin list` not available (older Claude Code):** Step 1.7
  feature-detects via `command -v claude && claude plugin list --help`;
  silently skips version-drift check if unsupported.
- **Composio proxy crash mid-session:** stdio MCPs reconnect automatically.
  Wrapper exits cleanly; Claude Code restarts the process. Status file
  remains valid (last-known SessionStart state).
- **`${VAR}` substitution broken in HTTP MCP `headers` (Path A
  alternative):** Confirmed Claude Code bug — see
  [#51581](https://github.com/anthropics/claude-code/issues/51581) and
  [#47789](https://github.com/anthropics/claude-code/issues/47789).
  This is why Path B (wrapper + stdio) is the only reliable path for
  env-var fallback on yellow-composio. Document this rationale in
  `plugins/yellow-composio/CLAUDE.md` so future maintainers understand
  why the plugin diverges from Composio's official `--transport http`
  recommendation.
- **`${CLAUDE_PLUGIN_DATA}` write permission prompt
  ([#41156](https://github.com/anthropics/claude-code/issues/41156),
  open):** SessionStart hooks writing the status file may trigger a
  protected-directory prompt in restricted permission modes. Hook must
  fail gracefully (write attempt → `2>/dev/null || true` → emit
  `{"continue": true}` regardless) so SessionStart never blocks the
  session.
- **`${CLAUDE_PLUGIN_DATA}` not persistent in Cowork Desktop
  ([#51398](https://github.com/anthropics/claude-code/issues/51398),
  open):** In Cowork Desktop sessions the directory is session-scoped.
  setup:all should treat "status file absent" as expected, not as
  configuration-error.
- **WSL2 CRLF on new `.sh` and `.mjs` files:** Normalize per existing
  protocol (`sed -i 's/\r$//'`); add a Phase 8.6 task if not already
  enforced by repo `.gitattributes`.

## Performance Considerations

- `claude plugin list --json --available` is a network call; cached with
  24h TTL. Setup:all worst case adds one HTTP fetch per day per workspace.
- Status-file reads in setup:all add ~5-10 jq calls in Step 1 — sub-100ms
  overhead.
- Composio proxy adds a Node startup per session (~200ms cold start).
  Acceptable for non-hot-path MCP.

## Security Considerations

- Wrapper unsets empty-string env vars before exec — preserves
  "absent vs. explicitly empty" distinction that MCP servers may rely on.
- Composio wrapper exits non-zero on non-HTTPS URL — prevents API key
  leakage over cleartext.
- Status file lives under `${CLAUDE_PLUGIN_DATA}` (0700 dir on Linux);
  contains source labels (`userConfig`/`shell_env`/`absent`) but NEVER
  the credential value itself. Validate this in Phase 1.3 schema test.
- Env vars are visible to MCP subprocesses (same as existing
  yellow-research pattern); document in multi-host SKILL.md security
  section as expected behavior.

## Migration & Rollback

### Deployment Steps

Each phase ships as an independent PR; Phase 1 (foundation) is the only
blocking dependency. Phases 2–4 can ship in parallel after Phase 1
merges. Phase 5 depends on Phases 2–4 (needs status files in place).
Phase 6 and 7 are independent. Phase 8 ships last.

Recommended order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. PRs 2 and 3 can stack
behind 1 in a Graphite stack; PRs 4–8 sequential.

### Rollback Procedure

- yellow-semgrep: revert plugin.json + delete bin/, hooks/ additions. No
  data migration needed.
- yellow-composio: revert plugin.json (type:http restored) + delete
  bin/, proxy. Existing userConfig values remain in keychain (no data
  loss). Users keep working setups.
- setup:all: revert all.md to prior commit. Status files become orphans
  but harmless (Claude Code ignores files outside its schema).
- Version cache: delete `~/.claude/plugins/data/yellow-core/version-check-cache.json`
  to force re-fetch.

### Breaking Changes

- **Composio MCP transport change** (`type: http` → `type: stdio`): users
  on legacy installs must run `/plugin disable && /plugin enable` after
  Claude Code restart. Documented in v1.3.0 changeset.
- **yellow-semgrep behavior change**: shell env `SEMGREP_APP_TOKEN` now
  takes effect when userConfig is empty. Previously a no-op. Not breaking
  per se but worth noting.
- **`required: true` removed from yellow-composio fields**: install no
  longer fails on dismissed prompts (it never did anyway per research,
  but the schema-level signal is gone). Wrapper handles the empty-state
  with a clear error message.

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/feat/credential-status-protocol

- **Type:** feat
- **Description:** add credential-status protocol + yellow-core lib helper
- **Scope:**
  - `plugins/yellow-core/lib/credential-status.sh`
  - `docs/plugin-credential-status-protocol.md`
  - `AGENTS.md`
  - `plugins/yellow-core/tests/credential-status.bats`
  - `.changeset/`
- **Tasks:** 1.1, 1.2, 1.3, 1.4
- **Depends on:** (none)

### 2. agent/fix/yellow-semgrep-env-fallback

- **Type:** fix
- **Description:** honor shell env as fallback for SEMGREP_APP_TOKEN
- **Scope:**
  - `plugins/yellow-semgrep/.claude-plugin/plugin.json`
  - `plugins/yellow-semgrep/bin/start-semgrep.sh`
  - `plugins/yellow-semgrep/hooks/write-credential-status.sh`
  - `plugins/yellow-semgrep/CLAUDE.md`
  - `plugins/yellow-semgrep/tests/`
  - `.changeset/`
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
- **Depends on:** #1

### 3. agent/feat/yellow-composio-stdio-fallback

- **Type:** feat
- **Description:** convert yellow-composio to type:stdio with proxy + env fallback
- **Scope:**
  - `plugins/yellow-composio/.claude-plugin/plugin.json` (transport change)
  - `plugins/yellow-composio/bin/start-composio.sh`
  - `plugins/yellow-composio/bin/composio-proxy.mjs`
  - `plugins/yellow-composio/hooks/check-mcp-url.sh` (status emit)
  - `plugins/yellow-composio/CLAUDE.md`
  - `plugins/yellow-composio/README.md`
  - `plugins/yellow-composio/tests/`
  - `.changeset/`
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
- **Depends on:** #2

### 4. agent/feat/yellow-research-status-hook

- **Type:** feat
- **Description:** emit credential-status.json from SessionStart for yellow-research
- **Scope:**
  - `plugins/yellow-research/hooks/write-credential-status.sh`
  - `plugins/yellow-research/.claude-plugin/plugin.json` (hooks block)
  - `plugins/yellow-research/CLAUDE.md`
  - `.changeset/`
- **Tasks:** 4.1, 4.2, 4.3
- **Depends on:** #3

### 5. agent/feat/setup-all-status-classification

- **Type:** feat
- **Description:** classify plugins via status files + version drift in /setup:all
- **Scope:**
  - `plugins/yellow-core/commands/setup/all.md`
  - `plugins/yellow-browser-test/agents/testing/app-discoverer.md`
  - `.changeset/`
- **Tasks:** 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
- **Depends on:** #4

### 6. agent/feat/validate-plugin-credential-warnings

- **Type:** feat
- **Description:** warn on required+sensitive userConfig fields without wrapper indirection
- **Scope:**
  - `scripts/validate-plugin.js` (RULE 12+13)
  - `packages/infrastructure` tests
  - fixtures
  - `docs/plugin-validation-guide.md`
- **Tasks:** 7.1, 7.2, 7.3, 7.4
- **Depends on:** #5

### 7. agent/docs/multi-host-fleet-skill

- **Type:** docs
- **Description:** multi-host fleet SKILL.md + migration solution doc + release notes
- **Scope:**
  - `plugins/yellow-core/skills/multi-host-fleet/SKILL.md`
  - `docs/solutions/build-errors/userconfig-required-fires-at-startup-not-install.md`
  - `AGENTS.md`
  - `plugins/yellow-research/README.md`
  - `plugins/yellow-morph/README.md`
  - `plugins/yellow-semgrep/README.md`
  - `plugins/yellow-composio/README.md`
  - `.changeset/`
- **Tasks:** 6.1, 6.2, 6.3, 6.4, 8.1, 8.2, 8.3, 8.4, 8.5
- **Depends on:** #6

## Stack Progress
<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. agent/feat/credential-status-protocol (completed 2026-05-13, PR #510)
- [x] 2. agent/fix/yellow-semgrep-env-fallback (completed 2026-05-13, PR #511)
- [x] 3. agent/feat/yellow-composio-stdio-fallback (completed 2026-05-13, PR #512)
- [x] 4. agent/feat/yellow-research-status-hook (completed 2026-05-13)
- [ ] 5. agent/feat/setup-all-status-classification
- [ ] 6. agent/feat/validate-plugin-credential-warnings
- [ ] 7. agent/docs/multi-host-fleet-skill

## References

- Research findings: `docs/research/claude-code-plugins-versioning-auto-upda.md`
- Solution docs:
  - `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
  - `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`
  - `docs/solutions/integration-issues/heredoc-delimiter-collision.md`
- Brainstorms:
  - `docs/brainstorms/2026-03-01-yellow-research-setup-mcp-health-checks-brainstorm.md`
  - `docs/brainstorms/2026-05-06-ceramic-setup-all-coverage-audit-brainstorm.md`
  - `docs/brainstorms/2026-03-04-setup-all-command-brainstorm.md`
- Existing patterns to follow:
  - `plugins/yellow-research/.claude-plugin/plugin.json` (3-element fallback)
  - `plugins/yellow-research/bin/start-perplexity.sh` (wrapper precedence)
  - `plugins/yellow-morph/.claude-plugin/plugin.json` + `bin/start-morph.sh`
  - `plugins/yellow-core/skills/mcp-health-probe/SKILL.md` (OFFLINE/DEGRADED/HEALTHY)
  - `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md`
- Anthropic docs:
  - https://code.claude.com/docs/en/plugins-reference (userConfig, env substitution, `${CLAUDE_PLUGIN_OPTION_*}`, `claude plugin list --json --available`)
  - https://www.schemastore.org/claude-code-plugin-manifest.json (allowed userConfig fields)
- Tracked GitHub issues (open as of 2026-05-11):
  - anthropics/claude-code#39827 (userConfig prompt not shown on install)
  - anthropics/claude-code#39455 (userConfig values not prompted on enable)
  - anthropics/claude-code#31462 (plugin update detection workflow)
  - anthropics/claude-code#15642 (CLAUDE_PLUGIN_ROOT stale after update)
  - anthropics/claude-code#17361 (autoUpdate doesn't update what Claude reads)
  - anthropics/claude-code#26744 (third-party marketplace auto-update bug, this repo's docs)

<!-- deepen-plan: external -->
> **Research:** Additional GitHub issues + external sources surfaced
> during enrichment:
> - [anthropics/claude-code#51581](https://github.com/anthropics/claude-code/issues/51581) —
>   `${VAR}` not substituted in HTTP MCP `headers` (closed Apr 2026 as
>   "completed"; specific fix version not cited)
> - [anthropics/claude-code#47789](https://github.com/anthropics/claude-code/issues/47789) —
>   `headersHelper` does not expand `${CLAUDE_PLUGIN_ROOT}` (open May 2026)
> - [anthropics/claude-code#41156](https://github.com/anthropics/claude-code/issues/41156) —
>   `${CLAUDE_PLUGIN_DATA}` protected-directory prompt in bypassPermissions
>   (open)
> - [anthropics/claude-code#51398](https://github.com/anthropics/claude-code/issues/51398) —
>   `${CLAUDE_PLUGIN_DATA}` session-scoped in Cowork Desktop (open)
>
> External packages identified for Phase 3 spike:
> - [`@composio/mcp@1.0.9`](https://www.npmjs.com/package/@composio/mcp)
>   (npm, ISC, 9.1K weekly downloads, `start` and `setup` subcommands)
> - [`composio-mcp`](https://composio.dev/content/how-to-use-composio-mcp-with-openclaw) —
>   alternate package name documented in OpenClaw integration
> - [`mcp-proxy`](https://www.npmjs.com/package/mcp-proxy) (npm v6.4.6) /
>   [`mcp-proxy`](https://pypi.org/project/mcp-proxy/) (PyPI v0.11.0,
>   287K downloads/month) — generic stdio↔HTTP bridge
> - [`inference-sh/mcp-bridge`](https://github.com/inference-sh/mcp-bridge) —
>   MIT, reference impl for stdio→HTTP POST + Bearer header
>
> MCP transport spec authoritative reference:
> [modelcontextprotocol.io/docs/concepts/transports](https://modelcontextprotocol.io/docs/concepts/transports) —
> stdio = newline-delimited JSON, one JSON-RPC object per line.
>
> Composio recommended Claude Code integration (diverged from in this plan
> for env-var-fallback parity):
> [docs.composio.dev/docs/composio-connect](https://docs.composio.dev/docs/composio-connect) —
> `claude mcp add --scope user --transport http composio https://connect.composio.dev/mcp --header "x-consumer-api-key: KEY"`.
<!-- /deepen-plan -->
