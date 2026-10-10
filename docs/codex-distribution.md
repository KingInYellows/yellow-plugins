# Codex Distribution (canonical)

This is the **single canonical doc** for how this marketplace distributes
plugins to OpenAI Codex alongside Claude Code. Every other Codex-related doc
cross-references this one; if a fact about the neutral catalog, the generated
Codex artifacts, or the cross-host contract lives in two places, this doc is the
source of truth.

## The neutral-catalog model

Plugins are authored once under `catalog/` and `plugins/<name>/`, then
**per-host artifacts are generated** — never hand-edited. Three distribution
targets exist today: Claude, Codex, and Cursor (the last is a two-plugin pilot;
see [cursor-distribution.md](cursor-distribution.md) for its own canonical doc).
This doc covers the Codex target only:

- `catalog/catalog.json` — `pluginOrder` (canonical marketplace order) and the
  release track.
- `catalog/plugins/<name>.json` — the per-plugin source of truth, including
  `targets.claude` and `targets.codex`.
- Generation (`pnpm generate:manifests`, `scripts/generate-manifests.js` +
  `scripts/lib/generate/emit-codex.js`) writes:
  - `plugins/<name>/.claude-plugin/plugin.json` (Claude manifest)
  - `plugins/<name>/.codex-plugin/plugin.json` (Codex manifest)
  - `plugins/<name>/codex/skills/<skill>/SKILL.md` (Codex-exposed skill tree,
    frontmatter normalized to `name` + single-line `description`)
  - `plugins/<name>/hooks/codex-hooks.json` (Codex hook config, when
    `includeHooks` is on)
  - `.agents/plugins/marketplace.json` (the Codex marketplace snapshot; its
    plugin list is the `pluginOrder` **filtered** to `targets.codex.enabled`)

`pnpm validate:generated` enforces byte-identity between `catalog/` sources and
every generated artifact; `pnpm validate:codex` validates the Codex artifacts
and runs the **exposure lint** (below).

## Codex-enabled plugins

The catalog now selects **ten plugins and exactly 31 skills**. The final
installed gate derives this inventory from the catalog and rejects migrated
commands, unselected skills and undeclared resources.

| Plugin          | Selected skill surface                                                         | Runtime scope                                                         |
| --------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| gt-workflow     | Existing 11 skills                                                             | Original pilot; setup references verified; live mutations excluded    |
| yellow-core     | agent-native-architecture, agent-native-audit, plan-status, worktree-inventory | Read-only references/dashboard/native Git inventory                   |
| yellow-review   | yellow-thermonuclear-review                                                    | Explicit-only structural findings; no edits                           |
| yellow-ci       | Existing 8 skills                                                              | CI pilot; diagnosis and runner approval/refusal fixtures; no live SSH |
| yellow-docs     | docs-audit                                                                     | Sequential current-checkout audit; findings only                      |
| yellow-debt     | debt-complexity-scan                                                           | Bounded Python-validated local source snapshots; no fixes             |
| yellow-research | research-public-repo                                                           | Public DeepWiki only; actual read-only repository Q&A                 |
| yellow-cursor   | cursor-plan                                                                    | Installed offline CLI dry-run; no remote launch/auth claim            |
| yellow-codex    | codex-readiness                                                                | Local CLI/native login classification; no nested model                |
| yellow-jules    | jules-delegation, jules-supervision                                            | Reference skills only; every command stays Claude-only, no hooks; `authorize`, `abandon` and `supervise --clear-pause` are owner terminal commands (see "Jules and the terminal") |

This is bounded skill support, not all commands/agents/hooks or all-plugin
compatibility. Full Claude setup remains separate from this Codex selection. The
new targets exclude Claude SessionStart hooks. Read-only workflow contracts and
installed evidence are in the
[Phases 2–5 report](research/codex-phases-2-5-2026-10-06/report.md).
Mutation-capable stack workflows still require fresh native provider resolution;
the new developer workflow exports only inventory, so it grants no stack
mutation authority.

## Host-neutral skill bodies + the exposure lint (R15)

`validate-codex.js` scans the generated **manifest +
`codex/skills/**`** only — never hooks, libs, or command wrappers. It unconditionally rejects Claude-only constructs in exposed content: `.claude/`, `${CLAUDE_PLUGIN_ROOT}` /
`CLAUDE_PLUGIN_DATA` (and other `CLAUDE_*` runtime vars), `$ARGUMENTS`, `subagent*type`, `userConfig`, `outputStyles`, plus registry-gated real sibling-plugin paths, real `mcp\_\_plugin*\*`
tool names, and real slash-command names.

