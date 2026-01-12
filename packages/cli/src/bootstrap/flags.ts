/**
 * @yellow-plugins/cli - Bootstrap & Feature Flags
 *
 * CLI preflight banner that displays current feature flag states before
 * command execution. This ensures users are aware of enabled/disabled features.
 *
 * Part of Task I1.T2: Configuration and feature-flag system
 */

import type { FeatureFlags, Config } from '@yellow-plugins/domain';

/**
 * Format a feature flag for display in the preflight banner.
 */
function formatFlag(name: string, enabled: boolean): string {
  const status = enabled ? '✓' : '✗';
  const label = enabled ? 'enabled' : 'disabled';
  return `  ${status} ${name}: ${label}`;
}

/**
 * Generate the preflight banner showing current feature flag states.
 */
export function getPreflightBanner(
  flags: FeatureFlags,
  config: Config,
  version: string = '1.1.0'
): string[] {
  const lines: string[] = [
    `Yellow Plugins CLI v${version}`,
    'Plugin marketplace for Claude Code',
    '',
    'Configuration:',
    `  Plugin directory: ${config.pluginDir}`,
    `  Install directory: ${config.installDir}`,
    `  Max cache size: ${config.maxCacheSizeMb} MB`,
    `  Telemetry: ${config.telemetryEnabled ? 'enabled' : 'disabled'}`,
    '',
    'Feature Flags:',
    formatFlag('Browse marketplace', flags.enableBrowse),
    formatFlag('Publish plugins', flags.enablePublish),
    formatFlag('Rollback versions', flags.enableRollback),
    formatFlag('Variant switching', flags.enableVariants),
    formatFlag('Lifecycle hooks', flags.enableLifecycleHooks),
    formatFlag('Compatibility checks', flags.enableCompatibilityChecks),
    formatFlag('CI validation', flags.enableCiValidation),
    '',
  ];

  return lines;
}

/**
 * Print the preflight banner to the console.
 */
export function printPreflightBanner(
  flags: FeatureFlags,
  config: Config,
  version?: string
): void {
  const lines = getPreflightBanner(flags, config, version);
  for (const line of lines) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

/**
 * Get a formatted source indicator for debugging (shows where config came from).
 */
export function formatConfigSource(source: 'cli' | 'env' | 'file' | 'default'): string {
  const indicators: Record<typeof source, string> = {
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
