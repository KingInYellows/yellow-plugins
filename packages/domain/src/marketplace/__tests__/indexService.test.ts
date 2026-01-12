/**
 * @yellow-plugins/domain - Marketplace Index Service Tests
 *
 * Tests for marketplace discovery operations including:
 * - Index loading and validation
 * - Freshness detection and stale warnings
 * - Signature/hash verification
 * - Deterministic sorting (category → name → version)
 * - Browse, search, and info queries
 *
 * Part of Task I3.T1: Marketplace ingestion & caching implementation.
 *
 * @specification FR-001, FR-002, Section 1.4 (Key Assumptions)
 */

import * as fs from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationStatus } from '../../validation/index.js';
import type { DomainValidationResult, IValidator } from '../../validation/index.js';
import { MarketplaceIndexService } from '../indexService.js';
import type { MarketplaceIndex } from '../types.js';

// Mock filesystem
vi.mock('node:fs/promises');

// Mock validator
const createMockValidator = (isValid: boolean = true): IValidator => {
  const result: DomainValidationResult = {
    status: isValid ? ValidationStatus.SUCCESS : ValidationStatus.ERROR,
    errors: isValid ? [] : [{
      code: 'ERR-VAL-001',
      message: 'Invalid schema',
      path: 'root',
      severity: 'ERROR' as const,
      category: 'VALIDATION' as const,
    }],
    warnings: [],
    entityName: 'marketplace',
    validatedAt: new Date(),
  };

  return {
    validateMarketplace: vi.fn(() => result),
    validatePluginManifest: vi.fn(() => result),
    validateCompatibility: vi.fn(() => result),
  };
};

// Sample marketplace index
const createSampleIndex = (): MarketplaceIndex => ({
  schemaVersion: '1.0.0',
  marketplace: {
    name: 'Test Marketplace',
    author: 'test',
    updatedAt: '2026-01-12T10:00:00Z',
  },
  plugins: [
    {
      id: 'plugin-a',
      name: 'Plugin A',
      version: '2.0.0',
      category: 'development',
      source: 'plugins/plugin-a',
      tags: ['tag1', 'tag2'],
      featured: true,
      verified: true,
      description: 'First plugin for testing',
    },
    {
      id: 'plugin-b',
      name: 'Plugin B',
      version: '1.5.0',
      category: 'development',
      source: 'plugins/plugin-b',
      tags: ['tag2', 'tag3'],
      featured: false,
      verified: true,
      description: 'Second plugin for testing',
    },
    {
      id: 'plugin-c',
      name: 'Plugin C',
      version: '1.0.0',
      category: 'productivity',
      source: 'plugins/plugin-c',
      tags: ['tag1'],
      featured: true,
      verified: false,
      description: 'Third plugin for testing',
    },
    {
      id: 'plugin-d',
      name: 'Another Plugin',
      version: '3.0.0',
      category: 'development',
      source: 'plugins/plugin-d',
      description: 'Fourth plugin for testing',
    },
  ],
});

