/**
 * @yellow-plugins/domain - Publish Service Implementation
 *
 * Core domain service orchestrating plugin publish transactions.
 * Implements validation, git status checks, lifecycle hooks, and atomic git operations.
 *
 * Part of Task I4.T1: Publish Service and CLI Command
 *
 * Architecture References:
 * - Section 3.0: API Design & Communication
 * - FR-008: Update Notifications (publish integration)
 * - CRIT-005: Publish workflow validation
 * - CRIT-004: Lifecycle script consent
 * - Assumption 2: Git authentication via existing credentials
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep as pathSeparator } from 'node:path';

import type { Config, FeatureFlags } from '../config/contracts.js';

import type { IPublishService } from './contracts.js';
import type {
  PublishRequest,
  PublishResult,
  GitProvenance,
  ManifestValidationResult,
} from './types.js';

const AUDIT_DIR_NAME = 'audit';
const MAX_SCRIPT_PREVIEW_CHARS = 4000;

interface LifecycleScriptInfo {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly digest: string;
  readonly preview: string;
  readonly bytes: number;
}

/**
 * Validator interface for manifest validation.
 * In a real implementation, this would be injected from infrastructure layer.
 */
interface IValidator {
  validatePluginManifest(manifestPath: string): Promise<ManifestValidationResult>;
  validateMarketplaceIndex(indexPath: string): Promise<ManifestValidationResult>;
}

/**
 * Git adapter interface for git operations.
 * In a real implementation, this would be injected from infrastructure layer.
 */
interface IGitAdapter {
  getProvenance(repoPath: string): Promise<GitProvenance>;
  hasUncommittedChanges(repoPath: string): Promise<boolean>;
  stage(repoPath: string, files: string[]): Promise<void>;
  commit(repoPath: string, message: string): Promise<string>;
  createTag(repoPath: string, tagName: string, message?: string): Promise<void>;
  push(repoPath: string, options?: { includeTags?: boolean }): Promise<void>;
}

/**
 * Publish service implementation.
 * Orchestrates plugin publishing with full validation and git lifecycle.
 */
export class PublishService implements IPublishService {
  private readonly config: Config;
  private readonly flags: FeatureFlags;
  private readonly validator: IValidator;
  private readonly gitAdapter: IGitAdapter;

  constructor(
    config: Config,
    flags: FeatureFlags,
    validator: IValidator,
    gitAdapter: IGitAdapter
  ) {
    this.config = config;
    this.flags = flags;
    this.validator = validator;
    this.gitAdapter = gitAdapter;
  }

