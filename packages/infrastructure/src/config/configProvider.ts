/**
 * @yellow-plugins/infrastructure - Configuration Provider
 *
 * Implements the configuration and feature-flag resolution logic with precedence rules:
 * 1. CLI flags (highest priority)
 * 2. Environment variables
 * 3. Config files (.claude-plugin/config.json, flags.json)
 * 4. Default values (lowest priority)
 *
 * Part of Task I1.T2: Configuration and feature-flag system
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  Config,
  FeatureFlags,
  IConfigProvider,
  ConfigValueMetadata,
} from '@yellow-plugins/domain';
import { DEFAULT_CONFIG, DEFAULT_FEATURE_FLAGS } from '@yellow-plugins/domain';

/**
 * Raw configuration from file sources.
 */
interface ConfigFile {
  pluginDir?: string;
  installDir?: string;
  maxCacheSizeMb?: number;
  telemetryEnabled?: boolean;
  lifecycleTimeoutMs?: number;
}

/**
 * Raw feature flags from file sources.
 */
interface FlagsFile {
  enableBrowse?: boolean;
  enablePublish?: boolean;
  enableRollback?: boolean;
  enableVariants?: boolean;
  enableLifecycleHooks?: boolean;
  enableCompatibilityChecks?: boolean;
  enableCiValidation?: boolean;
}

/**
 * CLI flag overrides passed to the config provider.
 */
export interface CliFlags {
  pluginDir?: string;
  installDir?: string;
  maxCacheSizeMb?: number;
  telemetryEnabled?: boolean;
  lifecycleTimeoutMs?: number;
}

/**
 * Options for initializing the ConfigProvider.
 */
export interface ConfigProviderOptions {
  /**
   * Workspace root directory (defaults to cwd).
   */
  workspaceRoot?: string;

  /**
   * CLI flags to override config values (highest precedence).
   */
  cliFlags?: CliFlags;

  /**
   * Custom environment variables object (defaults to process.env).
   * Useful for testing.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Environment variable prefix for config overrides.
 */
const ENV_PREFIX = 'YELLOW_PLUGINS_';

/**
 * Implementation of IConfigProvider that resolves values from multiple sources.
 */
export class ConfigProvider implements IConfigProvider {
  private readonly workspaceRoot: string;
  private readonly cliFlags: CliFlags;
  private readonly env: Record<string, string | undefined>;

  private configCache: Config | null = null;
  private flagsCache: FeatureFlags | null = null;
  private configMetadataCache = new Map<keyof Config, ConfigValueMetadata>();
  private flagMetadataCache = new Map<keyof FeatureFlags, ConfigValueMetadata>();

  constructor(options: ConfigProviderOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.cliFlags = options.cliFlags ?? {};
    this.env = options.env ?? process.env;
  }

  /**
   * Get the complete configuration object with all values resolved.
   */
  getConfig(): Config {
    if (this.configCache) {
      return this.configCache;
    }

    const fileConfig = this.loadConfigFile();
    const config: Config = {
      pluginDir: this.resolveConfigValue('pluginDir', fileConfig.pluginDir),
      installDir: this.resolveConfigValue('installDir', fileConfig.installDir),
      maxCacheSizeMb: this.resolveConfigValue('maxCacheSizeMb', fileConfig.maxCacheSizeMb),
      telemetryEnabled: this.resolveConfigValue('telemetryEnabled', fileConfig.telemetryEnabled),
      lifecycleTimeoutMs: this.resolveConfigValue('lifecycleTimeoutMs', fileConfig.lifecycleTimeoutMs),
    };

    this.configCache = config;
    return config;
  }

  /**
   * Get the complete feature flags object with all values resolved.
   */
  getFeatureFlags(): FeatureFlags {
    if (this.flagsCache) {
      return this.flagsCache;
    }

    const fileFlags = this.loadFlagsFile();
    const flags: FeatureFlags = {
      enableBrowse: this.resolveFlagValue('enableBrowse', fileFlags.enableBrowse),
      enablePublish: this.resolveFlagValue('enablePublish', fileFlags.enablePublish),
      enableRollback: this.resolveFlagValue('enableRollback', fileFlags.enableRollback),
      enableVariants: this.resolveFlagValue('enableVariants', fileFlags.enableVariants),
      enableLifecycleHooks: this.resolveFlagValue('enableLifecycleHooks', fileFlags.enableLifecycleHooks),
      enableCompatibilityChecks: this.resolveFlagValue('enableCompatibilityChecks', fileFlags.enableCompatibilityChecks),
      enableCiValidation: this.resolveFlagValue('enableCiValidation', fileFlags.enableCiValidation),
    };

    this.flagsCache = flags;
    return flags;
  }

  /**
   * Get metadata about a specific config key, including its source.
   */
  getConfigMetadata(key: keyof Config): ConfigValueMetadata {
    // Ensure config is loaded and metadata is cached
    this.getConfig();

    const cached = this.configMetadataCache.get(key);
    if (!cached) {
      throw new Error(`Config metadata not found for key: ${key}`);
    }
    return cached;
  }

