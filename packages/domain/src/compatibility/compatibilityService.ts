/**
 * Compatibility & Policy Engine - Core Service Implementation
 *
 * Implements deterministic compatibility evaluation by checking Claude runtime,
 * Node.js versions, OS/arch constraints, and plugin conflicts. Produces
 * structured verdicts with evidence payloads for CLI consumption.
 *
 * @module domain/compatibility/compatibilityService
 */

import { ValidationErrorFactory } from '../validation/errorCatalog.js';
import type { PluginCompatibility, SystemEnvironment } from '../validation/types.js';

import type { ICompatibilityService } from './contracts.js';
import type {
  CompatibilityCheck,
  CompatibilityPolicyOverrides,
  CompatibilityStatus,
  CompatibilityVerdict,
  RegistrySnapshot,
} from './types.js';
import { CompatibilityStatus as Status } from './types.js';

/**
 * Semver comparison helper
 */
class SemverHelper {
  /**
   * Parse a semver string into numeric components
   */
  static parse(version: string): { major: number; minor: number; patch: number } {
    const cleaned = version.replace(/^v/, '');
    const parts = cleaned.split('.').map((p) => parseInt(p.replace(/[^\d]/g, ''), 10));

    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
    };
  }

  /**
   * Compare two semver versions
   * @returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  static compare(a: string, b: string): number {
    const vA = this.parse(a);
    const vB = this.parse(b);

    if (vA.major !== vB.major) {
      return vA.major > vB.major ? 1 : -1;
    }
    if (vA.minor !== vB.minor) {
      return vA.minor > vB.minor ? 1 : -1;
    }
    if (vA.patch !== vB.patch) {
      return vA.patch > vB.patch ? 1 : -1;
    }

    return 0;
  }

  /**
   * Check if version is greater than or equal to minimum
   */
  static isGte(actual: string, min: string): boolean {
    return this.compare(actual, min) >= 0;
  }

  /**
   * Check if version is less than or equal to maximum
   */
  static isLte(actual: string, max: string): boolean {
    return this.compare(actual, max) <= 0;
  }
}

/**
 * Core compatibility service implementation
 */
export class CompatibilityService implements ICompatibilityService {
  evaluateCompatibility(
    pluginId: string,
    version: string,
    compatibility: PluginCompatibility,
    environment: SystemEnvironment,
    registry?: RegistrySnapshot,
    overrides?: CompatibilityPolicyOverrides
  ): CompatibilityVerdict {
    const checks: CompatibilityCheck[] = [];
    const evaluatedAt = new Date();

    // Check Claude Code version
    if (!overrides?.skipClaudeCheck) {
      checks.push(...this.checkClaudeVersion(compatibility, environment));
    }

    // Check Node.js version
    if (!overrides?.skipNodeCheck) {
      checks.push(...this.checkNodeVersion(compatibility, environment));
    }

    // Check OS platform
    if (!overrides?.skipPlatformCheck) {
      checks.push(...this.checkOsPlatform(compatibility, environment));
    }

    // Check CPU architecture
    if (!overrides?.skipPlatformCheck) {
      checks.push(...this.checkArchitecture(compatibility, environment));
    }

    // Check plugin conflicts
    const conflictResult = this.checkPluginConflicts(
      compatibility,
      environment,
      registry,
      overrides
    );
    if (conflictResult.checks.length > 0) {
      checks.push(...conflictResult.checks);
    }

    // Determine overall status
    const status = this.determineStatus(checks, conflictResult.hasOverriddenConflicts);
    const summary = this.buildSummary(status, checks, pluginId, version);

    return {
      status,
      checks,
      pluginId,
      version,
      evaluatedAt,
      conflictingPlugins: conflictResult.conflicts,
      summary,
    };
  }

