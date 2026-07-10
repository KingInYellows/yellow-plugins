# Changelog

## 2.0.5

### Patch Changes

- [#634](https://github.com/KingInYellows/yellow-plugins/pull/634)
  [`c7b5ae2`](https://github.com/KingInYellows/yellow-plugins/commit/c7b5ae251853e8e3c1f95872b0752bc1083d2ab5)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Audit doc-drift
  sweep (2026-07-09 full-marketplace audit, Wave 4): add the three standard
  SKILL.md headings (`## What It Does` / `## When to Use` / `## Usage`) to the 8
  skills flagged by RULE 15b — yellow-ci `ci-conventions`
  - `diagnose-ci`, yellow-codex `codex-patterns`, yellow-composio
    `composio-patterns`, yellow-core `create-agent-skills`, yellow-docs
    `docs-conventions`, yellow-research `research-patterns`, yellow-semgrep
    `semgrep-conventions` — clearing every RULE 15b advisory warning. Also adds
    Ceramic to yellow-research's marketplace.json description (mirroring
    plugin.json), and fixes the root README MCP counts against mechanical counts
    (nine MCP-bundling plugins, six yellow-research servers) with a one-line
    yellow-mempalace deprecation footnote under the MCP table.

## 2.0.4

### Patch Changes

- [#623](https://github.com/KingInYellows/yellow-plugins/pull/623)
  [`b124733`](https://github.com/KingInYellows/yellow-plugins/commit/b124733df5690c6e5e73f804ffec51298bab2962)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Align
  `/composio:setup`, `/composio:status`, and the plugin docs with the v2.x
  `command`-type stdio wrapper architecture:
  - `/composio:setup` now checks for `node` 18+ (the bundled wrapper runs
    `node bin/composio-proxy.mjs`, whose proxy calls the global `fetch()` API
    that needs Node 18+) — a present-but-too-old node is reported distinctly
    from `ok` so it routes to "upgrade Node," not "restart." When no Composio
    tools are visible, it reads the plugin's own `credential-status.json` to
    give priority-ordered remediation (install/upgrade node → configure
    credentials → restart), including an explicit "status unknown" case when the
    file is unparseable or `jq` is unavailable. The `jq` reads are null-safe
    (`.credentials[]?` / `// []`). Health states use the `mcp-health-probe`
    vocabulary (OFFLINE / DEGRADED / HEALTHY).
  - `/composio:status` reports `PRESENT (untested)` / `OFFLINE` per the same
    vocabulary and adds a jq install hint to its hard-exit message.
  - Docs: README/CLAUDE.md corrected from the retired `type: http` description
    to the stdio wrapper (with the Node.js requirement); the contradictory
    `required: true` migration sentence fixed.

  No behavior change to the wrapper, proxy, or SessionStart hook.

## 2.0.3

### Patch Changes

- [#601](https://github.com/KingInYellows/yellow-plugins/pull/601)
  [`128149b`](https://github.com/KingInYellows/yellow-plugins/commit/128149b5188fbd0367f8045c799aa3c59e03c727)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  docs(optimization): Tier 1 quick wins C1-C4 — self-description layer fixes.

  C1: rewrite 5 weak `user-invokable: false` skill descriptions
  (security-fencing, research-patterns, codex-patterns, composio-patterns,
  mempalace-conventions) with concrete "Use when" triggers, removing topic
  enumeration and "integration context" boilerplate.

  C2: add one negative-disambiguation clause each to 5 confusable surfaces:
  optimize vs /workflows:review, debugging vs /codex:rescue, session-history vs
  ruvector recall, and /ruvector:memory <-> /mempalace:search pointing at each
  other. Additive only — no existing trigger removed.

  C3: fix stale yellow-core catalogs — CLAUDE.md Skills (13)→(18), README.md
  Skills table 9→18 rows, learnings-researcher.md Integration section corrected
  to the real dispatch sites (/review:pr, /review:review-all, /docs:review).

  C4: split the 168-line Subagent Failure Convention section out of
  create-agent-skills/SKILL.md (513 lines, over its own 500-line ceiling) into
  references/subagent-failure-convention.md behind a load stub that preserves
  the section heading. SKILL.md is now 365 lines.

  Review follow-up: review-pr.md's Step 5 citation now points at the new
  references/subagent-failure-convention.md for the "When the convention
  applies" subsection (the C4 move relocated it out of SKILL.md).

  Doc-only; no scripts, hooks, schemas, or CI behavior change. Root CLAUDE.md
  (C5) and root README recounts ship in the same PR without a changeset (outside
  plugins/).

## 2.0.2

### Patch Changes

- [#566](https://github.com/KingInYellows/yellow-plugins/pull/566)
  [`70813bb`](https://github.com/KingInYellows/yellow-plugins/commit/70813bbb4da3c6d41ccecca1fac8a37c9d374972)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Make hook
  scripts executable and correct stale yellow-composio setup docs.
  - chmod +x the SessionStart/Stop hook scripts in yellow-core
    (`hooks/scripts/stop.sh`, `hooks/scripts/session-start.sh`), yellow-composio
    (`hooks/check-mcp-url.sh`), and yellow-research
    (`hooks/write-credential-status.sh`). This clears the
    `claude plugin validate` "not executable" warnings and aligns these four
    with every other hook script in the repo (all already executable). The hooks
    are registered as `bash ${CLAUDE_PLUGIN_ROOT}/...sh`, so they already ran
    regardless — this is a warning/consistency cleanup, not a behavior change.
  - yellow-composio: fix `commands/composio/setup.md`, which still claimed the
    `userConfig` fields were `required: true`. They are not (the flag was
    removed per claude-code#39827, which does not block install/enable). The
    `bin/start-composio.sh` wrapper's non-zero exit on empty values is the
    actual safeguard. The troubleshooting prose now matches the plugin manifest
    and CLAUDE.md.

## 2.0.1

### Patch Changes

- [#532](https://github.com/KingInYellows/yellow-plugins/pull/532)
  [`be06a57`](https://github.com/KingInYellows/yellow-plugins/commit/be06a571a9e8817870eec61b5844aec3c5182163)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: remediate
  7 security-debt patterns across 6 plugins and root scripts

  Targeted fixes for the security-debt findings (006, 009, 017, 022, 023,
  032, 033) from the 2026-05-13 audit.
  - **006** `yellow-research/scripts/install-ast-grep.sh`: replace `curl … | sh`
    with download-to-temp over `--proto =https`, shebang sanity-check, then
    execute the local copy. The uv installer URL is version-pinned for
    reproducibility.
  - **009** `scripts/export-ci-metrics.sh`: allowlist-validate `STAGE` /
    `STATUS` and validate `ADDITIONAL_LABELS` key/value pairs before they are
    embedded in Prometheus label output — prevents label injection.
  - **017** `yellow-devin/commands/devin/delegate.md`: validate the git remote
    URL format and wrap the gathered Repository/Branch context in
    `--- begin/end repository context (reference only) ---` fencing before it
    enters the Devin task prompt.
  - **022** `yellow-composio/hooks/check-mcp-url.sh`: drop the brittle hardcoded
    cache-path fallback for `CLAUDE_PLUGIN_ROOT` — skip the credential-status
    write when it is unset rather than guessing a path.
  - **023** `yellow-ci/hooks/scripts/session-start.sh`: hash the `$PWD`-derived
    cache key (md5, 32 chars) so deeply-nested paths cannot exceed the 255-byte
    filename limit and break the cache path.
  - **032** `gt-workflow/hooks/check-commit-message.sh`: extend the `-m` grep to
    also match single-quoted arguments — `-m 'feat: x'` previously bypassed
    conventional-commit enforcement entirely.
  - **033** `yellow-morph/lib/install-morphmcp.sh`: validate `owner_pid` is
    numeric before `kill -0`, treating an empty/corrupt pid file as a stale lock
    instead of passing garbage to `kill`.

  Gates: `pnpm validate:plugins`, yellow-ci Bats (147), shellcheck, bash -n —
  all green.

## 2.0.0

### Major Changes

- [#512](https://github.com/KingInYellows/yellow-plugins/pull/512)
  [`10b1c00`](https://github.com/KingInYellows/yellow-plugins/commit/10b1c000b32ad2cd54c742d5967a6a469ba81f57)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(yellow-composio): stdio MCP transport with shell env fallback

  Converts the bundled Composio MCP server from `type: http` to a `command`-type
  stdio MCP that proxies to Composio's HTTPS endpoint. This unblocks two pain
  points:
  1. **Multi-host fleet support.** Power users can now set `COMPOSIO_MCP_URL`
     and `COMPOSIO_API_KEY` in shell rc / direnv / a secrets manager. The
     wrapper (`bin/start-composio.sh`) resolves userConfig OR shell env with
     userConfig-preferred precedence — mirroring the canonical pattern from
     yellow-research and yellow-morph.
  2. **Cascade failure protection.** Previously, an empty `composio_mcp_url`
     registered the bundled MCP with `url: ""` and broke `claude doctor` for
     every other MCP in the session. The wrapper now exits non-zero on empty or
     non-HTTPS URLs, so the bundled MCP simply doesn't register — all other MCPs
     are unaffected.

  Architecture:
  - `bin/start-composio.sh` — credential resolver, HTTPS-only enforcement
  - `bin/composio-proxy.mjs` — minimal Node.js stdio↔HTTPS proxy
    (newline-delimited JSON-RPC per MCP spec; request/response only — Composio
    does not need persistent SSE)
  - `plugin.json` — `mcpServers.composio-server` is now command-based with env
    block declaring both `_USERCONFIG` and shell-env-passthrough variants
  - `hooks/check-mcp-url.sh` — extended to also emit `credential-status.json`
    per the protocol from the yellow-core foundation PR
  - `userConfig.composio_mcp_url`/`composio_api_key` — `required: true` removed
    (per research: it does not block install, only surfaces as confusing
    MCP-startup errors)

  Breaking change: legacy installs from v1.2.x must
  `/plugin disable yellow-composio && /plugin enable yellow-composio` after
  Claude Code restart to re-trigger the userConfig prompt. Existing
  keychain-stored values are preserved.

  Trade-off: this diverges from Composio's officially recommended
  `claude mcp add --transport http` integration. Documented in CLAUDE.md. The
  trade-off is necessary because Claude Code bug #51581 makes `${VAR}`
  substitution in HTTP MCP `headers` non-functional, preventing shell env
  fallback for the API key on the http transport.

## 1.2.4

### Patch Changes

- [`c60438d`](https://github.com/KingInYellows/yellow-plugins/commit/c60438dc3930c8fe8e1f6e94be80738f5e20780a)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Mark
  `composio_mcp_url` and `composio_api_key` as `required: true` so the plugin
  can no longer be enabled with empty userConfig values. Previously, dismissing
  either prompt left the bundled HTTP MCP server registered with an empty URL,
  which Claude Code's transport normalizes to `/` and which `claude doctor`
  reports as `SDK auth failed: "/" cannot be parsed as a URL` — the failure was
  loud, misleading (auth message for a URL parse error), and prevented other MCP
  servers from passing their auth checks. With both fields required, the
  "dismissed prompt" state is unreachable: users either provide the values at
  enable time or do not enable the plugin. CLAUDE.md and `/composio:setup` prose
  updated to drop the dismissed-prompt fallback path.

## 1.2.3

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

## 1.2.2

### Patch Changes

- [`a027cc6`](https://github.com/KingInYellows/yellow-plugins/commit/a027cc6ffb6a55e569a3b933295df37b8e390a34)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Strip
  non-standard `userConfig.composio_mcp_url.pattern` field; Claude Code's remote
  validator rejects it as `Unrecognized key: "pattern"`, blocking install. The
  schema-level `^https://` regex enforcement that landed in PR #409 was an
  unsupported extension to the official `userConfig` schema (which only allows
  `type, title, description, sensitive, required, default, multiple, min, max`).

  Replacement defenses (advisory only — MCP server attaches before any of these
  fire, matching pre-PR409 baseline):
  - New `hooks/check-mcp-url.sh` SessionStart hook prints a warning if the
    configured `composio_mcp_url` does not start with `https://`.
  - Updated `composio_mcp_url.description` and `composio-patterns` SKILL
    Security section to explicitly state HTTPS-only requirement and that format
    validation is not schema-enforced.
  - Updated `composio_api_key.description` to note that key format is not
    validated; invalid keys produce a 401 at runtime.

## 1.2.1

### Patch Changes

- [`d49ce33`](https://github.com/KingInYellows/yellow-plugins/commit/d49ce331fc2a34470ca118c244011df384804c65)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Enforce
  HTTPS-only on `composio_mcp_url` via `userConfig` `pattern`

  Adds
  `"pattern": "^https://[a-zA-Z0-9][a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}(?:/\\S*)?$"` to
  the `composio_mcp_url` userConfig entry. Closes the security concern raised in
  PR #396 review (greptile P1 thread `PRRT_kwDOQ3SUys6AIYpq`): without a
  schema-level constraint, a user pasting `http://mcp.composio.dev/...` would
  have the keychain-protected `composio_api_key` (sent as `X-API-Key`)
  transmitted in cleartext on the wire. The `additionalProperties: false`
  posture of the local `userConfigEntry` definition previously blocked this fix;
  the sibling change in this same PR
  (`feat(schema): add pattern regex field to userConfigEntry + RULE 10`)
  unblocks it.

  The pattern requires `https://`, an alphanumeric host start, a dot, and a
  TLD-like trailing segment, optionally followed by a `/` and a non-whitespace
  path/query segment, end-anchored. Both anchors are required because JS
  `.test()` returns true on any substring match — without a trailing `$`,
  `https://mcp.composio.dev/ bad` would still pass (codex P2 finding on PR
  #409). The simpler `^https://` prefix-only form was rejected per security
  review (bypassable via URL confusion: `https://evil.com#@victim.com` and
  similar payloads pass `^https://` while routing the request to an
  attacker-controlled host). See
  `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md` for
  the full pattern recipes appendix.

## 1.2.0

### Minor Changes

- [`cd2aa52`](https://github.com/KingInYellows/yellow-plugins/commit/cd2aa523fefd8aa5d6c6e1a4ca308903f02a8bb4)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Bundle the
  Composio MCP server in `plugin.json` with userConfig prompts

  Replace the documentation-passthrough `/composio:setup` story with an actual
  installer. `plugins/yellow-composio/.claude-plugin/plugin.json` now declares:
  - `userConfig.composio_mcp_url` (`type: string`, non-sensitive) — the
    per-customer MCP URL the user generates at https://mcp.composio.dev or via
    `npx @composio/mcp@latest setup <customer_id> <app_id>`.
  - `userConfig.composio_api_key` (`type: string`, sensitive) — Composio API
    key, sent as `X-API-Key` header on every MCP request, stored in the system
    keychain.
  - `mcpServers.composio-server` (`type: http`) — `url` and `headers.X-API-Key`
    read from `${user_config.composio_mcp_url}` and
    `${user_config.composio_api_key}` respectively.

  Tools appear under `mcp__plugin_yellow-composio_composio-server__COMPOSIO_*`.

  ## Compatibility

  Existing users who configured Composio manually via
  `claude mcp add --transport http composio-server ...` keep working — their
  entry in `~/.claude.json` is independent of this plugin's bundled MCP and
  continues to expose tools under `mcp__composio-server__*`. The plugin's
  `/composio:setup` and `/composio:status` commands now look for all three
  prefixes (bundled, Claude.ai native, manual) and pick whichever is reachable.
  Users on the manual path can migrate at their own pace by answering the new
  userConfig prompts and removing the manual entry.

  ## Open: ${user_config.\*} substitution in `mcpServers.url` and `headers`

  This is the first plugin in the marketplace to use `${user_config.*}`
  substitution inside `mcpServers.<name>.url` and inside
  `mcpServers.<name>.headers`. Every prior plugin (yellow-research,
  yellow-morph, yellow-semgrep) only uses `${user_config.*}` inside the `env`
  block of stdio servers. The schema does not field-scope substitution, and the
  harness uses generic `${user_config.KEY}` substitution wherever it appears
  (see `monitors.command` schema description for the security note).
  Substitution should work, but the specific HTTP-server-url +
  http-server-headers paths are empirically untested in this repo until this PR
  ships.

  If a user enables the plugin and the bundled MCP fails to start for this
  reason, the existing manual `claude mcp add` instructions remain in
  `/composio:setup` Step 2 as a fallback — see the "Fallback (manual
  `claude mcp add`)" block. The setup command's tool-prefix detection already
  covers the manual path.

  ## Files changed
  - `plugins/yellow-composio/.claude-plugin/plugin.json` — add `userConfig` and
    `mcpServers.composio-server` blocks.
  - `plugins/yellow-composio/CLAUDE.md` — flip "does NOT bundle an MCP server"
    to describe the bundled MCP and migration path; security notes section
    updated to reflect keychain-stored API key.
  - `plugins/yellow-composio/commands/composio/setup.md` — Step 2 rewritten to
    detect all three tool-name prefixes and to recommend
    `/plugin disable && /plugin enable` for first-time setup, with the manual
    `claude mcp add` instructions retained as the fallback path.
  - `plugins/yellow-composio/README.md` — Quick Start and How It Works sections
    updated to lead with the `userConfig`-prompt path and to document the
    three-prefix detection plus migration guidance for the manual
    `claude mcp add` flow.
  - `plugins/yellow-composio/skills/composio-patterns/SKILL.md` — prefix list
    expanded from two to three (bundled first), and the security note flipped
    from "no API keys stored" to "API key stored in system keychain" to match
    the new bundled path.

## 1.1.0

### Minor Changes

- [`f30767d`](https://github.com/KingInYellows/yellow-plugins/commit/f30767d149525d0b2f3bc3532b4f8a41a5d60ee4)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-composio plugin with setup validation, usage monitoring, and Composio
  integration patterns

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-27

### Added

- `/composio:setup` command for MCP validation, connection checking, and usage
  tracking initialization
- `/composio:status` command for usage dashboard with execution counts, per-tool
  breakdown, daily history, and threshold warnings
- `composio-patterns` skill documenting Workbench batch processing,
  Multi-Execute, usage tracking, graceful degradation, and security conventions

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
