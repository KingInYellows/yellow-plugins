/**
 * Compatibility Service Unit Tests
 *
 * Tests cover Node min/max, OS/arch, Claude runtime, and plugin conflict cases
 * as specified in the acceptance criteria. Validates deterministic verdicts
 * and evidence payloads.
 *
 * @module domain/compatibility/__tests__/compatibilityService
 */

import { describe, it, expect } from 'vitest';

import { ERROR_CODES } from '../../validation/errorCatalog.js';
import type { PluginCompatibility, SystemEnvironment } from '../../validation/types.js';
import { CompatibilityService } from '../compatibilityService.js';
import { CompatibilityStatus } from '../types.js';
import type { RegistrySnapshot } from '../types.js';

describe('CompatibilityService', () => {
  const service = new CompatibilityService();

  const defaultEnvironment: SystemEnvironment = {
    claudeCodeVersion: '1.5.0',
    nodeVersion: '20.10.0',
    platform: 'linux',
    arch: 'x64',
    installedPlugins: [],
  };

  describe('Claude Code version compatibility', () => {
    it('should pass when Claude version meets minimum requirement', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      expect(verdict.checks).toHaveLength(1);
      expect(verdict.checks[0].id).toBe('claude-min');
      expect(verdict.checks[0].passed).toBe(true);
    });

    it('should fail when Claude version below minimum', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '2.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      expect(verdict.checks).toHaveLength(1);
      expect(verdict.checks[0].id).toBe('claude-min');
      expect(verdict.checks[0].passed).toBe(false);
      expect(verdict.checks[0].error?.code).toBe(ERROR_CODES.COMPAT_CLAUDE_VERSION_LOW);
      expect(verdict.checks[0].error?.specReference).toBe('CRIT-002b');
    });

    it('should pass when Claude version within max range', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        claudeCodeMax: '2.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      expect(verdict.checks).toHaveLength(2);
      expect(verdict.checks.every((c) => c.passed)).toBe(true);
    });

    it('should fail when Claude version exceeds maximum', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        claudeCodeMax: '1.4.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      const maxCheck = verdict.checks.find((c) => c.id === 'claude-max');
      expect(maxCheck?.passed).toBe(false);
      expect(maxCheck?.error?.code).toBe(ERROR_CODES.COMPAT_CLAUDE_VERSION_HIGH);
    });

    it('should skip Claude check when override is set', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '2.0.0', // Would fail
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment,
        undefined,
        { skipClaudeCheck: true }
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      expect(verdict.checks).toHaveLength(0);
    });
  });

  describe('Node.js version compatibility', () => {
    it('should pass when Node version meets minimum', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        nodeMin: '18.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const nodeCheck = verdict.checks.find((c) => c.id === 'node-min');
      expect(nodeCheck?.passed).toBe(true);
    });

    it('should pass when Node version within max constraint', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        nodeMin: '18.0.0',
        nodeMax: '22.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const nodeMaxCheck = verdict.checks.find((c) => c.id === 'node-max');
      expect(nodeMaxCheck?.passed).toBe(true);
    });

    it('should fail when Node version below minimum', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        nodeMin: '22.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      const nodeCheck = verdict.checks.find((c) => c.id === 'node-min');
      expect(nodeCheck?.passed).toBe(false);
      expect(nodeCheck?.error?.code).toBe(ERROR_CODES.COMPAT_NODE_VERSION_LOW);
      expect(nodeCheck?.error?.specReference).toBe('CRIT-005');
    });

    it('should fail when Node version exceeds maximum', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        nodeMax: '18.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      const nodeMaxCheck = verdict.checks.find((c) => c.id === 'node-max');
      expect(nodeMaxCheck?.passed).toBe(false);
      expect(nodeMaxCheck?.error?.code).toBe(ERROR_CODES.COMPAT_NODE_VERSION_HIGH);
      expect(nodeMaxCheck?.error?.specReference).toBe('CRIT-019');
    });

    it('should skip Node check when override is set', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        nodeMin: '22.0.0', // Would fail
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment,
        undefined,
        { skipNodeCheck: true }
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const nodeCheck = verdict.checks.find((c) => c.id === 'node-min');
      expect(nodeCheck).toBeUndefined();
    });
  });

  describe('OS platform compatibility', () => {
    it('should pass when platform is in supported list', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        os: ['linux', 'darwin', 'win32'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const osCheck = verdict.checks.find((c) => c.id === 'os-platform');
      expect(osCheck?.passed).toBe(true);
    });

    it('should fail when platform is not supported', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        os: ['darwin', 'win32'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      const osCheck = verdict.checks.find((c) => c.id === 'os-platform');
      expect(osCheck?.passed).toBe(false);
      expect(osCheck?.error?.code).toBe(ERROR_CODES.COMPAT_PLATFORM_UNSUPPORTED);
      expect(osCheck?.error?.specReference).toBe('CRIT-005');
    });

    it('should pass when OS list is empty (no restriction)', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        os: [],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const osCheck = verdict.checks.find((c) => c.id === 'os-platform');
      expect(osCheck).toBeUndefined();
    });
  });

  describe('CPU architecture compatibility', () => {
    it('should pass when architecture is supported', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        arch: ['x64', 'arm64'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const archCheck = verdict.checks.find((c) => c.id === 'cpu-arch');
      expect(archCheck?.passed).toBe(true);
    });

    it('should fail when architecture is not supported', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        arch: ['arm64'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      const archCheck = verdict.checks.find((c) => c.id === 'cpu-arch');
      expect(archCheck?.passed).toBe(false);
      expect(archCheck?.error?.code).toBe(ERROR_CODES.COMPAT_ARCH_UNSUPPORTED);
      expect(archCheck?.error?.specReference).toBe('CRIT-005');
    });

    it('should skip platform checks when override is set', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        os: ['darwin'], // Would fail
        arch: ['arm64'], // Would fail
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment,
        undefined,
        { skipPlatformCheck: true }
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const osCheck = verdict.checks.find((c) => c.id === 'os-platform');
      const archCheck = verdict.checks.find((c) => c.id === 'cpu-arch');
      expect(osCheck).toBeUndefined();
      expect(archCheck).toBeUndefined();
    });
  });

  describe('Plugin dependency conflicts', () => {
    it('should pass when all required plugins are installed', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        pluginDependencies: ['plugin-a', 'plugin-b'],
      };

      const registry: RegistrySnapshot = {
        installedPlugins: ['plugin-a', 'plugin-b', 'plugin-c'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment,
        registry
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const depChecks = verdict.checks.filter((c) => c.type === 'plugin-conflict');
      expect(depChecks).toHaveLength(2);
      expect(depChecks.every((c) => c.passed)).toBe(true);
    });

    it('should fail when required plugin is missing', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        pluginDependencies: ['plugin-a', 'plugin-b'],
      };

      const registry: RegistrySnapshot = {
        installedPlugins: ['plugin-a'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment,
        registry
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      expect(verdict.conflictingPlugins).toEqual(['plugin-b']);

      const failedCheck = verdict.checks.find((c) => !c.passed);
      expect(failedCheck?.error?.code).toBe(ERROR_CODES.COMPAT_PLUGIN_DEPENDENCY_MISSING);
      expect(failedCheck?.error?.specReference).toBe('CRIT-005');
    });

    it('should warn instead of block when allowConflicts is set', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        pluginDependencies: ['plugin-missing'],
      };

      const registry: RegistrySnapshot = {
        installedPlugins: [],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment,
        registry,
        { allowConflicts: true }
      );

      expect(verdict.status).toBe(CompatibilityStatus.WARN);
      const conflictCheck = verdict.checks.find((c) => c.id === 'conflict-plugin-missing');
      expect(conflictCheck?.passed).toBe(true); // Override to pass
      expect(conflictCheck?.message).toContain('conflict override active');
    });

    it('should use environment plugins when registry not provided', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        pluginDependencies: ['env-plugin'],
      };

      const envWithPlugins: SystemEnvironment = {
        ...defaultEnvironment,
        installedPlugins: ['env-plugin'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        envWithPlugins
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      const depCheck = verdict.checks.find((c) => c.id === 'dependency-env-plugin');
      expect(depCheck?.passed).toBe(true);
    });
  });

  describe('Combined compatibility checks', () => {
    it('should pass when all checks succeed', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        claudeCodeMax: '2.0.0',
        nodeMin: '18.0.0',
        os: ['linux', 'darwin'],
        arch: ['x64', 'arm64'],
        pluginDependencies: ['dependency-plugin'],
      };

      const registry: RegistrySnapshot = {
        installedPlugins: ['dependency-plugin'],
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment,
        registry
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      expect(verdict.checks).toHaveLength(6);
      expect(verdict.checks.every((c) => c.passed)).toBe(true);
      expect(verdict.summary).toContain('is compatible');
    });

    it('should block when any critical check fails', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '3.0.0', // Will fail
        nodeMin: '18.0.0', // Will pass
        os: ['linux'], // Will pass
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.BLOCK);
      expect(verdict.summary).toContain('incompatible');
      const failedChecks = verdict.checks.filter((c) => !c.passed);
      expect(failedChecks.length).toBeGreaterThan(0);
    });

    it('should include all check evidence in verdict', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
        nodeMin: '20.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '2.5.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.pluginId).toBe('test-plugin');
      expect(verdict.version).toBe('2.5.0');
      expect(verdict.evaluatedAt).toBeInstanceOf(Date);
      expect(verdict.checks.length).toBeGreaterThan(0);

      for (const check of verdict.checks) {
        expect(check).toHaveProperty('id');
        expect(check).toHaveProperty('type');
        expect(check).toHaveProperty('passed');
        expect(check).toHaveProperty('required');
        expect(check).toHaveProperty('actual');
        expect(check).toHaveProperty('message');
      }
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('should handle exact version matches', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.5.0',
        claudeCodeMax: '1.5.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      expect(verdict.checks.every((c) => c.passed)).toBe(true);
    });

    it('should handle empty compatibility requirements', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: '1.0.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        defaultEnvironment
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
      expect(verdict.checks.length).toBeGreaterThan(0);
    });

    it('should handle version strings with v prefix', () => {
      const compatibility: PluginCompatibility = {
        claudeCodeMin: 'v1.0.0',
      };

      const envWithVPrefix: SystemEnvironment = {
        ...defaultEnvironment,
        claudeCodeVersion: 'v1.5.0',
      };

      const verdict = service.evaluateCompatibility(
        'test-plugin',
        '1.0.0',
        compatibility,
        envWithVPrefix
      );

      expect(verdict.status).toBe(CompatibilityStatus.COMPATIBLE);
    });
  });
});