  /**
   * Check Claude Code version requirements
   */
  private checkClaudeVersion(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment
  ): CompatibilityCheck[] {
    const checks: CompatibilityCheck[] = [];
    const { claudeCodeMin, claudeCodeMax } = compatibility;
    const { claudeCodeVersion } = environment;

    // Check minimum version
    if (claudeCodeMin) {
      const passed = SemverHelper.isGte(claudeCodeVersion, claudeCodeMin);
      checks.push({
        id: 'claude-min',
        type: 'claude-runtime',
        passed,
        required: `>=${claudeCodeMin}`,
        actual: claudeCodeVersion,
        message: passed
          ? `Claude Code ${claudeCodeVersion} meets minimum ${claudeCodeMin}`
          : `Claude Code ${claudeCodeVersion} below minimum ${claudeCodeMin}`,
        error: passed
          ? undefined
          : ValidationErrorFactory.compatibilityError(
              'claudeCodeMin',
              claudeCodeVersion,
              `>=${claudeCodeMin}`
            ),
      });
    }

    // Check maximum version
    if (claudeCodeMax) {
      const passed = SemverHelper.isLte(claudeCodeVersion, claudeCodeMax);
      checks.push({
        id: 'claude-max',
        type: 'claude-runtime',
        passed,
        required: `<=${claudeCodeMax}`,
        actual: claudeCodeVersion,
        message: passed
          ? `Claude Code ${claudeCodeVersion} within maximum ${claudeCodeMax}`
          : `Claude Code ${claudeCodeVersion} exceeds maximum ${claudeCodeMax}`,
        error: passed
          ? undefined
          : ValidationErrorFactory.compatibilityError(
              'claudeCodeMax',
              claudeCodeVersion,
              `<=${claudeCodeMax}`
            ),
      });
    }

    return checks;
  }

  /**
   * Check Node.js version requirements
   */
  private checkNodeVersion(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment
  ): CompatibilityCheck[] {
    const checks: CompatibilityCheck[] = [];
    const { nodeMin, nodeMax } = compatibility;
    const { nodeVersion } = environment;

    if (nodeMin) {
      const passed = SemverHelper.isGte(nodeVersion, nodeMin);
      checks.push({
        id: 'node-min',
        type: 'node-version',
        passed,
        required: `>=${nodeMin}`,
        actual: nodeVersion,
        message: passed
          ? `Node.js ${nodeVersion} meets minimum ${nodeMin}`
          : `Node.js ${nodeVersion} below minimum ${nodeMin}`,
        error: passed
          ? undefined
          : ValidationErrorFactory.compatibilityError('nodeMin', nodeVersion, `>=${nodeMin}`),
      });
    }

    if (nodeMax) {
      const passed = SemverHelper.isLte(nodeVersion, nodeMax);
      checks.push({
        id: 'node-max',
        type: 'node-version',
        passed,
        required: `<=${nodeMax}`,
        actual: nodeVersion,
        message: passed
          ? `Node.js ${nodeVersion} within maximum ${nodeMax}`
          : `Node.js ${nodeVersion} exceeds maximum ${nodeMax}`,
        error: passed
          ? undefined
          : ValidationErrorFactory.compatibilityError('nodeMax', nodeVersion, `<=${nodeMax}`),
      });
    }

    return checks;
  }

  /**
   * Check OS platform requirements
   */
  private checkOsPlatform(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment
  ): CompatibilityCheck[] {
    const checks: CompatibilityCheck[] = [];
    const { os } = compatibility;
    const { platform } = environment;

    if (os && os.length > 0) {
      const passed = os.includes(platform);
      checks.push({
        id: 'os-platform',
        type: 'os',
        passed,
        required: os.join(', '),
        actual: platform,
        message: passed
          ? `Platform ${platform} is supported`
          : `Platform ${platform} not in supported list: ${os.join(', ')}`,
        error: passed
          ? undefined
          : ValidationErrorFactory.compatibilityError('os', platform, os.join(', ')),
      });
    }

    return checks;
  }

