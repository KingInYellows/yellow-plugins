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

// Cache Management (I2.T2)
export {
  CacheService,
  type ICacheService,
  type ICacheAdapter,
  type CacheEntry,
  type CacheIndex,
  type CacheOperationOptions,
  type CacheOperationResult,
  type CachePromotionData,
  type CacheStagingData,
  type CacheStats,
  type EvictionResult,
  type EvictionLogEntry,
  EvictionReason,
} from './cache/index.js';

// Registry Management (I2.T2)
export {
  RegistryService,
  type IRegistryService,
  type InstalledPlugin,
  type InstalledPluginRegistry,
  type RegistryBackup,
  type RegistryMetadata,
  type RegistryOperationResult,
  type RegistryQuery,
  type RegistryUpdateOptions,
  type TelemetrySnapshot,
  InstallState,
} from './registry/index.js';

// Package version
export const version = '1.2.0';
