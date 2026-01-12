/**
 * @yellow-plugins/infrastructure
 *
 * Infrastructure layer - External dependencies, adapters, and technical implementations
 * for the plugin marketplace. This package contains schema validators, file system
 * operations, git operations, and other infrastructure concerns.
 *
 * Enhanced in Task I1.T2: Configuration provider implementation
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

// Package version
export const version = '1.1.0';