  /**
   * Check CPU architecture requirements
   */
  private checkArchitecture(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment
  ): CompatibilityCheck[] {
    const checks: CompatibilityCheck[] = [];
    const { arch } = compatibility;
    const { arch: actualArch } = environment;

    if (arch && arch.length > 0) {
      const passed = arch.includes(actualArch);
      checks.push({
        id: 'cpu-arch',
        type: 'arch',
        passed,
        required: arch.join(', '),
        actual: actualArch,
        message: passed
          ? `Architecture ${actualArch} is supported`
          : `Architecture ${actualArch} not in supported list: ${arch.join(', ')}`,
        error: passed
          ? undefined
          : ValidationErrorFactory.compatibilityError('arch', actualArch, arch.join(', ')),
      });
    }

    return checks;
  }

  /**
   * Check for plugin dependency conflicts
   */
  private checkPluginConflicts(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment,
    registry?: RegistrySnapshot,
    overrides?: CompatibilityPolicyOverrides
  ): { checks: CompatibilityCheck[]; conflicts: string[]; hasOverriddenConflicts: boolean } {
    const checks: CompatibilityCheck[] = [];
    const conflicts: string[] = [];
    let hasOverriddenConflicts = false;
    const { pluginDependencies } = compatibility;

    if (!pluginDependencies || pluginDependencies.length === 0) {
      return { checks, conflicts, hasOverriddenConflicts };
    }

    const installedPlugins = registry?.installedPlugins || environment.installedPlugins;

    for (const requiredPlugin of pluginDependencies) {
      const passed = installedPlugins.includes(requiredPlugin);

      // If allowing conflicts, downgrade to warning
      if (!passed && overrides?.allowConflicts) {
        checks.push({
          id: `conflict-${requiredPlugin}`,
          type: 'plugin-conflict',
          passed: true, // Override to pass with warning
          required: requiredPlugin,
          actual: 'not installed',
          message: `Warning: Required plugin ${requiredPlugin} not installed (conflict override active)`,
        });
        hasOverriddenConflicts = true;
        continue;
      }

      checks.push({
        id: `dependency-${requiredPlugin}`,
        type: 'plugin-conflict',
        passed,
        required: requiredPlugin,
        actual: passed ? 'installed' : 'not installed',
        message: passed
          ? `Required plugin ${requiredPlugin} is installed`
          : `Required plugin ${requiredPlugin} is missing`,
        error: passed
          ? undefined
          : ValidationErrorFactory.compatibilityError(
              'pluginDependencies',
              'not installed',
              requiredPlugin
            ),
      });

      if (!passed) {
        conflicts.push(requiredPlugin);
      }
    }

    return { checks, conflicts, hasOverriddenConflicts };
  }

  /**
   * Determine overall verdict status from checks
   */
  private determineStatus(
    checks: CompatibilityCheck[],
    hasOverriddenConflicts: boolean
  ): CompatibilityStatus {
    const failedChecks = checks.filter((c) => !c.passed);

    // No failures but we overrode conflicts = warn
    if (failedChecks.length === 0 && hasOverriddenConflicts) {
      return Status.WARN;
    }

    // No failures = compatible
    if (failedChecks.length === 0) {
      return Status.COMPATIBLE;
    }

    // Any failures = block
    return Status.BLOCK;
  }

  /**
   * Build summary message for verdict
   */
  private buildSummary(
    status: CompatibilityStatus,
    checks: CompatibilityCheck[],
    pluginId: string,
    version: string
  ): string {
    const failedCount = checks.filter((c) => !c.passed).length;

    if (status === Status.COMPATIBLE) {
      return `Plugin ${pluginId}@${version} is compatible with current environment (${checks.length} checks passed)`;
    }

    if (status === Status.WARN) {
      return `Plugin ${pluginId}@${version} has ${failedCount} warning(s) but can be installed`;
    }

    return `Plugin ${pluginId}@${version} is incompatible (${failedCount} check(s) failed)`;
  }
}