  /**
   * Publish a plugin to the marketplace.
   * Implements full validation, git checks, lifecycle hooks, and optional push/tag.
   */
  async publish(request: PublishRequest): Promise<PublishResult> {
    const transactionId = this.generateTransactionId();
    const startTime = Date.now();
    const messages: Array<{ level: 'info' | 'warn' | 'error'; message: string; step?: string }> =
      [];
    const repoPath = process.cwd();
    let lifecycleScriptInfo: LifecycleScriptInfo | undefined;

    try {
      // Step 1: Validate feature flag
      messages.push({
        level: 'info',
        message: `Starting publish operation for ${request.pluginId}`,
        step: 'VALIDATE_FLAGS',
      });

      if (!this.flags.enablePublish) {
        return this.finalizeResult(
          this.buildErrorResult(
            transactionId,
            'ERR-PUBLISH-001',
            'Publish command is disabled. Enable the "enablePublish" feature flag to proceed.',
            'VALIDATE_FLAGS',
            startTime,
            messages,
            request.correlationId
          ),
          repoPath
        );
      }

      // Step 2: Check git status and capture provenance
      messages.push({
        level: 'info',
        message: 'Checking git repository status...',
        step: 'CHECK_GIT_STATUS',
      });

      let gitProvenance: GitProvenance;

      try {
        gitProvenance = await this.gitAdapter.getProvenance(repoPath);
      } catch (error) {
        return this.finalizeResult(
          this.buildErrorResult(
            transactionId,
            'ERR-PUBLISH-002',
            `Failed to retrieve git provenance: ${(error as Error).message}. Ensure you are in a git repository with a configured remote.`,
            'CHECK_GIT_STATUS',
            startTime,
            messages,
            request.correlationId,
            error
          ),
          repoPath
        );
      }

      if (gitProvenance.isDirty) {
        messages.push({
          level: 'warn',
          message: 'Working directory has uncommitted changes. These changes will be included in the publish.',
          step: 'CHECK_GIT_STATUS',
        });
      }

      // Step 3: Validate plugin manifest
      messages.push({
        level: 'info',
        message: 'Validating plugin manifest...',
        step: 'VALIDATE_MANIFEST',
      });

      const manifestPath = `${this.config.pluginDir}/plugin.json`;
      const manifestValidation = await this.validator.validatePluginManifest(manifestPath);

      if (!manifestValidation.valid) {
        const errorMessages = manifestValidation.errors.map((e) => `  - ${e.message}`).join('\n');
        return this.finalizeResult(
          this.buildErrorResult(
            transactionId,
            'ERR-SCHEMA-001',
            `Plugin manifest validation failed:\n${errorMessages}`,
            'VALIDATE_MANIFEST',
            startTime,
            messages,
            request.correlationId,
            { errors: manifestValidation.errors }
          ),
          repoPath
        );
      }

      if (manifestValidation.warnings.length > 0) {
        manifestValidation.warnings.forEach((warning) => {
          messages.push({
            level: 'warn',
            message: warning.message,
            step: 'VALIDATE_MANIFEST',
          });
        });
      }

      // Step 4: Validate marketplace index
      messages.push({
        level: 'info',
        message: 'Validating marketplace index...',
        step: 'VALIDATE_MANIFEST',
      });

      const indexPath = 'marketplace.json';
      const indexValidation = await this.validator.validateMarketplaceIndex(indexPath);

      if (!indexValidation.valid) {
        const errorMessages = indexValidation.errors.map((e) => `  - ${e.message}`).join('\n');
        return this.finalizeResult(
          this.buildErrorResult(
            transactionId,
            'ERR-SCHEMA-001',
            `Marketplace index validation failed:\n${errorMessages}`,
            'VALIDATE_MANIFEST',
            startTime,
            messages,
            request.correlationId,
            { errors: indexValidation.errors }
          ),
          repoPath
        );
      }

      // Step 5: Lifecycle consent guard for publish scripts
      if (this.flags.enableLifecycleHooks) {
        messages.push({
          level: 'info',
          message: 'Checking for pre-publish lifecycle hooks...',
          step: 'LIFECYCLE_PRE',
        });

        try {
          lifecycleScriptInfo = await this.loadPublishLifecycleScript(repoPath, manifestPath);
        } catch (error) {
          return this.finalizeResult(
            this.buildErrorResult(
              transactionId,
              'ERR-PUBLISH-003',
              `Failed to load publish lifecycle script: ${(error as Error).message}`,
              'LIFECYCLE_PRE',
              startTime,
              messages,
              request.correlationId,
              error
            ),
            repoPath
          );
        }

        if (lifecycleScriptInfo) {
          if (!request.scriptReviewDigest) {
            return this.finalizeResult(
              this.buildErrorResult(
                transactionId,
                'ERR-PUBLISH-CONSENT',
                'Publish lifecycle script requires explicit consent before execution',
                'LIFECYCLE_PRE',
                startTime,
                messages,
                request.correlationId,
                {
                  reason: 'consent-required',
                  script: {
                    digest: lifecycleScriptInfo.digest,
                    path: lifecycleScriptInfo.relativePath,
                    preview: lifecycleScriptInfo.preview,
                    bytes: lifecycleScriptInfo.bytes,
                  },
                }
              ),
              repoPath
            );
          }

          if (request.scriptReviewDigest !== lifecycleScriptInfo.digest) {
            return this.finalizeResult(
              this.buildErrorResult(
                transactionId,
                'ERR-PUBLISH-CONSENT',
                'Publish lifecycle script changed since consent was granted',
                'LIFECYCLE_PRE',
                startTime,
                messages,
                request.correlationId,
                {
                  reason: 'digest-mismatch',
                  expected: lifecycleScriptInfo.digest,
                  received: request.scriptReviewDigest,
                }
              ),
              repoPath
            );
          }

          messages.push({
            level: 'info',
            message: 'Lifecycle consent verified for publish script',
            step: 'LIFECYCLE_PRE',
          });
        }
      }

      // Dry-run mode: stop here without mutations
      if (request.dryRun) {
        messages.push({
          level: 'info',
          message: 'Dry-run mode: validation complete. No changes were made.',
          step: 'TELEMETRY',
        });

        return this.finalizeResult(
          {
            success: true,
            transactionId,
            gitProvenance,
            manifestValidation,
            metadata: {
              durationMs: Date.now() - startTime,
              timestamp: new Date(),
              correlationId: request.correlationId,
            },
            messages,
          },
          repoPath
        );
      }

      // Step 6: Stage changes and commit (if requested)
      let commitSha: string | undefined;
      let tagName: string | undefined;

      if (request.push) {
        messages.push({
          level: 'info',
          message: 'Staging changes for commit...',
          step: 'STAGE_CHANGES',
        });

        // Stage plugin manifest and marketplace index
        await this.gitAdapter.stage(repoPath, [manifestPath, indexPath]);

        messages.push({
          level: 'info',
          message: 'Committing changes...',
          step: 'COMMIT',
        });

        const commitMessage =
          request.message ||
          `chore(publish): publish ${request.pluginId}\n\nTransaction ID: ${transactionId}`;

        commitSha = await this.gitAdapter.commit(repoPath, commitMessage);

        messages.push({
          level: 'info',
          message: `Committed changes: ${commitSha}`,
          step: 'COMMIT',
        });

        // Step 7: Create tag (if requested)
        if (request.tag) {
          messages.push({
            level: 'info',
            message: `Creating tag: ${request.tag}`,
            step: 'TAG',
          });

          tagName = request.tag;
          await this.gitAdapter.createTag(repoPath, tagName, `Release ${tagName}`);
        }

        // Step 8: Push to remote
        messages.push({
          level: 'info',
          message: 'Pushing changes to remote...',
          step: 'PUSH',
        });

        await this.gitAdapter.push(repoPath, { includeTags: !!tagName });

        messages.push({
          level: 'info',
          message: 'Successfully pushed changes to remote',
          step: 'PUSH',
        });
      }

      // Step 9: Execute post-publish lifecycle hooks (if enabled)
      if (this.flags.enableLifecycleHooks) {
        messages.push({
          level: 'info',
          message: 'Checking for post-publish lifecycle hooks...',
          step: 'LIFECYCLE_POST',
        });
        // Placeholder for lifecycle hook execution
      }

      // Step 10: Emit telemetry
      messages.push({
        level: 'info',
        message: 'Publish operation complete',
        step: 'TELEMETRY',
      });

      return this.finalizeResult(
        {
          success: true,
          transactionId,
          gitProvenance,
          manifestValidation,
          gitOperations: {
            committed: !!commitSha,
            pushed: !!request.push,
            tagged: !!tagName,
            commitSha,
            tagName,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages,
        },
        repoPath
      );
    } catch (error) {
      return this.finalizeResult(
        this.buildErrorResult(
          transactionId,
          'ERR-PUBLISH-999',
          `Unexpected error during publish: ${(error as Error).message}`,
          'UNKNOWN',
          startTime,
          messages,
          request.correlationId,
          error
        ),
        repoPath
      );
    }
  }

  /**
   * Build error result with consistent structure.
   */
  private buildErrorResult(
    transactionId: string,
    errorCode: string,
    errorMessage: string,
    failedStep: string,
    startTime: number,
    messages: Array<{ level: 'info' | 'warn' | 'error'; message: string; step?: string }>,
    correlationId?: string,
    details?: unknown
  ): PublishResult {
    messages.push({
      level: 'error',
      message: errorMessage,
      step: failedStep,
    });

    return {
      success: false,
      transactionId,
      error: {
        code: errorCode,
        message: errorMessage,
        failedStep,
        details,
      },
      metadata: {
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
        correlationId,
      },
      messages,
    };
  }

  /**
   * Finalize result by persisting audit log before returning to caller.
   */
  private async finalizeResult(result: PublishResult, repoPath: string): Promise<PublishResult> {
    await this.recordAuditLog(result, repoPath);
    return result;
  }

  /**
   * Persist publish transaction details to the audit directory.
   */
  private async recordAuditLog(result: PublishResult, repoPath: string): Promise<void> {
    try {
      const pluginDir = this.config.pluginDir.startsWith('/')
        ? this.config.pluginDir
        : join(repoPath, this.config.pluginDir);
      const auditDir = join(pluginDir, AUDIT_DIR_NAME);
      await mkdir(auditDir, { recursive: true });

      const payload = {
        transactionId: result.transactionId,
        success: result.success,
        metadata: result.metadata,
        gitProvenance: result.gitProvenance,
        manifestValidation: result.manifestValidation,
        gitOperations: result.gitOperations,
        lifecycleResults: result.lifecycleResults,
        error: result.error,
        messages: result.messages,
      };

      const content = JSON.stringify(payload, null, 2);
      const filePath = join(auditDir, `publish-${result.transactionId}.json`);
      const tempPath = `${filePath}.tmp`;
      await writeFile(tempPath, content, 'utf-8');
      await rename(tempPath, filePath);
    } catch {
      // Audit logging failures should never block publish results.
    }
  }

  /**
   * Load publish lifecycle script metadata if declared.
   */
  private async loadPublishLifecycleScript(
    repoPath: string,
    manifestPath: string
  ): Promise<LifecycleScriptInfo | undefined> {
    const manifest = await this.loadManifest(manifestPath);
    const lifecycleValue =
      manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>)['lifecycle'] : undefined;
    if (!lifecycleValue || typeof lifecycleValue !== 'object') {
      return undefined;
    }

    const lifecycle = lifecycleValue as Record<string, unknown>;
    const publishValue = lifecycle['publish'];
    const publishBlock =
      publishValue && typeof publishValue === 'object'
        ? (publishValue as Record<string, unknown>)
        : undefined;
    const relativePath: string | undefined =
      typeof lifecycle['prePublish'] === 'string'
        ? (lifecycle['prePublish'] as string)
        : publishBlock && typeof publishBlock['pre'] === 'string'
          ? (publishBlock['pre'] as string)
          : undefined;

    if (!relativePath) {
      return undefined;
    }

    const absolutePath = this.resolveLifecyclePath(repoPath, relativePath);
    const scriptContent = await readFile(absolutePath, 'utf-8');
    const digest = createHash('sha256').update(scriptContent).digest('hex');

    return {
      relativePath,
      absolutePath,
      digest,
      preview: this.buildScriptPreview(scriptContent),
      bytes: Buffer.byteLength(scriptContent, 'utf-8'),
    };
  }

