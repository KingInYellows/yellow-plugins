/**
 * @yellow-plugins/domain
 *
 * Domain layer - Core business logic and entities for the plugin marketplace.
 * This package contains domain models, value objects, and business rules.
 *
 * Enhanced in Task I1.T2: Configuration and feature-flag contracts
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

// Package version
export const version = '1.1.0';
