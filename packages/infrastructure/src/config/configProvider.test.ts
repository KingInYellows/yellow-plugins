/**
 * @yellow-plugins/infrastructure - ConfigProvider Tests
 *
 * Unit tests for configuration and feature-flag precedence logic.
 * Tests verify the order: CLI > ENV > FILE > DEFAULT
 *
 * Part of Task I1.T2: Configuration and feature-flag system
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


import { DEFAULT_CONFIG, DEFAULT_FEATURE_FLAGS } from '@yellow-plugins/domain';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ConfigProvider, resetConfigProvider } from './configProvider.js';

describe('ConfigProvider', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    testDir = mkdtempSync(join(tmpdir(), 'yellow-plugins-test-'));
    resetConfigProvider();
  });

  afterEach(() => {
    // Clean up temporary directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Config Precedence', () => {
    it('should use default values when no other source is provided', () => {
      const provider = new ConfigProvider({ workspaceRoot: testDir });
      const config = provider.getConfig();

      expect(config.pluginDir).toBe(DEFAULT_CONFIG.pluginDir);
      expect(config.installDir).toBe(DEFAULT_CONFIG.installDir);
      expect(config.maxCacheSizeMb).toBe(DEFAULT_CONFIG.maxCacheSizeMb);
      expect(config.telemetryEnabled).toBe(DEFAULT_CONFIG.telemetryEnabled);
      expect(config.lifecycleTimeoutMs).toBe(DEFAULT_CONFIG.lifecycleTimeoutMs);
    });

    it('should load values from config file when present', () => {
      // Create .claude-plugin/config.json
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'config.json'),
        JSON.stringify({
          pluginDir: 'custom-plugin-dir',
          maxCacheSizeMb: 1000,
          telemetryEnabled: true,
        })
      );

      const provider = new ConfigProvider({ workspaceRoot: testDir });
      const config = provider.getConfig();

      expect(config.pluginDir).toBe('custom-plugin-dir');
      expect(config.maxCacheSizeMb).toBe(1000);
      expect(config.telemetryEnabled).toBe(true);
      // Values not in file should fall back to defaults
      expect(config.installDir).toBe(DEFAULT_CONFIG.installDir);
    });

    it('should override file values with environment variables', () => {
      // Create config file
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'config.json'),
        JSON.stringify({
          pluginDir: 'file-plugin-dir',
          maxCacheSizeMb: 500,
        })
      );

      // Set environment variables
      const env = {
        YELLOW_PLUGINS_PLUGIN_DIR: 'env-plugin-dir',
        YELLOW_PLUGINS_MAX_CACHE_SIZE_MB: '2000',
      };

      const provider = new ConfigProvider({ workspaceRoot: testDir, env });
      const config = provider.getConfig();

      expect(config.pluginDir).toBe('env-plugin-dir');
      expect(config.maxCacheSizeMb).toBe(2000);
    });

    it('should override environment variables with CLI flags', () => {
      // Create config file
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'config.json'),
        JSON.stringify({
          pluginDir: 'file-plugin-dir',
        })
      );

      // Set environment variables
      const env = {
        YELLOW_PLUGINS_PLUGIN_DIR: 'env-plugin-dir',
      };

      // Set CLI flags
      const cliFlags = {
        pluginDir: 'cli-plugin-dir',
      };

      const provider = new ConfigProvider({ workspaceRoot: testDir, env, cliFlags });
      const config = provider.getConfig();

      expect(config.pluginDir).toBe('cli-plugin-dir');
    });

    it('should correctly parse boolean environment variables', () => {
      const testCases = [
        { envValue: 'true', expected: true },
        { envValue: 'TRUE', expected: true },
        { envValue: '1', expected: true },
        { envValue: 'yes', expected: true },
        { envValue: 'YES', expected: true },
        { envValue: 'false', expected: false },
        { envValue: 'FALSE', expected: false },
        { envValue: '0', expected: false },
        { envValue: 'no', expected: false },
        { envValue: 'anything-else', expected: false },
      ];

      for (const { envValue, expected } of testCases) {
        const env = {
          YELLOW_PLUGINS_TELEMETRY_ENABLED: envValue,
        };

        const provider = new ConfigProvider({ workspaceRoot: testDir, env });
        const config = provider.getConfig();

        expect(config.telemetryEnabled).toBe(expected);
      }
    });

    it('should correctly parse number environment variables', () => {
      const env = {
        YELLOW_PLUGINS_MAX_CACHE_SIZE_MB: '1500',
        YELLOW_PLUGINS_LIFECYCLE_TIMEOUT_MS: '60000',
      };

      const provider = new ConfigProvider({ workspaceRoot: testDir, env });
      const config = provider.getConfig();

      expect(config.maxCacheSizeMb).toBe(1500);
      expect(config.lifecycleTimeoutMs).toBe(60000);
    });

    it('should fall back to defaults for invalid number environment variables', () => {
      const env = {
        YELLOW_PLUGINS_MAX_CACHE_SIZE_MB: 'not-a-number',
      };

      const provider = new ConfigProvider({ workspaceRoot: testDir, env });
      const config = provider.getConfig();

      expect(config.maxCacheSizeMb).toBe(DEFAULT_CONFIG.maxCacheSizeMb);
    });
  });

  describe('Feature Flag Precedence', () => {
    it('should use default flag values when no other source is provided', () => {
      const provider = new ConfigProvider({ workspaceRoot: testDir });
      const flags = provider.getFeatureFlags();

      expect(flags.enableBrowse).toBe(DEFAULT_FEATURE_FLAGS.enableBrowse);
      expect(flags.enablePublish).toBe(DEFAULT_FEATURE_FLAGS.enablePublish);
      expect(flags.enableRollback).toBe(DEFAULT_FEATURE_FLAGS.enableRollback);
      expect(flags.enableCompatibilityChecks).toBe(DEFAULT_FEATURE_FLAGS.enableCompatibilityChecks);
    });

    it('should load flags from flags.json when present', () => {
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'flags.json'),
        JSON.stringify({
          enableBrowse: true,
          enablePublish: true,
          enableRollback: true,
        })
      );

      const provider = new ConfigProvider({ workspaceRoot: testDir });
      const flags = provider.getFeatureFlags();

      expect(flags.enableBrowse).toBe(true);
      expect(flags.enablePublish).toBe(true);
      expect(flags.enableRollback).toBe(true);
      // Values not in file should fall back to defaults
      expect(flags.enableVariants).toBe(DEFAULT_FEATURE_FLAGS.enableVariants);
    });

    it('should override file flags with environment variables', () => {
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'flags.json'),
        JSON.stringify({
          enableBrowse: false,
          enablePublish: false,
        })
      );

      const env = {
        YELLOW_PLUGINS_ENABLE_BROWSE: 'true',
        YELLOW_PLUGINS_ENABLE_PUBLISH: '1',
      };

      const provider = new ConfigProvider({ workspaceRoot: testDir, env });
      const flags = provider.getFeatureFlags();

      expect(flags.enableBrowse).toBe(true);
      expect(flags.enablePublish).toBe(true);
    });
  });

  describe('Metadata Tracking', () => {
    it('should track source metadata for config values', () => {
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'config.json'),
        JSON.stringify({
          pluginDir: 'file-value',
        })
      );

      const env = {
        YELLOW_PLUGINS_MAX_CACHE_SIZE_MB: '1000',
      };

      const cliFlags = {
        telemetryEnabled: true,
      };

      const provider = new ConfigProvider({ workspaceRoot: testDir, env, cliFlags });
      provider.getConfig(); // Trigger config loading

      // Default source
      const installDirMeta = provider.getConfigMetadata('installDir');
      expect(installDirMeta.source).toBe('default');
      expect(installDirMeta.value).toBe(DEFAULT_CONFIG.installDir);

      // File source
      const pluginDirMeta = provider.getConfigMetadata('pluginDir');
      expect(pluginDirMeta.source).toBe('file');
      expect(pluginDirMeta.value).toBe('file-value');

      // Env source
      const cacheSizeMeta = provider.getConfigMetadata('maxCacheSizeMb');
      expect(cacheSizeMeta.source).toBe('env');
      expect(cacheSizeMeta.value).toBe(1000);

      // CLI source
      const telemetryMeta = provider.getConfigMetadata('telemetryEnabled');
      expect(telemetryMeta.source).toBe('cli');
      expect(telemetryMeta.value).toBe(true);
    });

    it('should track source metadata for feature flags', () => {
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'flags.json'),
        JSON.stringify({
          enableBrowse: true,
        })
      );

      const env = {
        YELLOW_PLUGINS_ENABLE_PUBLISH: 'true',
      };

      const provider = new ConfigProvider({ workspaceRoot: testDir, env });
      provider.getFeatureFlags(); // Trigger flag loading

      // Default source
      const rollbackMeta = provider.getFlagMetadata('enableRollback');
      expect(rollbackMeta.source).toBe('default');

      // File source
      const browseMeta = provider.getFlagMetadata('enableBrowse');
      expect(browseMeta.source).toBe('file');
      expect(browseMeta.value).toBe(true);

      // Env source
      const publishMeta = provider.getFlagMetadata('enablePublish');
      expect(publishMeta.source).toBe('env');
      expect(publishMeta.value).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing .claude-plugin directory gracefully', () => {
      const provider = new ConfigProvider({ workspaceRoot: testDir });
      const config = provider.getConfig();
      const flags = provider.getFeatureFlags();

      expect(config).toBeDefined();
      expect(flags).toBeDefined();
    });

    it('should handle malformed config.json gracefully', () => {
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'config.json'), 'invalid json{');

      const provider = new ConfigProvider({ workspaceRoot: testDir });
      const config = provider.getConfig();

      // Should fall back to defaults
      expect(config.pluginDir).toBe(DEFAULT_CONFIG.pluginDir);
    });

    it('should handle malformed flags.json gracefully', () => {
      const pluginDir = join(testDir, '.claude-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'flags.json'), 'invalid json{');

      const provider = new ConfigProvider({ workspaceRoot: testDir });
      const flags = provider.getFeatureFlags();

      // Should fall back to defaults
      expect(flags.enableBrowse).toBe(DEFAULT_FEATURE_FLAGS.enableBrowse);
    });
  });

  describe('Caching', () => {
    it('should cache config values after first access', () => {
      const provider = new ConfigProvider({ workspaceRoot: testDir });

      const config1 = provider.getConfig();
      const config2 = provider.getConfig();

      expect(config1).toBe(config2); // Same object reference
    });

    it('should cache flag values after first access', () => {
      const provider = new ConfigProvider({ workspaceRoot: testDir });

      const flags1 = provider.getFeatureFlags();
      const flags2 = provider.getFeatureFlags();

      expect(flags1).toBe(flags2); // Same object reference
    });
  });

  describe('Global Provider', () => {
    it('should reuse the global provider instance', async () => {
      const { getConfigProvider } = await import('./configProvider.js');

      const provider1 = getConfigProvider();
      const provider2 = getConfigProvider();

      expect(provider1).toBe(provider2);
    });

    it('should reset the global provider when requested', async () => {
      const { getConfigProvider, resetConfigProvider: reset } = await import('./configProvider.js');

      const provider1 = getConfigProvider();
      reset();
      const provider2 = getConfigProvider();

      expect(provider1).not.toBe(provider2);
    });
  });
});
