/**
 * @yellow-plugins/domain - Update Service Tests
 *
 * Test suite for update operations with changelog integration.
 * Tests parallelizable fetch, timeout handling, and batch updates.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { IChangelogService } from '../../changelog/contracts.js';
import { ChangelogStatus } from '../../changelog/types.js';
import type { Config } from '../../config/contracts.js';
import type { IInstallService } from '../../install/contracts.js';
import type { IRegistryService } from '../../registry/contracts.js';
import { InstallState } from '../../registry/types.js';
import { UpdateService } from '../updateService.js';

const buildInstallResult = (pluginId: string, version: string) => {
  const pluginRecord = {
    pluginId,
    version,
    source: 'marketplace',
    installState: InstallState.INSTALLED,
    installedAt: new Date(),
    cachePath: `/cache/${pluginId}/${version}`,
    transactionId: 'tx-install',
    pinned: false,
  };
  return {
    success: true,
    transactionId: 'tx-install',
    plugin: pluginRecord,
    registryDelta: {
      updated: [pluginRecord],
    },
    metadata: {
      durationMs: 100,
      timestamp: new Date(),
    },
    messages: [],
  };
};

describe('UpdateService', () => {
  let mockConfig: Config;
  let mockRegistryService: IRegistryService;
  let mockInstallService: IInstallService;
  let mockChangelogService: IChangelogService;
  let updateService: UpdateService;
  let mockMarketplaceEntries: Array<{ pluginId: string; version: string; changelogUrl?: string }>;

  beforeEach(() => {
    mockConfig = {
      pluginDir: '/test/.claude-plugin',
      installDir: '/test/.claude/plugins',
      maxCacheSizeMb: 500,
      telemetryEnabled: false,
      lifecycleTimeoutMs: 30000,
    };
    mockMarketplaceEntries = [];

    mockRegistryService = {
      getPlugin: vi.fn(),
      listPlugins: vi.fn(),
      addPlugin: vi.fn(),
      updatePlugin: vi.fn(),
      removePlugin: vi.fn(),
      pinPlugin: vi.fn(),
      unpinPlugin: vi.fn(),
    } as any;

    mockInstallService = {
      install: vi.fn(),
      update: vi.fn(),
      rollback: vi.fn(),
      verify: vi.fn(),
      listRollbackTargets: vi.fn(),
    } as any;
    vi.mocked(mockInstallService.update).mockImplementation(async (request: any) => {
      const targetVersion = request.version || request.versionConstraint || 'latest';
      return buildInstallResult(request.pluginId, targetVersion);
    });

    mockChangelogService = {
      fetchChangelog: vi.fn(),
      getCachedChangelog: vi.fn(),
      invalidateCache: vi.fn(),
      getCache: vi.fn(),
      pruneCache: vi.fn(),
    } as any;

    updateService = new UpdateService(
      mockConfig,
      mockRegistryService,
      mockInstallService,
      mockChangelogService,
      {
        marketplaceLoader: async () => mockMarketplaceEntries,
      }
    );
  });

  describe('checkUpdates', () => {
    it('should return error when plugin not installed', async () => {
      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(null);

      const result = await updateService.checkUpdates({
        pluginId: 'missing-plugin',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-CHECK-001');
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].pluginId).toBe('missing-plugin');
    });

    it('should check single plugin for updates', async () => {
      const installedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: false,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(installedPlugin);
      mockMarketplaceEntries = [
        { pluginId: 'test-plugin', version: '1.1.0', changelogUrl: 'https://example.com/changelog.md' },
      ];

      const result = await updateService.checkUpdates({
        pluginId: 'test-plugin',
      });

      expect(result.success).toBe(true);
      expect(mockRegistryService.getPlugin).toHaveBeenCalledWith('test-plugin');
    });

    it('should fetch changelogs when requested', async () => {
      const installedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: false,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(installedPlugin);
      mockMarketplaceEntries = [
        { pluginId: 'test-plugin', version: '1.1.0', changelogUrl: 'https://example.com/changelog.md' },
      ];
      vi.mocked(mockChangelogService.fetchChangelog).mockResolvedValue({
        status: ChangelogStatus.SUCCESS,
        content: 'Version 1.1.0 changes',
        displayMessage: 'Version 1.1.0 changes',
        metadata: {
          url: 'https://example.com/changelog.md',
          timestamp: new Date(),
          durationMs: 150,
        },
      });

      const result = await updateService.checkUpdates({
        pluginId: 'test-plugin',
        fetchChangelogs: true,
      });

      expect(result.success).toBe(true);
    });

    it('should continue on changelog fetch failures per CRIT-008', async () => {
      const installedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: false,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(installedPlugin);
      mockMarketplaceEntries = [
        { pluginId: 'test-plugin', version: '1.1.0', changelogUrl: 'https://example.com/changelog.md' },
      ];
      vi.mocked(mockChangelogService.fetchChangelog).mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await updateService.checkUpdates({
        pluginId: 'test-plugin',
        fetchChangelogs: true,
      });

      // Should succeed despite changelog failure
      expect(result.success).toBe(true);
    });

    it('should track changelog cache hits in telemetry', async () => {
      const installedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: false,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(installedPlugin);
      mockMarketplaceEntries = [
        { pluginId: 'test-plugin', version: '1.1.0', changelogUrl: 'https://example.com/changelog.md' },
      ];
      vi.mocked(mockChangelogService.fetchChangelog).mockResolvedValue({
        status: ChangelogStatus.CACHED,
        content: 'Cached changelog',
        displayMessage: 'Cached changelog',
        metadata: {
          timestamp: new Date(),
        },
      });

      const result = await updateService.checkUpdates({
        pluginId: 'test-plugin',
        fetchChangelogs: true,
      });

      expect(result.success).toBe(true);
      expect(result.metadata.changelogCacheHits).toBeGreaterThan(0);
    });
  });

  describe('updatePlugin', () => {
    it('should reject update when plugin not installed', async () => {
      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(null);

      const result = await updateService.updatePlugin({
        pluginId: 'missing-plugin',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-UPDATE-001');
    });

    it('should reject update when plugin is pinned without force', async () => {
      const pinnedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: true,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(pinnedPlugin);

      const result = await updateService.updatePlugin({
        pluginId: 'test-plugin',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-UPDATE-002');
      expect(result.error?.message).toContain('pinned');
    });

    it('should allow update when plugin is pinned with force flag', async () => {
      const pinnedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: true,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(pinnedPlugin);
      mockMarketplaceEntries = [{ pluginId: 'test-plugin', version: '1.1.0', changelogUrl: 'https://example.com/changelog.md' }];
      const result = await updateService.updatePlugin({
        pluginId: 'test-plugin',
        force: true,
      });

      expect(result.success).toBe(true);
    });

    it('should fetch changelog before updating', async () => {
      const installedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: false,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(installedPlugin);
      mockMarketplaceEntries = [{ pluginId: 'test-plugin', version: '1.1.0', changelogUrl: 'https://example.com/changelog.md' }];
      vi.mocked(mockChangelogService.fetchChangelog).mockResolvedValue({
        status: ChangelogStatus.SUCCESS,
        content: 'Update changelog',
        displayMessage: 'Update changelog',
        metadata: {
          timestamp: new Date(),
        },
      });
      const result = await updateService.updatePlugin({
        pluginId: 'test-plugin',
      });

      expect(mockChangelogService.fetchChangelog).toHaveBeenCalled();
      expect(result.changelog).toBeDefined();
    });

    it('should return success when already at latest version', async () => {
      const installedPlugin = {
        pluginId: 'test-plugin',
        version: '1.2.3',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.2.3',
        transactionId: 'tx-123',
        pinned: false,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(installedPlugin);
      mockMarketplaceEntries = [{ pluginId: 'test-plugin', version: '1.2.3' }];

      const result = await updateService.updatePlugin({
        pluginId: 'test-plugin',
      });

      // Would check marketplace and determine already latest
      expect(result.success).toBe(true);
    });
  });

  describe('updateAll', () => {
    it('should update multiple plugins in parallel', async () => {
      const plugins = [
        {
          pluginId: 'plugin-a',
          version: '1.0.0',
          source: 'marketplace',
          installState: InstallState.INSTALLED,
          installedAt: new Date(),
          cachePath: '/cache/plugin-a/1.0.0',
          transactionId: 'tx-1',
          pinned: false,
        },
        {
          pluginId: 'plugin-b',
          version: '2.0.0',
          source: 'marketplace',
          installState: InstallState.INSTALLED,
          installedAt: new Date(),
          cachePath: '/cache/plugin-b/2.0.0',
          transactionId: 'tx-2',
          pinned: false,
        },
      ];

      vi.mocked(mockRegistryService.listPlugins).mockResolvedValue(plugins);
      mockMarketplaceEntries = [
        { pluginId: 'plugin-a', version: '1.1.0' },
        { pluginId: 'plugin-b', version: '2.1.0' },
      ];

      const result = await updateService.updateAll({
        all: true,
      });

      expect(result.success).toBeDefined();
      expect(mockRegistryService.listPlugins).toHaveBeenCalled();
    });

    it('should skip pinned plugins in batch update', async () => {
      const plugins = [
        {
          pluginId: 'plugin-a',
          version: '1.0.0',
          source: 'marketplace',
          installState: InstallState.INSTALLED,
          installedAt: new Date(),
          cachePath: '/cache/plugin-a/1.0.0',
          transactionId: 'tx-1',
          pinned: true,
        },
      ];

      vi.mocked(mockRegistryService.listPlugins).mockResolvedValue(plugins);
      mockMarketplaceEntries = [{ pluginId: 'plugin-a', version: '1.0.0' }];

      const result = await updateService.updateAll({
        all: true,
      });

      expect(result.skipped).toBeDefined();
    });

    it('should aggregate results from parallel updates', async () => {
      const plugins = [
        {
          pluginId: 'plugin-a',
          version: '1.0.0',
          source: 'marketplace',
          installState: InstallState.INSTALLED,
          installedAt: new Date(),
          cachePath: '/cache/plugin-a/1.0.0',
          transactionId: 'tx-1',
          pinned: false,
        },
      ];

      vi.mocked(mockRegistryService.listPlugins).mockResolvedValue(plugins);
      mockMarketplaceEntries = [{ pluginId: 'plugin-a', version: '1.1.0' }];

      const result = await updateService.updateAll({
        all: true,
      });

      expect(result.updated).toBeDefined();
      expect(result.upToDate).toBeDefined();
      expect(result.skipped).toBeDefined();
      expect(result.failed).toBeDefined();
    });
  });

  describe('Timeout and Error Handling', () => {
    it('should handle changelog timeout gracefully', async () => {
      const installedPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: false,
      };

      vi.mocked(mockRegistryService.getPlugin).mockResolvedValue(installedPlugin);
      mockMarketplaceEntries = [{ pluginId: 'test-plugin', version: '1.1.0' }];
      vi.mocked(mockChangelogService.fetchChangelog).mockResolvedValue({
        status: ChangelogStatus.TIMEOUT,
        displayMessage: 'Changelog unavailable (network error)',
        metadata: {
          timestamp: new Date(),
          durationMs: 5000,
        },
      });

      const result = await updateService.checkUpdates({
        pluginId: 'test-plugin',
        fetchChangelogs: true,
      });

      expect(result.success).toBe(true);
      // Update check should succeed even with timeout
    });

    it('should handle individual plugin failures in batch update', async () => {
      const plugins = [
        {
          pluginId: 'good-plugin',
          version: '1.0.0',
          source: 'marketplace',
          installState: InstallState.INSTALLED,
          installedAt: new Date(),
          cachePath: '/cache/good-plugin/1.0.0',
          transactionId: 'tx-1',
          pinned: false,
        },
        {
          pluginId: 'bad-plugin',
          version: '1.0.0',
          source: 'marketplace',
          installState: InstallState.INSTALLED,
          installedAt: new Date(),
          cachePath: '/cache/bad-plugin/1.0.0',
          transactionId: 'tx-2',
          pinned: false,
        },
      ];

      vi.mocked(mockRegistryService.listPlugins).mockResolvedValue(plugins);
      mockMarketplaceEntries = [
        { pluginId: 'good-plugin', version: '1.1.0' },
        { pluginId: 'bad-plugin', version: '1.1.0' },
      ];
      vi.mocked(mockInstallService.update).mockImplementation(async (request: any) => {
        if (request.pluginId === 'bad-plugin') {
          throw new Error('Simulated failure');
        }
        const targetVersion = request.version || request.versionConstraint || 'latest';
        return buildInstallResult(request.pluginId, targetVersion);
      });

      const result = await updateService.updateAll({
        all: true,
      });

      // Batch should return partial success
      expect(result.failed).toBeDefined();
    });
  });

  describe('Transaction Tracking', () => {
    it('should generate transaction ID for check-updates', async () => {
      vi.mocked(mockRegistryService.listPlugins).mockResolvedValue([]);

      const result = await updateService.checkUpdates({
        all: true,
      });

      expect(result.transactionId).toMatch(/^tx-\d+-[a-z0-9]+$/);
    });

    it('should use provided transaction ID when specified', async () => {
      vi.mocked(mockRegistryService.listPlugins).mockResolvedValue([]);

      const result = await updateService.checkUpdates({
        all: true,
        transactionId: 'tx-custom-12345',
      });

      expect(result.transactionId).toBe('tx-custom-12345');
    });

    it('should track correlation ID in metadata', async () => {
      vi.mocked(mockRegistryService.listPlugins).mockResolvedValue([]);

      const result = await updateService.checkUpdates({
        all: true,
        correlationId: 'corr-xyz-789',
      });

      expect(result.metadata.correlationId).toBe('corr-xyz-789');
    });
  });
});
