# @yellow-plugins/cli

Minimal CLI for validating marketplace and plugin schemas.

## Usage

```bash
pnpm --filter @yellow-plugins/cli dev -- validate              # Validate marketplace.json + show plugin validator path
pnpm --filter @yellow-plugins/cli dev -- validate:marketplace  # Validate only .claude-plugin/marketplace.json
pnpm --filter @yellow-plugins/cli dev -- validate:plugins      # Show how to run the plugin manifest validator script
```

## Dependencies

- `@yellow-plugins/infrastructure` — AJV schema validation

## Exports

- `version` — Package version string
