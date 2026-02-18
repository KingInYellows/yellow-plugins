/**
 * @yellow-plugins/infrastructure
 *
 * Infrastructure layer - Schema validation using AJV.
 * Stripped down to validation-only: cache adapters, filesystem operations,
 * telemetry, and fingerprinting are no longer needed (Claude Code handles them).
 */

// Validation toolkit
export {
  AjvValidatorFactory,
  sharedValidatorFactory,
  type ValidationError,
  type ValidationResult,
} from './validation/ajvFactory.js';

export { SchemaValidator, createValidator } from './validation/validator.js';

export const version = '2.0.0';
