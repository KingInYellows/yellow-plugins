/**
 * @yellow-plugins/domain - Configuration Contracts
 *
 * Domain contracts for configuration and feature-flag management.
 * Defines typed interfaces for config sources and precedence rules.
 *
 * Precedence Order (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Config files (.claude-plugin/config.json, flags.json)
 * 4. Default values
 *
 * Part of Task I1.T2: Configuration and feature-flag system
 */

/**
 * Configuration settings for the plugin marketplace.
 * Values are resolved following the precedence order above.
 */
export interface Config {
  /**
   * Root directory for plugin data, caches, and metadata.
   * @default '.claude-plugin'
   */
  readonly pluginDir: string;

  /**
   * Directory where plugins are installed (relative to workspace root).
   * @default '.claude/plugins'
   */
  readonly installDir: string;

  /**
   * Maximum cache size in MB before eviction is triggered.
   * @default 500
   */
  readonly maxCacheSizeMb: number;

  /**
   * Enable structured telemetry and audit logging.
   * @default false
   */
  readonly telemetryEnabled: boolean;

  /**
   * Timeout in milliseconds for lifecycle script execution.
   * @default 30000 (30 seconds)
   */
  readonly lifecycleTimeoutMs: number;
}

/**
 * Feature flag definitions for controlling experimental or high-risk features.
 * All flags default to `false` in production unless explicitly enabled.
 */
export interface FeatureFlags {
  /**
   * Enable the 'browse' command for discovering plugins.
   * @default false
   */
  readonly enableBrowse: boolean;

  /**
   * Enable the 'publish' command for publishing plugins to the marketplace.
   * @default false
   */
  readonly enablePublish: boolean;

  /**
   * Enable rollback functionality for reverting to previous plugin versions.
   * @default false
   */
  readonly enableRollback: boolean;

  /**
   * Enable variant switching (e.g., alpha/beta channels).
   * @default false
   */
  readonly enableVariants: boolean;

  /**
   * Enable lifecycle hooks (install/uninstall scripts).
   * @default false
   */
  readonly enableLifecycleHooks: boolean;

  /**
   * Enable compatibility checks before installation.
   * @default true
   */
  readonly enableCompatibilityChecks: boolean;

  /**
   * Enable the CI validation runner.
   * @default false
   */
  readonly enableCiValidation: boolean;
}

/**
 * Configuration source types for debugging and auditing.
 */
export type ConfigSource = 'cli' | 'env' | 'file' | 'default';

/**
 * Metadata about where a configuration value came from.
 */
export interface ConfigValueMetadata {
  readonly value: unknown;
  readonly source: ConfigSource;
}

/**
 * Configuration provider interface that all implementations must satisfy.
 * Enforces the precedence order and provides type-safe access to config values.
 */
export interface IConfigProvider {
  /**
   * Get the complete configuration object with all values resolved.
   */
  getConfig(): Config;

  /**
   * Get the complete feature flags object with all values resolved.
   */
  getFeatureFlags(): FeatureFlags;

  /**
   * Get metadata about a specific config key, including its source.
   * Useful for debugging and audit logs.
   */
  getConfigMetadata(key: keyof Config): ConfigValueMetadata;

  /**
   * Get metadata about a specific feature flag, including its source.
   */
  getFlagMetadata(key: keyof FeatureFlags): ConfigValueMetadata;
}

/**
 * Default configuration values used when no other source provides a value.
 */
export const DEFAULT_CONFIG: Readonly<Config> = {
  pluginDir: '.claude-plugin',
  installDir: '.claude/plugins',
  maxCacheSizeMb: 500,
  telemetryEnabled: false,
  lifecycleTimeoutMs: 30000,
} as const;

/**
 * Default feature flag values.
 * All flags default to `false` for safety, except those explicitly enabled.
 */
export const DEFAULT_FEATURE_FLAGS: Readonly<FeatureFlags> = {
  enableBrowse: false,
  enablePublish: false,
  enableRollback: false,
  enableVariants: false,
  enableLifecycleHooks: false,
  enableCompatibilityChecks: true, // Safety-critical, enabled by default
  enableCiValidation: false,
} as const;
