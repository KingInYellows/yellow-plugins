# catalog/ — neutral distribution source of truth

This directory is the source of truth for the generated distribution
artifacts:

- `.claude-plugin/marketplace.json`
- `plugins/<name>/.claude-plugin/plugin.json` (all plugins)

Do NOT edit those files directly — edit the sources here and regenerate:

```bash
pnpm generate:manifests    # regenerate the artifacts from catalog/
pnpm validate:generated    # drift check: fails while any generated file differs
```

Both manifest schemas set `additionalProperties: false`, so the generated
files carry no in-JSON "generated" marker — drift enforcement lives entirely
in `pnpm validate:generated` (same model as `pnpm validate:snippets`).

## Layout

- `catalog.json` — marketplace identity (`name`, `description`, `owner`,
  `metadata`), the canonical plugin order (`pluginOrder`, an explicit name
  array — marketplace entries are emitted in exactly this order), and
  per-target presentation defaults (`targets.claude`, `targets.codex`). The
  `targets.codex` block is inert data for the Codex distribution target
  (consumed by later tooling); nothing reads it during Claude generation.
- `plugins/<name>.json` — one source per plugin, filename = exact plugin
  `name`. Holds the shared metadata (`description`, `author`, `homepage`,
  `repository`, `license`, `keywords`), the Claude component fields verbatim
  (`outputStyles`, `userConfig`, `mcpServers`, `hooks`, `dependencies`,
  `$schema`), the marketplace entry fields (`marketplace.category`,
  `marketplace.source`, plus `marketplace.description` ONLY when the
  marketplace listing text differs from the plugin description), and target
  enablement (`targets: {"claude": true, "codex": false}`).

## Versions

Catalog sources carry NO `name` or `version` keys. `plugins/<name>/package.json`
remains the sole version authority (see `scripts/validate-versions.js`); the
generator reads versions from there at emit time. The `metadata.version` in
`catalog.json` is the marketplace metadata version — a third, independent
knob (it is neither the root `package.json` version nor any plugin version).