describe('MarketplaceIndexService', () => {
  let service: MarketplaceIndexService;
  let mockValidator: IValidator;
  let mockLogger: { debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidator = createMockValidator(true);
    mockLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };
    service = new MarketplaceIndexService(mockValidator, mockLogger, 24 * 60 * 60 * 1000);
  });

  describe('loadIndex', () => {
    it('should load and validate marketplace index', async () => {
      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now() - 1000, mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      const result = await service.loadIndex('/test/marketplace.json');

      expect(result).toEqual(index);
      expect(mockValidator.validateMarketplace).toHaveBeenCalledWith(index);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Marketplace index loaded successfully',
        expect.objectContaining({ pluginCount: 4 })
      );
    });

    it('should throw error if file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: file not found'));

      await expect(service.loadIndex('/test/marketplace.json')).rejects.toThrow(
        'Failed to read marketplace index'
      );
    });

    it('should throw error if JSON is malformed', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('invalid json{');

      await expect(service.loadIndex('/test/marketplace.json')).rejects.toThrow(
        'Failed to parse marketplace index'
      );
    });

    it('should throw error if schema validation fails', async () => {
      const index = createSampleIndex();
      const invalidValidator = createMockValidator(false);
      service = new MarketplaceIndexService(invalidValidator, mockLogger);

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));

      await expect(service.loadIndex('/test/marketplace.json')).rejects.toThrow(
        'Marketplace index validation failed'
      );
    });

    it('should warn if index is stale', async () => {
      const index = createSampleIndex();
      const staleTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      const mockStat = { mtimeMs: staleTime, mtime: new Date(staleTime) };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Marketplace index is stale',
        expect.objectContaining({ ageMs: expect.any(Number) })
      );
    });

    it('should verify content hash if present', async () => {
      const index = createSampleIndex();
      // Add invalid hash
      index._meta = {
        contentHash: 'invalid-hash',
      };

      const mockStat = { mtimeMs: Date.now() - 1000, mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Marketplace index content hash mismatch',
        expect.any(Object)
      );
    });

    it('should warn if signature mismatch detected', async () => {
      const index = createSampleIndex();
      index._meta = {
        signature: 'invalid-signature',
      };

      const mockStat = { mtimeMs: Date.now() - 1000, mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Marketplace index signature mismatch',
        expect.any(Object)
      );
    });

    it('should cache loaded index', async () => {
      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now() - 1000, mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');
      await service.loadIndex('/test/marketplace.json'); // Second call

      // Should only read file once
      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Using cached marketplace index',
        expect.any(Object)
      );
    });
  });

  describe('checkFreshness', () => {
    it('should return exists=false if file missing', async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

      const status = await service.checkFreshness('/test/marketplace.json');

      expect(status.exists).toBe(false);
      expect(status.valid).toBe(false);
      expect(status.stale).toBe(false);
    });

    it('should detect stale index', async () => {
      const index = createSampleIndex();
      const staleTime = Date.now() - (25 * 60 * 60 * 1000);
      const mockStat = { mtimeMs: staleTime, mtime: new Date(staleTime) };

      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));

      const status = await service.checkFreshness('/test/marketplace.json');

      expect(status.exists).toBe(true);
      expect(status.stale).toBe(true);
      expect(status.ageMs).toBeGreaterThan(24 * 60 * 60 * 1000);
    });

    it('should detect invalid schema', async () => {
      const invalidValidator = createMockValidator(false);
      service = new MarketplaceIndexService(invalidValidator, mockLogger);

      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));

      const status = await service.checkFreshness('/test/marketplace.json');

      expect(status.exists).toBe(true);
      expect(status.valid).toBe(false);
      expect(status.validationErrors).toBeDefined();
    });

    it('should check integrity status', async () => {
      const index = createSampleIndex();
      index._meta = { contentHash: 'invalid-hash' };

      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));

      const status = await service.checkFreshness('/test/marketplace.json');

      expect(status.integrityStatus).toBe('invalid');
    });

    it('should detect signature mismatch status', async () => {
      const index = createSampleIndex();
      index._meta = { signature: 'invalid-signature' };

      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));

      const status = await service.checkFreshness('/test/marketplace.json');

      expect(status.signatureStatus).toBe('invalid');
    });
  });

  describe('browse', () => {
    beforeEach(async () => {
      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');
    });

    it('should return all plugins with default query', async () => {
      const result = await service.browse({});

      expect(result.totalCount).toBe(4);
      expect(result.plugins).toHaveLength(4);
    });

    it('should filter by category', async () => {
      const result = await service.browse({ category: 'development' });

      expect(result.totalCount).toBe(3);
      expect(result.plugins.every(p => p.category === 'development')).toBe(true);
    });

    it('should filter by tag', async () => {
      const result = await service.browse({ tag: 'tag1' });

      expect(result.totalCount).toBe(2);
      expect(result.plugins.every(p => p.tags?.includes('tag1'))).toBe(true);
    });

    it('should filter by featured', async () => {
      const result = await service.browse({ featured: true });

      expect(result.totalCount).toBe(2);
      expect(result.plugins.every(p => p.featured === true)).toBe(true);
    });

    it('should filter by verified', async () => {
      const result = await service.browse({ verified: true });

      expect(result.totalCount).toBe(2);
      expect(result.plugins.every(p => p.verified === true)).toBe(true);
    });

    it('should apply deterministic sorting (category → name → version)', async () => {
      const result = await service.browse({});

      // Should be sorted: development (3 plugins), productivity (1 plugin)
      expect(result.plugins[0].category).toBe('development');
      expect(result.plugins[3].category).toBe('productivity');

      // Within development category, should be sorted by name then version
      const devPlugins = result.plugins.filter(p => p.category === 'development');
      expect(devPlugins[0].name).toBe('Another Plugin'); // 'A' comes first
      expect(devPlugins[1].name).toBe('Plugin A');
      expect(devPlugins[2].name).toBe('Plugin B');

      // Plugin A should have higher version (2.0.0) before Plugin B (1.5.0)
    });

    it('should apply pagination with limit', async () => {
      const result = await service.browse({ limit: 2 });

      expect(result.totalCount).toBe(4);
      expect(result.plugins).toHaveLength(2);
    });

    it('should apply pagination with offset', async () => {
      const result = await service.browse({ limit: 2, offset: 2 });

      expect(result.totalCount).toBe(4);
      expect(result.plugins).toHaveLength(2);
      // Should skip first 2 plugins
    });

    it('should throw error if index not loaded', async () => {
      const newService = new MarketplaceIndexService(mockValidator, mockLogger);

      await expect(newService.browse({})).rejects.toThrow('Marketplace index not loaded');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');
    });

    it('should throw error if query is empty', async () => {
      await expect(service.search({ query: '' })).rejects.toThrow('Search query is required');
    });

    it('should perform fuzzy search by default', async () => {
      const result = await service.search({ query: 'plugin' });

      // Should match "Plugin A", "Plugin B", "Plugin C", "Another Plugin"
      expect(result.totalCount).toBe(4);
    });

    it('should search in id field', async () => {
      const result = await service.search({ query: 'plugin-a' });

      expect(result.totalCount).toBe(1);
      expect(result.plugins[0].id).toBe('plugin-a');
    });

    it('should search in description field', async () => {
      const result = await service.search({ query: 'first' });

      expect(result.totalCount).toBe(1);
      expect(result.plugins[0].description).toContain('First');
    });

    it('should search in tags', async () => {
      const result = await service.search({ query: 'tag2' });

      expect(result.totalCount).toBe(2);
    });

    it('should perform exact search when exact=true', async () => {
      const result = await service.search({ query: 'plugin-a', exact: true });

      expect(result.totalCount).toBe(1);
      expect(result.plugins[0].id).toBe('plugin-a');
    });

    it('should combine search with category filter', async () => {
      const result = await service.search({
        query: 'plugin',
        category: 'development',
      });

      expect(result.plugins.every(p => p.category === 'development')).toBe(true);
    });

    it('should combine search with tag filter', async () => {
      const result = await service.search({
        query: 'plugin',
        tag: 'tag1',
      });

      expect(result.plugins.every(p => p.tags?.includes('tag1'))).toBe(true);
    });

    it('should apply deterministic sorting to results', async () => {
      const result = await service.search({ query: 'plugin' });

      // Results should be sorted by category → name → version
      const categories = result.plugins.map(p => p.category);
      expect(categories[0]).toBe('development');
      expect(categories[categories.length - 1]).toBe('productivity');
    });

    it('should apply pagination', async () => {
      const result = await service.search({ query: 'plugin', limit: 2 });

      expect(result.totalCount).toBe(4);
      expect(result.plugins).toHaveLength(2);
    });
  });

  describe('getPluginInfo', () => {
    beforeEach(async () => {
      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');
    });

    it('should return plugin by id', async () => {
      const plugin = await service.getPluginInfo('plugin-a');

      expect(plugin).toBeDefined();
      expect(plugin?.id).toBe('plugin-a');
      expect(plugin?.name).toBe('Plugin A');
    });

    it('should return null if plugin not found', async () => {
      const plugin = await service.getPluginInfo('nonexistent');

      expect(plugin).toBeNull();
    });

    it('should throw error if index not loaded', async () => {
      const newService = new MarketplaceIndexService(mockValidator, mockLogger);

      await expect(newService.getPluginInfo('plugin-a')).rejects.toThrow(
        'Marketplace index not loaded'
      );
    });
  });

  describe('getByCategory', () => {
    beforeEach(async () => {
      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');
    });

    it('should return plugins in category', async () => {
      const plugins = await service.getByCategory('development');

      expect(plugins).toHaveLength(3);
      expect(plugins.every(p => p.category === 'development')).toBe(true);
    });

    it('should return empty array if no matches', async () => {
      const plugins = await service.getByCategory('nonexistent');

      expect(plugins).toHaveLength(0);
    });

    it('should apply deterministic sorting', async () => {
      const plugins = await service.getByCategory('development');

      // Within same category, sort by name
      expect(plugins[0].name).toBe('Another Plugin');
      expect(plugins[1].name).toBe('Plugin A');
      expect(plugins[2].name).toBe('Plugin B');
    });
  });

  describe('getByTag', () => {
    beforeEach(async () => {
      const index = createSampleIndex();
      const mockStat = { mtimeMs: Date.now(), mtime: new Date() };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(index));
      vi.mocked(fs.stat).mockResolvedValue(mockStat as any);

      await service.loadIndex('/test/marketplace.json');
    });

    it('should return plugins with tag', async () => {
      const plugins = await service.getByTag('tag1');

      expect(plugins).toHaveLength(2);
      expect(plugins.every(p => p.tags?.includes('tag1'))).toBe(true);
    });

    it('should return empty array if no matches', async () => {
      const plugins = await service.getByTag('nonexistent');

      expect(plugins).toHaveLength(0);
    });

    it('should apply deterministic sorting', async () => {
      const plugins = await service.getByTag('tag2');

      // Should sort by category → name
      expect(plugins[0].category).toBe('development');
    });
  });
});
