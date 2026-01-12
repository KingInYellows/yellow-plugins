/**
 * Compatibility & Policy Engine - Service Contracts
 *
 * Domain interfaces for compatibility evaluation services. These contracts
 * define the public API for compatibility checking without exposing
 * implementation details.
 *
 * @module domain/compatibility/contracts
 */

import type { PluginCompatibility, SystemEnvironment } from '../validation/types.js';

import type {
  CompatibilityVerdict,
  CompatibilityPolicyOverrides,
  RegistrySnapshot,
} from './types.js';

/**
 * Compatibility service interface
 *
 * Evaluates plugin compatibility requirements against the current system
 * environment, producing deterministic verdicts with evidence payloads.
 */
export interface ICompatibilityService {
  /**
   * Evaluate compatibility and produce a verdict
   *
   * @param pluginId - Plugin identifier
   * @param version - Plugin version
   * @param compatibility - Compatibility requirements from plugin manifest
   * @param environment - Current system environment
   * @param registry - Installed plugin registry snapshot (optional)
   * @param overrides - Policy overrides from flags/config (optional)
   * @returns Compatibility verdict with evidence
   */
  evaluateCompatibility(
    pluginId: string,
    version: string,
    compatibility: PluginCompatibility,
    environment: SystemEnvironment,
    registry?: RegistrySnapshot,
    overrides?: CompatibilityPolicyOverrides
  ): CompatibilityVerdict;
}

/**
 * Host fingerprint provider interface
 *
 * Provides system environment information for compatibility checks.
 * Infrastructure layer implements this using Node.js APIs and config.
 */
export interface IHostFingerprintProvider {
  /**
   * Get current system environment snapshot
   *
   * @returns System environment descriptor
   */
  getEnvironment(): SystemEnvironment;

  /**
   * Get Claude Code version
   *
   * @returns Claude Code runtime version
   */
  getClaudeVersion(): string;

  /**
   * Get Node.js version
   *
   * @returns Node.js version (e.g., '18.20.0')
   */
  getNodeVersion(): string;

  /**
   * Get OS platform
   *
   * @returns Platform identifier (e.g., 'darwin', 'linux', 'win32')
   */
  getPlatform(): string;

  /**
   * Get CPU architecture
   *
   * @returns Architecture identifier (e.g., 'x64', 'arm64')
   */
  getArchitecture(): string;
}
