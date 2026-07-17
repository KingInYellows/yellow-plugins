/**
 * Domain validation types. Library-agnostic abstractions — CLI and domain
 * services depend on these, not on the AJV infrastructure layer.
 *
 * @module domain/validation/types
 */

export enum ValidationStatus {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export enum ErrorSeverity {
  ERROR = 'ERROR', // Blocking validation error
  WARNING = 'WARNING', // Non-blocking warning
}

// Categories align with specification Section 4.
export enum ErrorCategory {
  SCHEMA_VALIDATION = 'SCHEMA_VALIDATION',
  COMPATIBILITY = 'COMPATIBILITY',
  INSTALLATION = 'INSTALLATION',
  DISCOVERY = 'DISCOVERY',
  PERMISSION = 'PERMISSION',
  NETWORK = 'NETWORK',
  SOLUTION_DOCS = 'SOLUTION_DOCS',
  PLAN_LIFECYCLE = 'PLAN_LIFECYCLE',
  SETUP_COVERAGE = 'SETUP_COVERAGE',
  DISTRIBUTION = 'DISTRIBUTION',
}

/** Structured validation error with specification traceability. */
export interface DomainValidationError {
  /** Error code from specification, e.g. 'ERROR-SCHEMA-001'. */
  code: string;
  message: string;
  /** JSON path to the offending field, e.g. '/plugins/0/version'. */
  path: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  /** Additional debugging context. */
  context?: Record<string, unknown>;
  /** Link to a specification section, e.g. 'CRIT-001', 'FR-003'. */
  specReference?: string;
}

export interface DomainValidationResult {
  status: ValidationStatus;
  /** Validation errors; empty when valid. */
  errors: DomainValidationError[];
  /** Non-blocking warnings. */
  warnings: DomainValidationError[];
  /** Validated entity name, e.g. 'marketplace', 'plugin:hookify'. */
  entityName: string;
  validatedAt: Date;
}

/**
 * Validator interface that domain services and CLI depend on. The
 * infrastructure layer implements it using AJV.
 */
export interface IValidator {
  /** `pluginId` is optional and only enriches error messages. */
  validatePluginManifest(
    data: unknown,
    pluginId?: string
  ): DomainValidationResult;
  validateCompatibility(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment
  ): DomainValidationResult;
}

/** Plugin compatibility requirements declared in the manifest. */
export interface PluginCompatibility {
  claudeCodeMin: string;
  claudeCodeMax?: string;
  nodeMin?: string;
  nodeMax?: string;
  os?: string[];
  arch?: string[];
  pluginDependencies?: string[];
}

/** Current system environment, for compatibility checking. */
export interface SystemEnvironment {
  claudeCodeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  installedPlugins: string[];
}
