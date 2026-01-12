/**
 * @yellow-plugins/domain - Publish Service Tests
 *
 * Unit and integration tests for publish service functionality.
 * Tests validation, git operations, lifecycle hooks, and error scenarios.
 *
 * Part of Task I4.T1: Publish Service and CLI Command
 *
 * Test Coverage:
 * - Feature flag validation
 * - Git provenance retrieval
 * - Manifest validation (plugin and marketplace)
 * - Dry-run mode
 * - Commit and push workflows
 * - Tag creation
 * - Error handling and rollback
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config, FeatureFlags } from '../../config/contracts.js';
import { PublishService } from '../publishService.js';
import type { GitProvenance, ManifestValidationResult, PublishRequest } from '../types.js';

// Mock validator
class MockValidator {
  validatePluginManifest = vi.fn();
  validateMarketplaceIndex = vi.fn();
}

// Mock git adapter
class MockGitAdapter {
  getProvenance = vi.fn();
  hasUncommittedChanges = vi.fn();
  stage = vi.fn();
  commit = vi.fn();
  createTag = vi.fn();
  push = vi.fn();
}

describe('PublishService', () => {
  let publishService: PublishService;
  let mockConfig: Config;
  let mockFlags: FeatureFlags;
  let mockValidator: MockValidator;
  let mockGitAdapter: MockGitAdapter;
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'publish-service-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    // Setup mock config
    mockConfig = {
      pluginDir: '.claude-plugin',
      installDir: '.claude/plugins',
      maxCacheSizeMb: 500,
      telemetryEnabled: false,
      lifecycleTimeoutMs: 30000,
    };

    // Setup mock flags
    mockFlags = {
      enableBrowse: false,
      enablePublish: true,
      enableRollback: false,
      enableVariants: false,
      enableLifecycleHooks: false,
      enableCompatibilityChecks: true,
      enableCiValidation: false,
    };

    // Create mocks
    mockValidator = new MockValidator();
    mockGitAdapter = new MockGitAdapter();

    // Create service instance
    publishService = new PublishService(
      mockConfig,
      mockFlags,
      mockValidator as any,
      mockGitAdapter as any
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    cwdSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Feature Flag Validation', () => {
    it('should fail when enablePublish flag is disabled', async () => {
      // Arrange
      mockFlags.enablePublish = false;
      publishService = new PublishService(
        mockConfig,
        mockFlags,
        mockValidator as any,
        mockGitAdapter as any
      );

      const request: PublishRequest = {
        pluginId: 'test-plugin',
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-PUBLISH-001');
      expect(result.error?.message).toContain('enablePublish');
      expect(result.error?.failedStep).toBe('VALIDATE_FLAGS');
    });

    it('should proceed when enablePublish flag is enabled', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        digest: 'sha256:manifest-digest',
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockGitAdapter.getProvenance).toHaveBeenCalled();
    });
  });

  describe('Git Provenance Retrieval', () => {
    it('should retrieve git provenance successfully', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123def456',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.gitProvenance).toEqual(gitProvenance);
      expect(mockGitAdapter.getProvenance).toHaveBeenCalledWith(process.cwd());
    });

    it('should fail when git provenance retrieval fails', async () => {
      // Arrange
      mockGitAdapter.getProvenance.mockRejectedValue(new Error('Not a git repository'));

      const request: PublishRequest = {
        pluginId: 'test-plugin',
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-PUBLISH-002');
      expect(result.error?.message).toContain('git provenance');
      expect(result.error?.failedStep).toBe('CHECK_GIT_STATUS');
    });

    it('should warn when working directory is dirty', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: true,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      const warnings = result.messages.filter((m) => m.level === 'warn');
      expect(warnings.some((w) => w.message.includes('uncommitted changes'))).toBe(true);
    });
  });

  describe('Manifest Validation', () => {
    it('should validate both plugin manifest and marketplace index', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockValidator.validatePluginManifest).toHaveBeenCalledWith(
        '.claude-plugin/plugin.json'
      );
      expect(mockValidator.validateMarketplaceIndex).toHaveBeenCalledWith('marketplace.json');
    });

    it('should fail when plugin manifest validation fails', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: false,
        errors: [
          { code: 'SCHEMA-001', message: 'Missing required field: version' },
          { code: 'SCHEMA-002', message: 'Invalid semantic version format' },
        ],
        warnings: [],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-SCHEMA-001');
      expect(result.error?.message).toContain('Plugin manifest validation failed');
      expect(result.error?.failedStep).toBe('VALIDATE_MANIFEST');
    });

    it('should include warnings but not fail', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [{ code: 'SCHEMA-WARN-001', message: 'Missing optional field: homepage' }],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      const warnings = result.messages.filter((m) => m.level === 'warn');
      expect(warnings.some((w) => w.message.includes('Missing optional field'))).toBe(true);
    });
  });

  describe('Lifecycle Consent', () => {
    const gitProvenance: GitProvenance = {
      repoUrl: 'https://github.com/user/repo.git',
      commitSha: 'abc123',
      branch: 'main',
      isDirty: false,
      remoteName: 'origin',
    };

    const manifestValidation: ManifestValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    function seedLifecycleManifest(scriptRelativePath: string, scriptContents: string): void {
      const manifestDir = join(tempDir, '.claude-plugin');
      mkdirSync(manifestDir, { recursive: true });
      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      writeFileSync(
        join(manifestDir, 'plugin.json'),
        JSON.stringify({
          name: 'test-plugin',
          lifecycle: {
            prePublish: scriptRelativePath,
          },
        })
      );
      writeFileSync(join(tempDir, scriptRelativePath), scriptContents);
    }

    it('should request consent when lifecycle script is detected', async () => {
      mockFlags.enableLifecycleHooks = true;
      seedLifecycleManifest('scripts/prepublish.sh', '#!/bin/bash\necho "prepublish"\n');

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
      };

      const result = await publishService.publish(request);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-PUBLISH-CONSENT');
      expect(result.error?.details).toMatchObject({
        reason: 'consent-required',
        script: {
          path: 'scripts/prepublish.sh',
        },
      });
    });

    it('should succeed when lifecycle digest matches consent token', async () => {
      mockFlags.enableLifecycleHooks = true;
      const scriptContents = '#!/usr/bin/env bash\necho "publish"\n';
      seedLifecycleManifest('scripts/prepublish.sh', scriptContents);

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);

      const digest = createHash('sha256').update(scriptContents).digest('hex');
      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
        scriptReviewDigest: digest,
      };

      const result = await publishService.publish(request);

      expect(result.success).toBe(true);
      expect(result.gitProvenance).toEqual(gitProvenance);
      expect(result.manifestValidation?.valid).toBe(true);
    });
  });

  describe('Dry-Run Mode', () => {
    it('should stop after validation in dry-run mode', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        dryRun: true,
        push: true,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockGitAdapter.stage).not.toHaveBeenCalled();
      expect(mockGitAdapter.commit).not.toHaveBeenCalled();
      expect(mockGitAdapter.push).not.toHaveBeenCalled();
      expect(result.messages.some((m) => m.message.includes('Dry-run mode'))).toBe(true);
    });
  });

  describe('Commit and Push Workflow', () => {
    it('should commit and push when push flag is true', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const commitSha = 'new-commit-sha-123';

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);
      mockGitAdapter.stage.mockResolvedValue(undefined);
      mockGitAdapter.commit.mockResolvedValue(commitSha);
      mockGitAdapter.push.mockResolvedValue(undefined);

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        push: true,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockGitAdapter.stage).toHaveBeenCalledWith(process.cwd(), [
        '.claude-plugin/plugin.json',
        'marketplace.json',
      ]);
      expect(mockGitAdapter.commit).toHaveBeenCalled();
      expect(mockGitAdapter.push).toHaveBeenCalledWith(process.cwd(), { includeTags: false });
      expect(result.gitOperations?.committed).toBe(true);
      expect(result.gitOperations?.pushed).toBe(true);
      expect(result.gitOperations?.commitSha).toBe(commitSha);
    });

    it('should use custom commit message when provided', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);
      mockGitAdapter.stage.mockResolvedValue(undefined);
      mockGitAdapter.commit.mockResolvedValue('commit-sha');
      mockGitAdapter.push.mockResolvedValue(undefined);

      const customMessage = 'Release v1.2.3 with new features';
      const request: PublishRequest = {
        pluginId: 'test-plugin',
        push: true,
        message: customMessage,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockGitAdapter.commit).toHaveBeenCalledWith(process.cwd(), customMessage);
    });

    it('should create tag when tag option is provided', async () => {
      // Arrange
      const gitProvenance: GitProvenance = {
        repoUrl: 'https://github.com/user/repo.git',
        commitSha: 'abc123',
        branch: 'main',
        isDirty: false,
        remoteName: 'origin',
      };

      const manifestValidation: ManifestValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      mockGitAdapter.getProvenance.mockResolvedValue(gitProvenance);
      mockValidator.validatePluginManifest.mockResolvedValue(manifestValidation);
      mockValidator.validateMarketplaceIndex.mockResolvedValue(manifestValidation);
      mockGitAdapter.stage.mockResolvedValue(undefined);
      mockGitAdapter.commit.mockResolvedValue('commit-sha');
      mockGitAdapter.createTag.mockResolvedValue(undefined);
      mockGitAdapter.push.mockResolvedValue(undefined);

      const tagName = 'v1.2.3';
      const request: PublishRequest = {
        pluginId: 'test-plugin',
        push: true,
        tag: tagName,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockGitAdapter.createTag).toHaveBeenCalledWith(
        process.cwd(),
        tagName,
        `Release ${tagName}`
      );
      expect(mockGitAdapter.push).toHaveBeenCalledWith(process.cwd(), { includeTags: true });
      expect(result.gitOperations?.tagged).toBe(true);
      expect(result.gitOperations?.tagName).toBe(tagName);
    });
  });

  describe('Error Handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      mockGitAdapter.getProvenance.mockRejectedValue(new Error('Unexpected error'));

      const request: PublishRequest = {
        pluginId: 'test-plugin',
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ERR-PUBLISH-002');
      expect(result.transactionId).toBeDefined();
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include correlation ID in result', async () => {
      // Arrange
      const correlationId = 'test-correlation-id';
      mockGitAdapter.getProvenance.mockRejectedValue(new Error('Test error'));

      const request: PublishRequest = {
        pluginId: 'test-plugin',
        correlationId,
      };

      // Act
      const result = await publishService.publish(request);

      // Assert
      expect(result.metadata.correlationId).toBe(correlationId);
    });
  });
});
