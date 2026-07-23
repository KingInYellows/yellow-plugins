# Codex Distribution (canonical)

This is the **single canonical doc** for how this marketplace distributes plugins
to OpenAI Codex alongside Claude Code. Every other Codex-related doc
cross-references this one; if a fact about the neutral catalog, the generated
Codex artifacts, or the cross-host contract lives in two places, this doc is the
source of truth.

## The neutral-catalog model

Plugins are authored once under `catalog/` and `plugins/<name>/`, then **per-host
artifacts are generated** — never hand-edited:

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
every generated artifact; `pnpm validate:codex` validates the Codex artifacts and
runs the **exposure lint** (below).

## Codex-enabled plugins

As of the yellow-ci pilot close-out, **three** plugins enable Codex, in canonical
order:

1. `gt-workflow` — entire skill surface (thin command wrappers, no Claude-only
   logic).
2. `yellow-core` — a narrow read-only skill allowlist (excludes most skills, all
   agents, and both hooks).
3. `yellow-ci` — the read-mostly pilot: 8 allowlisted skills (6 operational + 2
   reference), hooks carried (`includeHooks` default `true`).

Filtering `pluginOrder` by `targets.codex.enabled` yields
`[gt-workflow, yellow-core, yellow-ci]` automatically.

## Host-neutral skill bodies + the exposure lint (R15)

`validate-codex.js` scans the generated **manifest + `codex/skills/**`** only —
never hooks, libs, or command wrappers. It unconditionally rejects Claude-only
constructs in exposed content: `.claude/`, `${CLAUDE_PLUGIN_ROOT}` /
`CLAUDE_PLUGIN_DATA` (and other `CLAUDE_*` runtime vars), `$ARGUMENTS`,
`subagent_type`, `userConfig`, `outputStyles`, plus registry-gated real
sibling-plugin paths, real `mcp__plugin_*` tool names, and real slash-command
names.

The resolution for a plugin whose skills need Claude-only config (e.g. yellow-ci
retaining `.claude/`-rooted config while exposing those skills) is **host-neutral
skill bodies**: the shared `SKILL.md` describes behavior host-neutrally (anchor
on XDG paths like `~/.config/yellow-ci/`, describe per-repo overrides in prose,
inline validation instead of `source ${CLAUDE_PLUGIN_ROOT}/...`), while all
`.claude/`-specific and env-var logic lives in the **non-linted** layer — the
hook Node runtime, the bash libs, and the command wrappers. See
[codex-config-retention-exposure-lint-conflict](solutions/integration-issues/codex-config-retention-exposure-lint-conflict.md).

## Cross-host hooks

Hook logic is dependency-free Node (`>=22.22`), replicated per-plugin (no
cross-plugin imports): a shared envelope adapter + policy/core modules, plus thin
`entrypoint-claude.js` / `entrypoint-codex.js`. Hook **input** is snake_case on
both hosts; **output** differs by host only where the event differs (PreToolUse
denial: Claude exits 2 + stderr; Codex emits a `hookSpecificOutput` deny). A
`SessionStart` hook emits the same `{"continue": true}` on both hosts. Full
pattern: [cross-host-hook-envelope-node-runtime](solutions/integration-issues/cross-host-hook-envelope-node-runtime.md).

## Known constraints (verify per CLI version)

- **Plugin hooks are inert on Codex.** `codex features list` shows `plugin_hooks`
  as `removed` (confirmed on codex-cli 0.144.1 and 0.144.6). Generated
  `codex-hooks.json` is schema/unit-tested but never fires — do not gate delivery
  on live Codex hook firing.
- **The generator copies `SKILL.md` only.** `emit-codex.js` rejects any
  allowlisted skill directory with sidecar files (`references/`, `agents/`, …).
  A skill with sidecars must relocate them out of the skill directory before it
  can be Codex-exposed.
- **`allow_implicit_invocation` is honored but not yet shippable here.** On
  codex-cli 0.144.6 Codex parses `skills/<name>/agents/openai.yaml`
  `policy.allow_implicit_invocation` (reversing the 0.144.1 finding), but
  shipping it is a sidecar blocked by the generator above — deferred; the interim
  lever is SKILL.md description phrasing. See
  [codex-plugin-manifest-and-hook-contract](solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md).

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
