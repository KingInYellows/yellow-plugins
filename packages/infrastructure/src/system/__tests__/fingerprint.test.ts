/**
 * Host Fingerprint Provider Unit Tests
 *
 * Tests environment fingerprinting, caching behavior, and Node.js API integration.
 *
 * @module infrastructure/system/__tests__/fingerprint
 */

import os from 'node:os';

import { describe, it, expect, beforeEach } from 'vitest';

import { HostFingerprintProvider, createFingerprintProvider } from '../fingerprint.js';

describe('HostFingerprintProvider', () => {
  describe('constructor and basic getters', () => {
    it('should return configured Claude version', () => {
      const provider = new HostFingerprintProvider('1.5.0');

      expect(provider.getClaudeVersion()).toBe('1.5.0');
    });

    it('should return Node version without v prefix', () => {
      const provider = new HostFingerprintProvider('1.0.0');
      const nodeVersion = provider.getNodeVersion();

      expect(nodeVersion).toBe(process.version.replace(/^v/, ''));
      expect(nodeVersion).not.toMatch(/^v/);
    });

    it('should return current platform', () => {
      const provider = new HostFingerprintProvider('1.0.0');
      const platform = provider.getPlatform();

      expect(platform).toBe(os.platform());
      expect(['darwin', 'linux', 'win32']).toContain(platform);
    });

    it('should return current architecture', () => {
      const provider = new HostFingerprintProvider('1.0.0');
      const arch = provider.getArchitecture();

      expect(arch).toBe(os.arch());
      expect(['x64', 'arm64', 'ia32']).toContain(arch);
    });
  });

  describe('getEnvironment', () => {
    it('should return complete environment snapshot', () => {
      const provider = new HostFingerprintProvider('2.0.0');
      const environment = provider.getEnvironment();

      expect(environment).toHaveProperty('claudeCodeVersion', '2.0.0');
      expect(environment).toHaveProperty('nodeVersion');
      expect(environment).toHaveProperty('platform');
      expect(environment).toHaveProperty('arch');
      expect(environment).toHaveProperty('installedPlugins');

      expect(typeof environment.nodeVersion).toBe('string');
      expect(typeof environment.platform).toBe('string');
      expect(typeof environment.arch).toBe('string');
      expect(Array.isArray(environment.installedPlugins)).toBe(true);
    });

    it('should use empty array when no plugins provider given', () => {
      const provider = new HostFingerprintProvider('1.0.0');
      const environment = provider.getEnvironment();

      expect(environment.installedPlugins).toEqual([]);
    });

    it('should call plugins provider when given', () => {
      const pluginProvider = (): string[] => ['plugin-a', 'plugin-b'];
      const provider = new HostFingerprintProvider('1.0.0', pluginProvider);
      const environment = provider.getEnvironment();

      expect(environment.installedPlugins).toEqual(['plugin-a', 'plugin-b']);
    });
  });

  describe('environment caching', () => {
    it('should cache environment on first call', () => {
      let callCount = 0;
      const pluginProvider = (): string[] => {
        callCount++;
        return ['plugin-' + callCount];
      };

      const provider = new HostFingerprintProvider('1.0.0', pluginProvider);

      const env1 = provider.getEnvironment();
      const env2 = provider.getEnvironment();

      expect(env1).toBe(env2); // Same object reference
      expect(callCount).toBe(1); // Provider called only once
      expect(env1.installedPlugins).toEqual(['plugin-1']);
    });

    it('should clear cache when clearCache is called', () => {
      let callCount = 0;
      const pluginProvider = (): string[] => {
        callCount++;
        return ['plugin-' + callCount];
      };

      const provider = new HostFingerprintProvider('1.0.0', pluginProvider);

      const env1 = provider.getEnvironment();
      expect(env1.installedPlugins).toEqual(['plugin-1']);

      provider.clearCache();

      const env2 = provider.getEnvironment();
      expect(env2.installedPlugins).toEqual(['plugin-2']);
      expect(callCount).toBe(2);
    });

    it('should maintain cached values across individual getters', () => {
      const provider = new HostFingerprintProvider('1.5.0');

      provider.getEnvironment(); // Cache environment

      // Individual getters should work without calling plugin provider again
      expect(provider.getClaudeVersion()).toBe('1.5.0');
      expect(provider.getNodeVersion()).toBeTruthy();
      expect(provider.getPlatform()).toBeTruthy();
      expect(provider.getArchitecture()).toBeTruthy();
    });
  });

  describe('createFingerprintProvider factory', () => {
    beforeEach(() => {
      delete process.env['CLAUDE_CODE_VERSION'];
    });

    it('should create provider with default version when env var not set', () => {
      const provider = createFingerprintProvider();

      expect(provider.getClaudeVersion()).toBe('1.0.0');
    });

    it('should create provider with version from environment variable', () => {
      process.env['CLAUDE_CODE_VERSION'] = '3.5.0';

      const provider = createFingerprintProvider();

      expect(provider.getClaudeVersion()).toBe('3.5.0');

      delete process.env['CLAUDE_CODE_VERSION'];
    });

    it('should pass through plugin provider to created instance', () => {
      const pluginProvider = (): string[] => ['custom-plugin'];
      const provider = createFingerprintProvider(pluginProvider);

      const environment = provider.getEnvironment();
      expect(environment.installedPlugins).toEqual(['custom-plugin']);
    });

    it('should create functional provider', () => {
      const provider = createFingerprintProvider();
      const environment = provider.getEnvironment();

      expect(environment).toHaveProperty('claudeCodeVersion');
      expect(environment).toHaveProperty('nodeVersion');
      expect(environment).toHaveProperty('platform');
      expect(environment).toHaveProperty('arch');
      expect(environment).toHaveProperty('installedPlugins');
    });
  });

  describe('offline-first behavior', () => {
    it('should work without network access', () => {
      const provider = new HostFingerprintProvider('1.0.0');
      const environment = provider.getEnvironment();

      // All values should be available from local system
      expect(environment.claudeCodeVersion).toBeTruthy();
      expect(environment.nodeVersion).toBeTruthy();
      expect(environment.platform).toBeTruthy();
      expect(environment.arch).toBeTruthy();
    });

    it('should provide consistent results within single session', () => {
      const provider = new HostFingerprintProvider('1.0.0');

      const env1 = provider.getEnvironment();
      const env2 = provider.getEnvironment();

      expect(env1.nodeVersion).toBe(env2.nodeVersion);
      expect(env1.platform).toBe(env2.platform);
      expect(env1.arch).toBe(env2.arch);
      expect(env1.claudeCodeVersion).toBe(env2.claudeCodeVersion);
    });
  });
});
