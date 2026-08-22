# catalog/ — neutral distribution source of truth

This directory is the source of truth for the generated distribution
artifacts:

- `.claude-plugin/marketplace.json`
- `plugins/<name>/.claude-plugin/plugin.json` (Claude-enabled plugins)

Do NOT edit those files directly — edit the sources here and regenerate:

```bash
pnpm generate:manifests    # regenerate the artifacts from catalog/
pnpm validate:generated    # drift check: fails while any generated file differs
```

Both manifest schemas set `additionalProperties: false`, so the generated
files carry no in-JSON "generated" marker — drift enforcement runs via
`pnpm validate:generated` and the byte-identity integration test in CI
(same model as `pnpm validate:snippets`).

## Layout

- `catalog.json` — marketplace identity (`name`, `description`, `owner`,
  `metadata`), the canonical plugin order (`pluginOrder`, an explicit name
  array — marketplace entries are emitted in exactly this order), and
  per-target presentation defaults (`targets.claude`, `targets.codex`,
  `targets.cursor`). The `targets.codex` and `targets.cursor` blocks are
  inert data for their respective generated distribution targets (consumed
  by later tooling); nothing reads them during Claude generation.
  `targets.cursor` is entirely optional at the root — its absence means no
  root `.cursor-plugin/marketplace.json` is emitted at all, even if a
  per-plugin source enables Cursor (see `docs/cursor-distribution.md`).
- `plugins/<name>.json` — one source per plugin, filename = exact plugin
  `name`. Holds the shared metadata (`description`, `author`, `homepage`,
  `repository`, `license`, `keywords`), the Claude component fields verbatim
  (`outputStyles`, `userConfig`, `mcpServers`, `hooks`, `dependencies`,
  `$schema`), the marketplace entry fields (`marketplace.category`,
  `marketplace.source`, plus `marketplace.description` ONLY when the
  marketplace listing text differs from the plugin description), target
  enablement (`targets: {"claude": true, "codex": {"enabled": false},
  "cursor": {"enabled": false}}` — `codex` and `cursor` both fail closed:
  an absent block, or an absent/non-`true` `enabled`, means disabled), and
  an optional catalog-only `lifecycle` object (`status:
  active|experimental|legacy|deprecated`, `installPolicy?: auto|manual`,
  `support?: full|security-only`, `replacement?: <plugin-name>`) describing
  a plugin's standing relative to a newer replacement. `lifecycle` is never
  emitted into any generated artifact — `pnpm validate:cursor`'s lifecycle
  non-emission scan enforces this across every target's output.

## Versions

Per-plugin catalog source files carry no top-level plugin `name` or `version`
keys. `plugins/<name>/package.json` remains the sole version authority (see
`scripts/validate-versions.js`); the generator reads versions from there at
emit time. The `metadata.version` in
`catalog.json` is the marketplace metadata version — a third, independent
knob (it is neither the root `package.json` version nor any plugin version).