  /**
   * Get metadata about a specific feature flag, including its source.
   */
  getFlagMetadata(key: keyof FeatureFlags): ConfigValueMetadata {
    // Ensure flags are loaded and metadata is cached
    this.getFeatureFlags();

    const cached = this.flagMetadataCache.get(key);
    if (!cached) {
      throw new Error(`Flag metadata not found for key: ${key}`);
    }
    return cached;
  }

  /**
   * Resolve a config value following the precedence order.
   */
  private resolveConfigValue<K extends keyof Config>(
    key: K,
    fileValue: Config[K] | undefined
  ): Config[K] {
    // 1. CLI flags (highest priority)
    const cliValue = this.cliFlags[key as keyof CliFlags];
    if (cliValue !== undefined) {
      this.configMetadataCache.set(key, { value: cliValue, source: 'cli' });
      return cliValue as Config[K];
    }

    // 2. Environment variables
    const envKey = `${ENV_PREFIX}${this.toSnakeCase(key)}`.toUpperCase();
    const envValue = this.env[envKey];
    if (envValue !== undefined) {
      const parsed = this.parseEnvValue(key, envValue);
      this.configMetadataCache.set(key, { value: parsed, source: 'env' });
      return parsed as Config[K];
    }

    // 3. Config file
    if (fileValue !== undefined) {
      this.configMetadataCache.set(key, { value: fileValue, source: 'file' });
      return fileValue;
    }

    // 4. Default value (lowest priority)
    const defaultValue = DEFAULT_CONFIG[key];
    this.configMetadataCache.set(key, { value: defaultValue, source: 'default' });
    return defaultValue;
  }

  /**
   * Resolve a feature flag value following the precedence order.
   */
  private resolveFlagValue<K extends keyof FeatureFlags>(
    key: K,
    fileValue: FeatureFlags[K] | undefined
  ): FeatureFlags[K] {
    // 1. Environment variables (CLI flags don't typically override feature flags)
    const envKey = `${ENV_PREFIX}${this.toSnakeCase(key)}`.toUpperCase();
    const envValue = this.env[envKey];
    if (envValue !== undefined) {
      const parsed = this.parseEnvBoolean(envValue);
      this.flagMetadataCache.set(key, { value: parsed, source: 'env' });
      return parsed as FeatureFlags[K];
    }

    // 2. Flags file
    if (fileValue !== undefined) {
      this.flagMetadataCache.set(key, { value: fileValue, source: 'file' });
      return fileValue;
    }

    // 3. Default value
    const defaultValue = DEFAULT_FEATURE_FLAGS[key];
    this.flagMetadataCache.set(key, { value: defaultValue, source: 'default' });
    return defaultValue;
  }

  /**
   * Load config from .claude-plugin/config.json if it exists.
   */
  private loadConfigFile(): ConfigFile {
    const configPath = resolve(this.workspaceRoot, '.claude-plugin', 'config.json');
    if (!existsSync(configPath)) {
      return {};
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as ConfigFile;
    } catch (error) {
      // If the file is malformed, log a warning and fall back to defaults
      console.warn(`Failed to parse config file at ${configPath}:`, error);
      return {};
    }
  }

  /**
   * Load feature flags from .claude-plugin/flags.json if it exists.
   */
  private loadFlagsFile(): FlagsFile {
    const flagsPath = resolve(this.workspaceRoot, '.claude-plugin', 'flags.json');
    if (!existsSync(flagsPath)) {
      return {};
    }

    try {
      const content = readFileSync(flagsPath, 'utf-8');
      return JSON.parse(content) as FlagsFile;
    } catch (error) {
      console.warn(`Failed to parse flags file at ${flagsPath}:`, error);
      return {};
    }
  }

  /**
   * Convert camelCase to snake_case for environment variable lookup.
   */
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  /**
   * Parse environment variable value based on the config key type.
   */
  private parseEnvValue<K extends keyof Config>(key: K, value: string): Config[K] {
    const defaultValue = DEFAULT_CONFIG[key];

    if (typeof defaultValue === 'number') {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        console.warn(`Invalid number for ${key}: ${value}, using default`);
        return defaultValue;
      }
      return parsed as Config[K];
    }

    if (typeof defaultValue === 'boolean') {
      return this.parseEnvBoolean(value) as Config[K];
    }

    // String type
    return value as Config[K];
  }

  /**
   * Parse a boolean value from an environment variable.
   */
  private parseEnvBoolean(value: string): boolean {
    const normalized = value.toLowerCase().trim();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
}

/**
 * Global singleton config provider instance.
 * Initialized lazily on first access.
 */
let globalConfigProvider: ConfigProvider | null = null;

/**
 * Get the global config provider instance.
 */
export function getConfigProvider(options?: ConfigProviderOptions): ConfigProvider {
  if (!globalConfigProvider || options) {
    globalConfigProvider = new ConfigProvider(options);
  }
  return globalConfigProvider;
}

/**
 * Reset the global config provider (useful for testing).
 */
export function resetConfigProvider(): void {
  globalConfigProvider = null;
}