  private resolveLifecyclePath(repoPath: string, relativePath: string): string {
    const sanitized = relativePath.trim();
    if (!sanitized) {
      throw new Error('Lifecycle publish script path cannot be empty');
    }
    if (sanitized.startsWith('..') || sanitized.includes(`..${pathSeparator}`)) {
      throw new Error('Lifecycle publish script path must stay within the repository root');
    }

    const absoluteBase = resolve(repoPath);
    const candidate = resolve(absoluteBase, sanitized);
    const safeBase = absoluteBase.endsWith(pathSeparator)
      ? absoluteBase
      : `${absoluteBase}${pathSeparator}`;

    if (!candidate.startsWith(safeBase)) {
      throw new Error('Lifecycle publish script path escapes the repository root');
    }

    return candidate;
  }

  private buildScriptPreview(content: string): string {
    if (content.length <= MAX_SCRIPT_PREVIEW_CHARS) {
      return content;
    }

    return `${content.slice(0, MAX_SCRIPT_PREVIEW_CHARS)}\n... (truncated)`;
  }

  private async loadManifest(
    manifestPath: string
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const absolutePath = resolve(manifestPath);
      const raw = await readFile(absolutePath, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  /**
   * Generate a unique transaction ID.
   */
  private generateTransactionId(): string {
    return `tx-pub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
