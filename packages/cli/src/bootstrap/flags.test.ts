/**
 * @yellow-plugins/cli - Bootstrap Flags Tests
 *
 * Unit tests for preflight banner generation and flag display.
 *
 * Part of Task I1.T2: Configuration and feature-flag system
 */

import { DEFAULT_CONFIG, DEFAULT_FEATURE_FLAGS } from '@yellow-plugins/domain';
import type { Config, FeatureFlags, IConfigProvider } from '@yellow-plugins/domain';
import { describe, it, expect } from 'vitest';

import {
  getPreflightBanner,
  getDebugBanner,
  formatConfigSource,
} from './flags.js';

describe('Bootstrap Flags', () => {
  describe('getPreflightBanner', () => {
    it('should generate a banner with default config and flags', () => {
      const banner = getPreflightBanner(DEFAULT_FEATURE_FLAGS, DEFAULT_CONFIG);

      expect(banner).toContain('Yellow Plugins CLI v1.1.0');
      expect(banner).toContain('Plugin marketplace for Claude Code');
      expect(banner).toContain('Configuration:');
      expect(banner).toContain('Feature Flags:');
    });

    it('should display config values correctly', () => {
      const config: Config = {
        pluginDir: 'custom-dir',
        installDir: 'custom-install',
        maxCacheSizeMb: 1000,
        telemetryEnabled: true,
        lifecycleTimeoutMs: 60000,
      };

      const banner = getPreflightBanner(DEFAULT_FEATURE_FLAGS, config);
      const text = banner.join('\n');

      expect(text).toContain('Plugin directory: custom-dir');
      expect(text).toContain('Install directory: custom-install');
      expect(text).toContain('Max cache size: 1000 MB');
      expect(text).toContain('Telemetry: enabled');
    });

    it('should show disabled flags with ✗ marker', () => {
      const flags: FeatureFlags = {
        ...DEFAULT_FEATURE_FLAGS,
        enableBrowse: false,
        enablePublish: false,
      };

      const banner = getPreflightBanner(flags, DEFAULT_CONFIG);
      const text = banner.join('\n');

      expect(text).toContain('✗ Browse marketplace: disabled');
      expect(text).toContain('✗ Publish plugins: disabled');
    });

    it('should show enabled flags with ✓ marker', () => {
      const flags: FeatureFlags = {
        ...DEFAULT_FEATURE_FLAGS,
        enableBrowse: true,
        enablePublish: true,
      };

      const banner = getPreflightBanner(flags, DEFAULT_CONFIG);
      const text = banner.join('\n');

      expect(text).toContain('✓ Browse marketplace: enabled');
      expect(text).toContain('✓ Publish plugins: enabled');
    });

    it('should include all feature flags in output', () => {
      const banner = getPreflightBanner(DEFAULT_FEATURE_FLAGS, DEFAULT_CONFIG);
      const text = banner.join('\n');

      expect(text).toContain('Browse marketplace');
      expect(text).toContain('Publish plugins');
      expect(text).toContain('Rollback versions');
      expect(text).toContain('Variant switching');
      expect(text).toContain('Lifecycle hooks');
      expect(text).toContain('Compatibility checks');
      expect(text).toContain('CI validation');
    });

    it('should use custom version when provided', () => {
      const banner = getPreflightBanner(DEFAULT_FEATURE_FLAGS, DEFAULT_CONFIG, '2.0.0');

      expect(banner[0]).toBe('Yellow Plugins CLI v2.0.0');
    });
  });

  describe('formatConfigSource', () => {
    it('should format CLI source correctly', () => {
      expect(formatConfigSource('cli')).toBe('[CLI]');
    });

    it('should format ENV source correctly', () => {
      expect(formatConfigSource('env')).toBe('[ENV]');
    });

    it('should format FILE source correctly', () => {
      expect(formatConfigSource('file')).toBe('[FILE]');
    });

    it('should format DEFAULT source correctly', () => {
      expect(formatConfigSource('default')).toBe('[DEFAULT]');
    });
  });

  describe('getDebugBanner', () => {
    it('should include source metadata for all config values', () => {
      const mockProvider: Pick<IConfigProvider, 'getConfigMetadata' | 'getFlagMetadata'> = {
        getConfigMetadata: (key) => ({ value: DEFAULT_CONFIG[key], source: 'default' }),
        getFlagMetadata: (key) => ({ value: DEFAULT_FEATURE_FLAGS[key], source: 'default' }),
      };

      const banner = getDebugBanner(
        DEFAULT_FEATURE_FLAGS,
        DEFAULT_CONFIG,
        mockProvider,
        '1.1.0'
      );
      const text = banner.join('\n');

      expect(text).toContain('DEBUG MODE');
      expect(text).toContain('pluginDir: .claude-plugin [DEFAULT]');
      expect(text).toContain('installDir: .claude/plugins [DEFAULT]');
      expect(text).toContain('maxCacheSizeMb: 500 [DEFAULT]');
      expect(text).toContain('telemetryEnabled: false [DEFAULT]');
      expect(text).toContain('lifecycleTimeoutMs: 30000 [DEFAULT]');
    });

    it('should include source metadata for all flags', () => {
      const mockProvider: Pick<IConfigProvider, 'getConfigMetadata' | 'getFlagMetadata'> = {
        getConfigMetadata: (key) => ({ value: DEFAULT_CONFIG[key], source: 'default' }),
        getFlagMetadata: (key) => ({ value: DEFAULT_FEATURE_FLAGS[key], source: 'file' }),
      };

      const banner = getDebugBanner(
        DEFAULT_FEATURE_FLAGS,
        DEFAULT_CONFIG,
        mockProvider,
        '1.1.0'
      );
      const text = banner.join('\n');

      expect(text).toContain('enableBrowse: false [FILE]');
      expect(text).toContain('enablePublish: false [FILE]');
      expect(text).toContain('enableRollback: false [FILE]');
      expect(text).toContain('enableVariants: false [FILE]');
      expect(text).toContain('enableLifecycleHooks: false [FILE]');
      expect(text).toContain('enableCompatibilityChecks: true [FILE]');
      expect(text).toContain('enableCiValidation: false [FILE]');
    });

    it('should show mixed sources correctly', () => {
      const mockProvider: Pick<IConfigProvider, 'getConfigMetadata' | 'getFlagMetadata'> = {
        getConfigMetadata: (key) => {
          const sources: Record<string, 'cli' | 'env' | 'file' | 'default'> = {
            pluginDir: 'cli',
            installDir: 'env',
            maxCacheSizeMb: 'file',
            telemetryEnabled: 'default',
            lifecycleTimeoutMs: 'default',
          };
          return { value: DEFAULT_CONFIG[key], source: sources[key] ?? 'default' };
        },
        getFlagMetadata: (key) => ({ value: DEFAULT_FEATURE_FLAGS[key], source: 'default' }),
      };

      const banner = getDebugBanner(
        DEFAULT_FEATURE_FLAGS,
        DEFAULT_CONFIG,
        mockProvider,
        '1.1.0'
      );
      const text = banner.join('\n');

      expect(text).toContain('[CLI]');
      expect(text).toContain('[ENV]');
      expect(text).toContain('[FILE]');
      expect(text).toContain('[DEFAULT]');
    });
  });
});
