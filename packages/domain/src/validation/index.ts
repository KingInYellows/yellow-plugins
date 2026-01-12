/**
 * Domain validation module
 *
 * Provides clean abstractions for marketplace and plugin validation.
 * This module exports only domain types and interfaces that CLI and other
 * domain services can depend on without coupling to infrastructure (AJV).
 *
 * @module domain/validation
 */

export {
  ValidationStatus,
  ErrorSeverity,
  ErrorCategory,
  type DomainValidationError,
  type DomainValidationResult,
  type IValidator,
  type PluginCompatibility,
  type SystemEnvironment,
} from './types.js';

export {
  ERROR_CODES,
  ValidationErrorFactory,
  getErrorCodesByCategory,
} from './errorCatalog.js';
