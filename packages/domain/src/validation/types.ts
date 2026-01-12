/**
 * Domain validation types and interfaces
 *
 * Provides clean abstractions for validation that are independent of the
 * underlying validation library (AJV). CLI and domain services should only
 * depend on these types, not on infrastructure validation details.
 *
 * @module domain/validation/types
 */

/**
 * Validation result status
 */
export enum ValidationStatus {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  ERROR = 'ERROR',     // Blocking validation error
  WARNING = 'WARNING', // Non-blocking warning
}

/**
 * Error categories aligned with specification Section 4
 */
export enum ErrorCategory {
  SCHEMA_VALIDATION = 'SCHEMA_VALIDATION',
  COMPATIBILITY = 'COMPATIBILITY',
  INSTALLATION = 'INSTALLATION',
  LIFECYCLE = 'LIFECYCLE',
  DISCOVERY = 'DISCOVERY',
  PERMISSION = 'PERMISSION',
  NETWORK = 'NETWORK',
}

/**
 * Structured validation error with specification traceability
 */
export interface DomainValidationError {
  /** Error code from specification (e.g., 'ERROR-SCHEMA-001') */
  code: string;

  /** Human-readable error message */
  message: string;

  /** JSON path to the field causing the error (e.g., '/plugins/0/version') */
  path: string;

  /** Error severity level */
  severity: ErrorSeverity;

  /** Error category for grouping and filtering */
  category: ErrorCategory;

  /** Additional context for debugging */
  context?: Record<string, unknown>;

  /** Link to specification section (e.g., 'CRIT-001', 'FR-003') */
  specReference?: string;

  /** Suggested resolution or fix */
  resolution?: string;
}

/**
 * Validation result containing status and detailed errors
 */
export interface DomainValidationResult {
  /** Overall validation status */
  status: ValidationStatus;

  /** List of validation errors (empty if valid) */
  errors: DomainValidationError[];

  /** List of non-blocking warnings */
  warnings: DomainValidationError[];

  /** Name of the validated entity (e.g., 'marketplace', 'plugin:hookify') */
  entityName: string;

  /** Timestamp when validation was performed */
  validatedAt: Date;
}

/**
 * Validator interface that domain services and CLI depend on
 *
 * Infrastructure layer implements this interface using AJV or other libraries.
 */
export interface IValidator {
  /**
   * Validate a marketplace index file
   *
   * @param data - Marketplace data to validate
   * @returns Validation result with detailed errors
   */
  validateMarketplace(data: unknown): DomainValidationResult;

  /**
   * Validate a plugin manifest file
   *
   * @param data - Plugin manifest data to validate
   * @param pluginId - Optional plugin ID for enhanced error messages
   * @returns Validation result with detailed errors
   */
  validatePluginManifest(data: unknown, pluginId?: string): DomainValidationResult;

  /**
   * Validate plugin compatibility with current environment
   *
   * @param compatibility - Compatibility requirements from plugin manifest
   * @param environment - Current system environment
   * @returns Validation result with compatibility errors
   */
  validateCompatibility(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment
  ): DomainValidationResult;
}

/**
 * Plugin compatibility requirements from manifest
 */
export interface PluginCompatibility {
  claudeCodeMin: string;
  claudeCodeMax?: string;
  nodeMin?: string;
  nodeMax?: string;
  os?: string[];
  arch?: string[];
  pluginDependencies?: string[];
}

/**
 * Current system environment for compatibility checking
 */
export interface SystemEnvironment {
  claudeCodeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  installedPlugins: string[];
}
