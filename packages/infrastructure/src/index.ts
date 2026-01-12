/**
 * @yellow-plugins/infrastructure
 *
 * Infrastructure layer - External dependencies, adapters, and technical implementations
 * for the plugin marketplace. This package contains schema validators, file system
 * operations, git operations, and other infrastructure concerns.
 *
 * Enhanced in Task I1.T2: Configuration provider implementation
 * Enhanced in Task I1.T3: Validation toolkit exports
 */

// Configuration provider and utilities
export {
  ConfigProvider,
  getConfigProvider,
  resetConfigProvider,
} from './config/configProvider.js';

export type {
  CliFlags,
  ConfigProviderOptions,
} from './config/configProvider.js';

// Validation toolkit exports (I1.T3)
export {
  AjvValidatorFactory,
  sharedValidatorFactory,
  type ValidationError,
  type ValidationResult,
} from './validation/ajvFactory.js';

export {
  SchemaValidator,
  createValidator,
} from './validation/validator.js';

// System fingerprint provider (I2.T1)
export {
  HostFingerprintProvider,
  createFingerprintProvider,
} from './system/fingerprint.js';

// Package version
export const version = '1.1.0';
