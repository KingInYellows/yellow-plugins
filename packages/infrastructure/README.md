# @yellow-plugins/infrastructure

Infrastructure layer — AJV schema validation for plugin manifests.

_(For marketplace validation, see
[`scripts/validate-marketplace.js`](../../scripts/validate-marketplace.js) and
[`schemas/official-marketplace.schema.json`](../../schemas/official-marketplace.schema.json).)_

## Exports

- `AjvValidatorFactory` — AJV validator factory
- `SchemaValidator`, `createValidator` — High-level validator for plugin schemas
- `ValidationError`, `ValidationResult` — Result types
- `version` — Package version string

## Dependencies

- `@yellow-plugins/domain` — Validation types and error catalog
- `ajv` + `ajv-formats` — JSON Schema validation
- `semver` — Semver range checking
