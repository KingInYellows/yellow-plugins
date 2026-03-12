# @yellow-plugins/infrastructure

Infrastructure layer — AJV schema validation for plugin marketplace manifests.

## Exports

- `AjvValidatorFactory`, `sharedValidatorFactory` — AJV validator factory and singleton
- `SchemaValidator`, `createValidator` — High-level validator for marketplace and plugin schemas
- `ValidationError`, `ValidationResult` — Result types
- `version` — Package version string

## Dependencies

- `@yellow-plugins/domain` — Validation types and error catalog
- `ajv` + `ajv-formats` — JSON Schema validation
- `semver` — Semver range checking