The resolution for a plugin whose skills need Claude-only config (e.g. yellow-ci
retaining `.claude/`-rooted config while exposing those skills) is
**host-neutral skill bodies**: the shared `SKILL.md` describes behavior
host-neutrally (anchor on XDG paths like `~/.config/yellow-ci/`, describe
per-repo overrides in prose, inline validation instead of
`source ${CLAUDE_PLUGIN_ROOT}/...`), while all `.claude/`-specific and env-var
logic lives in the **non-linted** layer — the hook Node runtime, the bash libs,
and the command wrappers. See
[codex-config-retention-exposure-lint-conflict](solutions/integration-issues/codex-config-retention-exposure-lint-conflict.md).

## Jules and the terminal

`yellow-jules` exposes only reference skills to Codex. Its writes are gated by a
grant, and a grant is written by `authorize`, which opens the controlling terminal
itself and requires the owner to type a random code back. A Codex session has no
controlling terminal for its commands, so it cannot satisfy that prompt, and no
Codex skill wraps `authorize`; the owner runs it in their own terminal on the
controller host. Codex 0.156.0 offers no host-neutral confirmation primitive to
build on instead (see
[capability-matrix.md](yellow-jules/capability-matrix.md#codex-supervision-capabilities-spec-open-question-2)).
The exposed skills therefore tell the agent to show the operator the command and
stop. The terminal check stops a caller with no terminal, not one that allocates
its own pseudo-terminal; that residual risk is stated in
`plugins/yellow-jules/CLAUDE.md`.

## Cross-host hooks

Hook logic is dependency-free Node (`>=22.22`), replicated per-plugin (no
cross-plugin imports): a shared envelope adapter + policy/core modules, plus
thin `entrypoint-claude.js` / `entrypoint-codex.js`. Hook **input** is
snake_case on both hosts; **output** differs by host only where the event
differs (PreToolUse denial: Claude exits 2 + stderr; Codex emits a
`hookSpecificOutput` deny). A `SessionStart` hook emits the same
`{"continue": true}` on both hosts. Full pattern:
[cross-host-hook-envelope-node-runtime](solutions/integration-issues/cross-host-hook-envelope-node-runtime.md).

## Known constraints (verify per CLI version)

- **Hook runtime evidence is version-specific.** Historical 0.144.1/0.144.6
  probes reported inert plugin hooks. On 0.157.0 the isolated app-server
  discovers all three installed hooks as enabled but untrusted. The optional
  lifecycle fixture now verifies SessionStart, PreToolUse denial and PostToolUse
  warning through actual host events. Untrusted hooks stay idle and the push
  stub runs; trusting only the disposable definition hashes blocks the push
  before execution. Disconnected, mocked Responses traffic proves host dispatch,
  not semantic skill selection. See the
  [fresh receipts](research/codex-phase-1-2026-10-05/report.md).
- **MCP startup is separate from account authentication.** The installed
  `graphite` registration starts actual Graphite CLI 1.7.20, completes MCP
  initialization and lists two tools in the disconnected fixture. Its Git
  repository paths/version/empty refs are synthetic; other Git reads fail. No
  MCP tool or authenticated remote operation runs. The host's
  `authStatus: unsupported` describes stdio authentication support, not a
  signed-in Graphite account.
- **Explicit skill paths do not suppress command migration.** Codex 0.157.0
  otherwise turns some Claude commands into additional loaded skills. Every
  generated Codex manifest now sets `commands: []` to preserve the catalog
  allowlist. Claude and Cursor outputs are unchanged. `pnpm smoke:codex` gates
  the actual installed skill set; see the
  [runtime harness](runtime-install-smoke.md#codex-installation-and-loaded-discovery).
- **Resource packaging is narrow.** The generator copies SKILL.md, flat
  references with conservative Markdown filenames and agents/openai.yaml
  containing only the boolean policy.allow_implicit_invocation. Duplicate keys,
  undeclared fields/resources, nested references and symlinks fail closed.
  Cursor validates then omits this Codex-only policy, preserving its output.
  Generic skill scripts/assets support was unnecessary for the chosen workflows.
- **Explicit-only policy is shipped and observed.** Thermonuclear review has
  allow_implicit_invocation: false in its installed sidecar. Actual explicit,
  implicit structural-review and unrelated model prompts were tested on 0.157.0.
  Description phrasing supplements the host policy.
- **Metadata has separate purposes.** Shared author/license attribution and
  keywords are emitted; the pinned legacy parser ignores top-level author and
  license, while interface.developerName and websiteURL provide runtime
  presentation. These use existing catalog identity/homepage values. No assets,
  privacy URLs or public-submission requirements are invented.
- **Public integration configuration is explicit.** A target-selected HTTPS MCP
  map includes only DeepWiki and its read operations. It never expands Claude
  configuration or imports other research servers/keys. Host approval remains
  the default in distributed manifests; pre-authorized read operations are
  approved only in the disposable acceptance profile.

## No repository-wide compatibility claim (R41)

Repo docs do **not** advertise repository-wide Codex compatibility. A plugin
appears in the Codex marketplace only after its own compatibility work lands
(`targets.codex.enabled: true` + generated artifacts + passing exposure lint).
Unsupported plugins stay absent from the Codex marketplace.

## Related Codex docs (all cross-reference this one)

- [Codex plugin manifest & hook contract](solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md)
- [Cross-host hook-envelope Node runtime](solutions/integration-issues/cross-host-hook-envelope-node-runtime.md)
- [Codex distribution pipeline: silent gaps](solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md)
- [Config retention vs exposure lint](solutions/integration-issues/codex-config-retention-exposure-lint-conflict.md)
- [Codex skill-exposure validator blind spots](solutions/integration-issues/codex-skill-exposure-validator-blind-spots.md)
- [Codex sandbox_mode does not fence MCP tools](solutions/security-issues/codex-sandbox-mode-does-not-fence-mcp-tools.md)
- [R17 Codex plugin contract spike](research/2026-07-16-codex-plugin-contract-spike.md)

## Phase 1 real-model acceptance

The pinned WSL CLI passed direct, indirect and unrelated installed plan-status
activation cases. `smoke:codex:activation` uses read-only tools and disposable
state, with native auth read-only mounted, never copied. Separate native
Graphite check-auth confirmed account/repository access; that proof is distinct
from MCP startup and stdio OAuth support. Other model/skill combinations and
Windows desktop semantics remain untested. Commands and receipts are in
[runtime smoke instructions](runtime-install-smoke.md) and the
[Phase 1 report](research/codex-phase-1-2026-10-05/report.md).

## Private/local installation and refresh

The existing repository and .agents/plugins/marketplace.json remain the source
of truth. Generate and validate in the WSL checkout using the pinned toolchain.
For a user-selected WSL CLI profile, the documented installation is:

```bash
codex --disable remote_plugin plugin marketplace add /absolute/path/to/yellow-plugins --json
codex --disable remote_plugin plugin add yellow-docs@yellow-plugins --json
codex --disable remote_plugin plugin list --json
```

Replace the repository path and plugin selector with the selected local package.
These commands change that selected profile; this implementation ran them only
in disposable profiles. Model login, plugin installation and hook trust are
separate actions. Installing a package does not approve hooks.

After source edits, regenerate first, then re-add the selected plugin and start
a fresh session/reload discovery. On pinned 0.157.0, re-adding the same-version
local plugin refreshed the installed skill bytes in a disposable test.
Remove-and-add also refreshed them, but removes that profile's cached package
and is an explicit operator choice, not automatic cleanup. Git marketplace
upgrade refreshes Git snapshots; it is not a substitute for local cache refresh.
Verify the installed path/bytes and loaded inventory, not merely command exit.

Windows desktop uses its own profile/cache, filesystem paths and native tools.
Use its plugin marketplace UI with a Windows-readable local source where
supported; do not assume that the WSL profile or CLI install appears there. WSL
runtime receipts prove no Windows desktop installation, hook trust,
authentication, shell compatibility or invocation behavior. A desktop rollout
needs its own selected profile and acceptance. No owner-profile installation or
trust was performed here.

Public publication is deliberately deferred. A root portable plugin.json and a
separate generated distribution repository are not applicable: no selected
workflow demonstrated that need. Keep source authoring in this repository; there
is no second source of truth. Do not add a root manifest that changes Claude
discovery. Public-directory review is a separate future release target.
