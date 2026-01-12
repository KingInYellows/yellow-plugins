/**
 * @yellow-plugins/domain
 *
 * Domain layer - Core business logic and entities for the plugin marketplace.
 * This package contains domain models, value objects, and business rules.
 *
 * Enhanced in Task I1.T2: Configuration and feature-flag contracts
 * Enhanced in Task I1.T3: Validation contracts and error catalog
 */

// Configuration and feature-flag contracts
export type {
  Config,
  FeatureFlags,
  IConfigProvider,
  ConfigValueMetadata,
  ConfigSource,
} from './config/contracts.js';

export {
  DEFAULT_CONFIG,
  DEFAULT_FEATURE_FLAGS,
} from './config/contracts.js';

// Validation contracts and error catalog (I1.T3)
export {
  ValidationStatus,
  ErrorSeverity,
  ErrorCategory,
  type DomainValidationError,
  type DomainValidationResult,
  type IValidator,
  type PluginCompatibility,
  type SystemEnvironment,
  ERROR_CODES,
  ValidationErrorFactory,
  getErrorCodesByCategory,
} from './validation/index.js';

// Compatibility & Policy Engine (I2.T1)
export {
  CompatibilityStatus,
  CompatibilityService,
  type ICompatibilityService,
  type IHostFingerprintProvider,
  type CompatibilityCheck,
  type CompatibilityVerdict,
  type CompatibilityPolicyOverrides,
  type RegistrySnapshot,
} from './compatibility/index.js';

// Package version
export const version = '1.1.0';
