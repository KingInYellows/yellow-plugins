# @yellow-plugins/domain

Domain layer — validation types and error catalog for the plugin marketplace.

## Exports

- `ValidationStatus`, `ErrorSeverity`, `ErrorCategory` — Enums for validation results
- `DomainValidationError`, `DomainValidationResult` — Types for structured validation output
- `IValidator`, `PluginCompatibility`, `SystemEnvironment` — Contracts and system types
- `ERROR_CODES`, `ValidationErrorFactory`, `getErrorCodesByCategory` — Error catalog and factory
- `version` — Package version string

## Dependencies

None (pure domain layer).
