/**
 * Host Fingerprint Provider - Infrastructure Adapter
 *
 * Implements IHostFingerprintProvider using Node.js APIs and configuration.
 * Provides cached system environment snapshots for offline-first compatibility
 * checking.
 *
 * @module infrastructure/system/fingerprint
 */

import os from 'node:os';

import type {
  IHostFingerprintProvider,
  SystemEnvironment,
} from '@yellow-plugins/domain';

/**
 * Host fingerprint provider implementation
 *
 * Caches environment data on first access to support offline-first operation
 * and consistent results within a single command execution.
 */
export class HostFingerprintProvider implements IHostFingerprintProvider {
  private cachedEnvironment?: SystemEnvironment;
  private readonly claudeVersion: string;
  private readonly installedPluginsProvider?: () => string[];

  /**
   * Create a new fingerprint provider
   *
   * @param claudeVersion - Claude Code runtime version from config
   * @param installedPluginsProvider - Optional function to get installed plugin IDs
   */
  constructor(
    claudeVersion: string,
    installedPluginsProvider?: () => string[]
  ) {
    this.claudeVersion = claudeVersion;
    this.installedPluginsProvider = installedPluginsProvider;
  }

  getEnvironment(): SystemEnvironment {
    // Return cached environment if available
    if (this.cachedEnvironment) {
      return this.cachedEnvironment;
    }

    // Build environment snapshot
    this.cachedEnvironment = {
      claudeCodeVersion: this.claudeVersion,
      nodeVersion: this.getNodeVersion(),
      platform: this.getPlatform(),
      arch: this.getArchitecture(),
      installedPlugins: this.installedPluginsProvider?.() || [],
    };

    return this.cachedEnvironment;
  }

  getClaudeVersion(): string {
    return this.claudeVersion;
  }

  getNodeVersion(): string {
    // Remove 'v' prefix if present (e.g., 'v18.20.0' -> '18.20.0')
    return process.version.replace(/^v/, '');
  }

  getPlatform(): string {
    // Returns: 'darwin', 'linux', 'win32', etc.
    return os.platform();
  }

  getArchitecture(): string {
    // Returns: 'x64', 'arm64', etc.
    return os.arch();
  }

  /**
   * Clear cached environment (useful for testing)
   */
  clearCache(): void {
    this.cachedEnvironment = undefined;
  }
}

/**
 * Create a default fingerprint provider
 *
 * Uses environment variables and defaults for Claude Code version.
 *
 * @param installedPluginsProvider - Optional function to get installed plugin IDs
 * @returns Configured fingerprint provider
 */
export function createFingerprintProvider(
  installedPluginsProvider?: () => string[]
): HostFingerprintProvider {
  // Claude Code version from environment or default to 1.0.0
  const claudeVersion = process.env['CLAUDE_CODE_VERSION'] || '1.0.0';

  return new HostFingerprintProvider(claudeVersion, installedPluginsProvider);
}
