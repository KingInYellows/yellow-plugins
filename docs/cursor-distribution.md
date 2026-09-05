# Cursor Distribution (canonical)

This is the **single canonical doc** for how this marketplace distributes
plugins to Cursor's plugin system alongside Claude Code (and, separately, OpenAI
Codex — see [`codex-distribution.md`](codex-distribution.md)). Every other
Cursor-related doc cross-references this one; if a fact about the neutral
catalog, the generated Cursor artifacts, or the cross-host contract lives in two
places, this doc is the source of truth.

## The neutral-catalog model

Plugins are authored once under `catalog/` and `plugins/<name>/`, then
**per-host artifacts are generated** — never hand-edited. The Cursor target
follows the same pipeline Codex established:

- `catalog/catalog.json` — `pluginOrder` plus an optional `targets.cursor` root
  config (`name`, `owner?`, `description?`).
- `catalog/plugins/<name>.json` — the per-plugin source of truth, including an
  optional `targets.cursor` block.
- Generation (`pnpm generate:manifests`, `scripts/generate-manifests.js` +
  `scripts/lib/generate/emit-cursor.js`) writes:
  - `plugins/<name>/.cursor-plugin/plugin.json` (Cursor manifest, one per
    Cursor-enabled plugin)
  - `plugins/<name>/<componentPaths.skills>/<skill>/SKILL.md` (the
    Cursor-exposed skill tree, defaulting to `plugins/<name>/cursor/skills/`,
    frontmatter normalized to `name` + single-line `description`, with any
    `references/*.md` sidecars copied alongside)
  - `.cursor-plugin/marketplace.json` (the root Cursor marketplace, listing only
    Cursor-enabled plugins in canonical `pluginOrder`)

`pnpm validate:generated` enforces byte-identity between `catalog/` sources and
every generated artifact; `pnpm validate:cursor` validates the Cursor artifacts
and runs the exposure lint and the lifecycle non-emission scan (below).

## Opt-in model: explicit, fail-closed, pilot-scoped

Cursor enablement is **explicit opt-in**, and absence resolves to **disabled** —
the same fail-closed convention Codex uses. A plugin only gets a
`.cursor-plugin/plugin.json` when its catalog source sets
`targets.cursor.enabled: true`; `scripts/lib/generate/emit-cursor.js`'s
`isCursorEnabled()` guards this explicitly
(`Boolean(source.targets) && Boolean(source.targets.cursor) && source.targets.cursor.enabled === true`)
rather than defaulting an absent block to enabled.

