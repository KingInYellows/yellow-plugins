/**
 * @yellow-plugins/cli - Bootstrap & Feature Flags
 *
 * CLI preflight banner that displays current feature flag states before
 * command execution. This ensures users are aware of enabled/disabled features.
 *
 * Part of Task I1.T2: Configuration and feature-flag system
 */

import type { FeatureFlags, Config, ConfigSource, ConfigValueMetadata } from '@yellow-plugins/domain';

/**
 * Get a formatted source indicator for debugging (shows where config came from).
 */
export function formatConfigSource(source: ConfigSource): string {
  const indicators: Record<ConfigSource, string> = {
    cli: '[CLI]',
    env: '[ENV]',
    file: '[FILE]',
    default: '[DEFAULT]',
  };
  return indicators[source];
}

/**
 * Generate an extended debug banner with config source metadata.
 * Useful for troubleshooting precedence issues.
 */
export function getDebugBanner(
  flags: FeatureFlags,
  config: Config,
  configProvider: {
    getConfigMetadata: (key: keyof Config) => ConfigValueMetadata;
    getFlagMetadata: (key: keyof FeatureFlags) => ConfigValueMetadata;
 * Useful for troubleshooting precedence issues.
 */
export function getDebugBanner(
  flags: FeatureFlags,
  config: Config,
  configProvider: {
    getConfigMetadata: (key: keyof Config) => { value: unknown; source: 'cli' | 'env' | 'file' | 'default' };
    getFlagMetadata: (key: keyof FeatureFlags) => { value: unknown; source: 'cli' | 'env' | 'file' | 'default' };
  },
  version: string = '1.1.0'
): string[] {
  const lines: string[] = [
    `Yellow Plugins CLI v${version} - DEBUG MODE`,
    'Plugin marketplace for Claude Code',
    '',
    'Configuration (with sources):',
  ];

  // Add config values with their sources
  const configKeys: Array<keyof Config> = [
    'pluginDir',
    'installDir',
    'maxCacheSizeMb',
    'telemetryEnabled',
    'lifecycleTimeoutMs',
  ];

  for (const key of configKeys) {
    const metadata = configProvider.getConfigMetadata(key);
    const sourceTag = formatConfigSource(metadata.source);
    lines.push(`  ${key}: ${config[key]} ${sourceTag}`);
  }

  lines.push('', 'Feature Flags (with sources):');

  // Add flag values with their sources
  const flagKeys: Array<keyof FeatureFlags> = [
    'enableBrowse',
    'enablePublish',
    'enableRollback',
    'enableVariants',
    'enableLifecycleHooks',
    'enableCompatibilityChecks',
    'enableCiValidation',
  ];

  for (const key of flagKeys) {
    const metadata = configProvider.getFlagMetadata(key);
    const sourceTag = formatConfigSource(metadata.source);
    const value = flags[key] ? 'true' : 'false';
    lines.push(`  ${key}: ${value} ${sourceTag}`);
  }

  lines.push('');
  return lines;
}
