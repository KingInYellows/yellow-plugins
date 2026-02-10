/**
 * @yellow-plugins/domain
 *
 * Domain layer - Validation types and error catalog for the plugin marketplace.
 * Stripped down to validation-only: install/uninstall/rollback/browse/publish
 * logic is handled natively by Claude Code.
 */

// Validation contracts and error catalog
export {
  ValidationStatus,
  ErrorSeverity,
  ErrorCategory,
  type DomainValidationError,
  type DomainValidationResult,
  type IValidator,
  type PluginCompatibility,
  type SystemEnvironment,
} from './validation/types.js';

export {
  ERROR_CODES,
  ValidationErrorFactory,
  getErrorCodesByCategory,
} from './validation/errorCatalog.js';

export const version = '2.0.0';