**Two plugins are Cursor-enabled: `yellow-cursor` (the native pilot) and
`yellow-review` (a single read-only skill, `yellow-thermonuclear-review`, with
no commands or agents).** This repository does **not** claim any other plugin,
or the marketplace as a whole, is Cursor-native. A plugin appears in the Cursor marketplace only
after its own compatibility work lands (target enabled + generated artifacts +
passing exposure lint), mirroring Codex's own no-repository-wide-compatibility
posture (see `codex-distribution.md`'s "No repository-wide compatibility
claim").

Cursor's emission contract diverges from Codex's in one structural way: the root
Cursor marketplace has **no always-on empty-state artifact**. Both
`catalog.targets.cursor` and per-plugin `targets.cursor.enabled` are optional,
so `buildCursorMarketplace()` returns `null` (not an empty-array marketplace
object) whenever the root config is absent or zero plugins are enabled — the
generator treats a `null` return as "emit nothing, and stale-sweep any leftover
`.cursor-plugin/marketplace.json`." Codex, by contrast, always emits an object,
even `{plugins: []}`.

## Generated artifact shape

`plugins/<name>/.cursor-plugin/plugin.json` is **flat** — `displayName` and
`category` sit at the manifest's top level, not nested under an `"interface"`
object the way this repo's own generated Codex manifest nests them. That nesting
is a local Codex-schema invention; the verified upstream Cursor schema has no
such wrapper. The catalog's own authoring-side
`targets.cursor.interface.{displayName,category}` grouping exists only for
authoring consistency with `targets.codex` — `buildCursorPluginManifest()`
flattens it on the way out. The generator currently emits a subset of the
upstream-modeled fields: `name`, `displayName`, `version`, `description`,
`author` (name + optional email only — no `url`, unlike this repo's own catalog
author object), `homepage`, `repository`, `license`, `keywords`, `category`, and
`skills` (only when at least one skill is actually allowlisted and copied).

`.cursor-plugin/marketplace.json` lists Cursor-enabled plugins as
`{name, source: "plugins/<name>", description}`, in canonical `pluginOrder`.

## Emitter / validator architecture

`scripts/lib/generate/emit-cursor.js` exports four pure-or-controlled functions,
mirroring `emit-codex.js`'s shape:

- `isCursorEnabled(source)` — the single source of truth for target membership.
- `buildCursorMarketplace(catalog, sources)` — pure; returns the root
  marketplace object or `null` (see above).
- `buildCursorPluginManifest(source, pkg)` — pure; builds one flat manifest.
  `pkg` (the plugin's own `package.json`) is the sole name/version authority,
  matching this repo's existing three-way sync convention.
- `buildCursorSkillTree(rootDir, name, source)` — **not** pure: it enumerates
  and reads the allowlisted skill files from disk, doing controlled,
  symlink-rejecting reads, and returns a discriminated-union result
  (`{status: 'ok', targets}` or `{status: 'error', errors}`) the caller batches
  into the same generated-file pipeline as every other target.

`scripts/validate-cursor.js` (`pnpm validate:cursor`) runs three independent
checks:

1. **Artifact validation** — every Cursor-enabled plugin's
   `.cursor-plugin/plugin.json`, and the root `.cursor-plugin/marketplace.json`
   when at least one plugin is enabled, validate against
   `schemas/cursor-plugin.schema.json` /
   `schemas/cursor-marketplace.schema.json` via AJV. When zero plugins are
   Cursor-enabled the root marketplace check is skipped entirely (its absence is
   the correct no-op state, not a failure).
2. **Exposure lint** — every Cursor-exposed file (the plugin manifest plus the
   copied skill tree, including `references/*.md` sidecars) is scanned for
   Claude-only constructs that must never reach a Cursor session. This reuses
   `validate-codex.js`'s exported `DIRECT_CHECKS`, `runRegistryGatedChecks`,
   `buildSiblingRegexps`, `buildMcpToolNameRegistry`, and
   `buildCommandNameRegistry` verbatim via `require()` — the check logic and
   registries are target-agnostic (Claude-only constructs are Claude-only
   regardless of which non-Claude target is scanning for them); only file
   discovery (`collectCursorExposedFiles`) is Cursor-specific.
3. **Lifecycle non-emission scan** — runs unconditionally across every generated
   artifact on every target (Claude, Codex, Cursor), independent of Cursor
   enablement, so it still guards Claude/Codex output on a catalog with zero
   Cursor plugins.

Errors surface as `ERROR-CURSOR-001` through `ERROR-CURSOR-008` (see
`packages/domain/src/validation/errorCatalog.ts`).

## Skill allowlist + containment rules

Only the skills a plugin's `targets.cursor.skillAllowlist` names are copied into
`<componentPaths.skills>` (default `./cursor/skills`, must resolve within the
plugin's own directory). The rules mirror Codex's discipline exactly:

- Each allowlisted skill directory may contain `SKILL.md` plus a flat
  `references/` subdirectory of `[a-zA-Z0-9_-]+.md` files — nothing else. A
  skill with an unsupported sidecar (nested directories, symlinks, non-`.md`
  files, a stray `agents/`, etc.) hard-errors the generator run; relocate the
  unsupported content out of the skill directory first.
- Symlinked skill directories, symlinked `references/` directories, and
  symlinked files anywhere in that chain are rejected (`O_NOFOLLOW` reads,
  `realpathSync` containment checks against the plugin's own real path).
- `SKILL.md` frontmatter is parsed, validated (`name` and `description` must be
  strings, and `name` must match the allowlisted directory name), and normalized
  on the way out to just `name` + `description`.

## Upstream schema provenance

`schemas/cursor-plugin.schema.json` and `schemas/cursor-marketplace.schema.json`
are local mirrors — fetched and quoted directly, not paraphrased — of:

- `https://raw.githubusercontent.com/cursor/plugins/main/schemas/plugin.schema.json`
- `https://raw.githubusercontent.com/cursor/plugins/main/schemas/marketplace.schema.json`

Snapshot date: **2026-08-21**. **No intentional divergence from upstream.** Both
were cross-checked against real examples fetched from the same repo
(`ralph-loop/.cursor-plugin/plugin.json` and the repo's own root
`.cursor-plugin/marketplace.json`). The schema `$comment` blocks record the
three concrete differences from this repo's own, locally-invented
`codex-plugin.schema.json` / `codex-marketplace.schema.json` (not from upstream
Cursor, which this repo has no reason to diverge from):

1. `name` uses the real upstream kebab pattern
   (`^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$`, allows dots), not Codex's simpler
   `^[a-z0-9-]+$`.
2. `displayName` / `category` are flat top-level fields on the Cursor manifest,
   not nested under an `interface` object.
3. `author` has no `url` field upstream (`name` required, `email?` optional) —
   this repo's own catalog author object's `url` field is deliberately never
   copied into the generated Cursor manifest.

Re-verify this snapshot before any structural schema change lands upstream;
`docs/upstream-pins.md` records the same two URLs and snapshot date as the
pin-tracking entry.

## Drift checking

`pnpm generate:manifests --check` (equivalently `pnpm validate:generated`) fails
if any Cursor artifact on disk differs byte-for-byte from what the catalog
sources would regenerate — the same guarantee already in place for the Claude
and Codex targets.

## Local Cursor loading procedure

**Docs-claimed, not live-verified** — no Cursor editor instance was available to
test this in the session that gathered these facts. Cross-checked only against
this repo's own layout, which is consistent with it: place a plugin at
`~/.cursor/plugins/local/<plugin-name>/`, either as a root `plugin.json` (bare
Agent Plugins format) or nested under `.cursor-plugin/plugin.json`
(Cursor-native format, what this repo generates) — symlinks are reportedly
supported for fast iteration, with reload via "Developer: Reload Window" or an
app restart. Team marketplace installs reportedly happen through the Customize
sidebar with user/workspace/team scope selection. Treat this whole procedure as
docs-claimed until someone actually installs a generated `yellow-cursor` build
into a real Cursor editor and confirms it loads.

## Lifecycle metadata contract

`schemas/catalog-plugin.schema.json` defines an optional, **catalog-only**
`lifecycle` object (`status: active|experimental|legacy|deprecated`,
`installPolicy?`, `support?`, `replacement?`) that a plugin source may carry to
describe its status relative to a newer replacement (for example, `yellow-devin`
records `{status: "legacy", replacement: "yellow-cursor"}`). This field is
**never emitted** into any generated artifact on any target —
`validate-cursor.js`'s `scanLifecycleLeaks()` regex-scans every generated
manifest and marketplace file (Claude, Codex, and Cursor) for a literal
`"lifecycle"` key and fails the build if one appears, independent of whether any
plugin is Cursor-enabled.

## Limitations

- **Two plugins only.** `yellow-cursor` (native pilot) and `yellow-review`
  (one skill) are Cursor-enabled. No claim is made about any other plugin's
  Cursor readiness.
- **Live editor load test: pending human-approved verification.** The generated
  artifacts pass local schema validation and 57 integration tests (emitter
  characterization, validator, schema examples — see this branch's
  `feat(catalog): add Cursor generated target...` commit), but installing the
  generated `.cursor-plugin/` output into a real Cursor editor and confirming it
  loads has not been done in this repository.
- **Live `@cursor/sdk` smoke test: pending human-approved verification.** The
  `yellow-cursor` CLI's SDK integration was verified against the live SDK types
  and a handful of live authenticated/unauthenticated API probes during contract
  research, but no end-to-end `delegate` → running cloud agent → artifact/usage
  retrieval flow has been run against a real Cursor account from inside this
  plugin's own CLI.
- **Cursor's plugin _loader_ is closed-source.** The `cursor/plugins` GitHub
  repo is a content marketplace (plugin definitions + schemas), not the editor's
  loading implementation, so install-time acceptance behavior (exactly how
  strictly the real editor enforces `additionalProperties: false`, for instance)
  cannot be verified without a live editor instance — the same caution this repo
  already states for the Claude Code remote validator diverging from the local
  schema.

## Related docs

- [Codex distribution](codex-distribution.md) — the sibling generated target and
  the doc this one's structure mirrors.
- [Upstream package pins](upstream-pins.md) — the Cursor schema snapshot and
  `@cursor/sdk` pin entries.
- `plugins/yellow-cursor/README.md` / `plugins/yellow-cursor/CLAUDE.md` — the
  pilot plugin's own user-facing and contributor docs.
