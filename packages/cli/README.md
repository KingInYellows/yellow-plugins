# @yellow-plugins/cli

Minimal CLI delegating to the plugin manifest validator script.
Marketplace validation (`validate`/`validate:marketplace`) was retired
in R45 — the legacy nested-shape `schemas/marketplace.schema.json` it
validated against was unused in CI; `scripts/validate-marketplace.js`
plus `schemas/official-marketplace.schema.json` remain the sole
marketplace gates.

## Usage

```bash
pnpm --filter @yellow-plugins/cli dev -- validate:plugins      # Run the plugin manifest validator script and exit with its status
```

## Exports

- `version` — Package version string
