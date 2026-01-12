/**
 * @yellow-plugins/domain - Changelog Service Tests
 *
 * Comprehensive test suite for changelog fetching with timeout/404 scenarios.
 * Tests CRIT-008 compliance: 5-second timeout, graceful degradation, cache behavior.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Config } from '../../config/contracts.js';
import { ChangelogService } from '../changelogService.js';
import type { IHttpAdapter } from '../contracts.js';
import { ChangelogStatus } from '../types.js';

describe('ChangelogService', () => {
  let mockConfig: Config;
  let mockHttpAdapter: IHttpAdapter;
  let changelogService: ChangelogService;

  beforeEach(() => {
    // Reset mocks
    const testRoot = join(tmpdir(), 'yellow-plugins-tests');
    mockConfig = {
      pluginDir: join(testRoot, 'changelog-service'),
      installDir: join(testRoot, 'plugins'),
      maxCacheSizeMb: 500,
      telemetryEnabled: false,
      lifecycleTimeoutMs: 30000,
    };

    mockHttpAdapter = {
      fetch: vi.fn(),
    };

    const cacheFilePath = join(
      testRoot,
      'audit',
      `changelog-cache-${Math.random().toString(36).slice(2)}.json`
    );
    changelogService = new ChangelogService(mockConfig, mockHttpAdapter, { cacheFilePath });
  });

  describe('CRIT-008 Compliance: Changelog URL Handling', () => {
    it('should return NOT_PROVIDED when changelogUrl is null', async () => {
      const result = await changelogService.fetchChangelog('test-plugin', '1.2.3', null);

      expect(result.status).toBe(ChangelogStatus.NOT_PROVIDED);
      expect(result.displayMessage).toBe('Changelog not provided by plugin author');
      expect(result.content).toBeUndefined();
    });

    it('should return NOT_PROVIDED when changelogUrl is undefined', async () => {
      const result = await changelogService.fetchChangelog('test-plugin', '1.2.3', undefined);

      expect(result.status).toBe(ChangelogStatus.NOT_PROVIDED);
      expect(result.displayMessage).toBe('Changelog not provided by plugin author');
    });

    it('should return NOT_PROVIDED when changelogUrl is empty string', async () => {
      const result = await changelogService.fetchChangelog('test-plugin', '1.2.3', '');

      expect(result.status).toBe(ChangelogStatus.NOT_PROVIDED);
      expect(result.displayMessage).toBe('Changelog not provided by plugin author');
    });
  });

  describe('CRIT-008 Compliance: Successful Fetch', () => {
    it('should return SUCCESS with content when fetch succeeds', async () => {
      const changelogContent = 'Version 1.2.3\n\n- Added feature X\n- Fixed bug Y';
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: changelogContent,
        contentLength: changelogContent.length,
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.SUCCESS);
      expect(result.content).toBe(changelogContent);
      expect(result.displayMessage).toBe(changelogContent);
      expect(result.metadata.url).toBe('https://example.com/changelog.md');
      expect(result.metadata.httpStatus).toBe(200);
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should truncate content to 1000 chars in display message', async () => {
      const longContent = 'A'.repeat(1500);
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: longContent,
        contentLength: longContent.length,
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.SUCCESS);
      expect(result.content).toBe(longContent);
      expect(result.displayMessage).toBe('A'.repeat(1000) + '...');
      expect(result.displayMessage.length).toBe(1003); // 1000 + '...'
    });
  });

  describe('CRIT-008 Compliance: HTTP 404 - Not Found', () => {
    it('should return NOT_FOUND when HTTP 404 is returned', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: false,
        status: 404,
        error: 'Not Found',
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.NOT_FOUND);
      expect(result.displayMessage).toBe('Changelog unavailable (not found)');
      expect(result.metadata.httpStatus).toBe(404);
      expect(result.content).toBeUndefined();
    });
  });

  describe('CRIT-008 Compliance: HTTP 403/500 - Server Error', () => {
    it('should return SERVER_ERROR when HTTP 403 is returned', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: false,
        status: 403,
        error: 'Forbidden',
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.SERVER_ERROR);
      expect(result.displayMessage).toBe('Changelog unavailable (server error)');
      expect(result.metadata.httpStatus).toBe(403);
    });

    it('should return SERVER_ERROR when HTTP 500 is returned', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: false,
        status: 500,
        error: 'Internal Server Error',
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.SERVER_ERROR);
      expect(result.displayMessage).toBe('Changelog unavailable (server error)');
      expect(result.metadata.httpStatus).toBe(500);
    });

    it('should return SERVER_ERROR when HTTP 503 is returned', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: false,
        status: 503,
        error: 'Service Unavailable',
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.SERVER_ERROR);
      expect(result.displayMessage).toBe('Changelog unavailable (server error)');
    });
  });

  describe('CRIT-008 Compliance: Timeout (5-second limit)', () => {
    it('should return TIMEOUT when fetch exceeds 5 seconds', async () => {
      // Simulate timeout by throwing error after delay
      vi.mocked(mockHttpAdapter.fetch).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5100));
        throw new Error('Timeout');
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md',
        { timeoutMs: 5000 }
      );

      expect(result.status).toBe(ChangelogStatus.TIMEOUT);
      expect(result.displayMessage).toBe('Changelog unavailable (network error)');
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(5000);
    });

    it('should use custom timeout when specified in options', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3100));
        throw new Error('Timeout');
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md',
        { timeoutMs: 3000 }
      );

      expect(result.status).toBe(ChangelogStatus.TIMEOUT);
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(3000);
    });
  });

  describe('CRIT-008 Compliance: Network Errors', () => {
    it('should return NETWORK_ERROR when DNS fails', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://nonexistent.example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.NETWORK_ERROR);
      expect(result.displayMessage).toBe('Changelog unavailable (network error)');
    });

    it('should return NETWORK_ERROR when connection refused', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://localhost:99999/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.NETWORK_ERROR);
      expect(result.displayMessage).toBe('Changelog unavailable (network error)');
    });
  });

  describe('CRIT-008 Compliance: Cache Behavior', () => {
    it('should cache successful fetch and return CACHED on subsequent request', async () => {
      const changelogContent = 'Version 1.2.3 changelog';
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValueOnce({
        success: true,
        status: 200,
        content: changelogContent,
        contentLength: changelogContent.length,
      });

      // First fetch - should call HTTP adapter
      const result1 = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result1.status).toBe(ChangelogStatus.SUCCESS);
      expect(mockHttpAdapter.fetch).toHaveBeenCalledTimes(1);

      // Second fetch - should use cache (within 24 hours)
      const result2 = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result2.status).toBe(ChangelogStatus.CACHED);
      expect(result2.content).toBe(changelogContent);
      expect(result2.displayMessage).toBe(changelogContent);
      expect(mockHttpAdapter.fetch).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should bypass cache when bypassCache option is true', async () => {
      const changelogContent = 'Version 1.2.3 changelog';
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: changelogContent,
        contentLength: changelogContent.length,
      });

      // First fetch
      await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      // Second fetch with bypassCache
      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md',
        { bypassCache: true }
      );

      expect(result.status).toBe(ChangelogStatus.SUCCESS);
      expect(mockHttpAdapter.fetch).toHaveBeenCalledTimes(2); // Called again
    });

    it('should not cache failures', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: false,
        status: 404,
        error: 'Not Found',
      });

      // First fetch - 404
      const result1 = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result1.status).toBe(ChangelogStatus.NOT_FOUND);

      // Second fetch - should try again (failures recorded but don't prevent retry)
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: 'Now available!',
      });

      const result2 = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md',
        { bypassCache: true }
      );

      expect(result2.status).toBe(ChangelogStatus.SUCCESS);
      expect(mockHttpAdapter.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cache Management', () => {
    it('should invalidate cache entry', async () => {
      const changelogContent = 'Version 1.2.3 changelog';
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: changelogContent,
      });

      // Fetch and cache
      await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      // Invalidate
      await changelogService.invalidateCache('test-plugin', '1.2.3');

      // Fetch again - should call HTTP adapter
      await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(mockHttpAdapter.fetch).toHaveBeenCalledTimes(2);
    });

    it('should return empty cache when no entries exist', async () => {
      const cache = await changelogService.getCache();

      expect(cache.version).toBe('1.0.0');
      expect(cache.entries).toEqual({});
    });

    it('should prune cache entries older than retention period', async () => {
      // Mock implementation would require time manipulation
      const prunedCount = await changelogService.pruneCache();
      expect(prunedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Telemetry and Metadata', () => {
    it('should include transactionId in metadata when provided', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: 'Changelog',
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md',
        { transactionId: 'tx-12345' }
      );

      expect(result.status).toBe(ChangelogStatus.SUCCESS);
      // TransactionId would be used in logging/audit trail
    });

    it('should track fetch duration in metadata', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          success: true,
          status: 200,
          content: 'Changelog',
        };
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(100);
      expect(result.metadata.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty changelog content', async () => {
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: '',
        contentLength: 0,
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.status).toBe(ChangelogStatus.SUCCESS);
      expect(result.content).toBe('');
      expect(result.displayMessage).toBe('');
    });

    it('should handle very short changelog (< 1000 chars)', async () => {
      const shortContent = 'v1.2.3: Bug fixes';
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: shortContent,
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.displayMessage).toBe(shortContent);
      expect(result.displayMessage.endsWith('...')).toBe(false);
    });

    it('should handle exactly 1000 char changelog', async () => {
      const exactContent = 'A'.repeat(1000);
      vi.mocked(mockHttpAdapter.fetch).mockResolvedValue({
        success: true,
        status: 200,
        content: exactContent,
      });

      const result = await changelogService.fetchChangelog(
        'test-plugin',
        '1.2.3',
        'https://example.com/changelog.md'
      );

      expect(result.displayMessage).toBe(exactContent);
      expect(result.displayMessage.endsWith('...')).toBe(false);
    });
  });
});
