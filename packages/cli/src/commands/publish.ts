/**
 * @yellow-plugins/cli - Publish Command
 *
 * Validates manifests, enforces lifecycle consent, captures git provenance,
 * and optionally pushes/tag releases with structured telemetry + audit logging.
 *
 * Part of Task I4.T1: Publish Service and CLI Command
 *
 * @specification docs/cli/publish.md
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

import {
  PublishService,
  ValidationStatus,
  type Config,
  type FeatureFlags,
  type GitProvenance,
  type ManifestValidationResult,
  type PublishRequest as DomainPublishRequest,
  type PublishResult as DomainPublishResult,
} from '@yellow-plugins/domain';
import { SchemaValidator } from '@yellow-plugins/infrastructure';

import {
  buildBaseResponse,
  loadRequest,
  toCommandResult,
  writeResponse,
} from '../lib/io.js';
import type {
  BaseCommandOptions,
  CommandContext,
  CommandHandler,
  CommandMetadata,
} from '../types/commands.js';
import type { ILogger } from '../types/logging.js';

const execFileAsync = promisify(execFile);

interface PublishOptions extends BaseCommandOptions {
  push?: boolean;
  message?: string;
  tag?: string;
  'dry-run'?: boolean;
  dryRun?: boolean;
  'non-interactive'?: boolean;
  nonInteractive?: boolean;
}

interface PublishCliRequest {
  pluginId: string;
  push?: boolean;
  message?: string;
  tag?: string;
  dryRun?: boolean;
  scriptReviewDigest?: string;
}

interface PublishResponse {
  success: boolean;
  status: 'success' | 'error' | 'dry-run';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    pluginId: string;
    gitProvenance?: GitProvenance;
    manifestValidation?: ManifestValidationResult;
    gitOperations?: DomainPublishResult['gitOperations'];
    durationMs: number;
    dryRun: boolean;
    messages: DomainPublishResult['messages'];
  };
  error?: {
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
    failedStep?: string;
    details?: unknown;
  };
  messages?: DomainPublishResult['messages'];
}

interface ConsentErrorDetails {
  reason?: string;
  script?: {
    path: string;
    digest: string;
    preview?: string;
    bytes?: number;
  };
}

const publishHandler: CommandHandler<PublishOptions> = async (options, context) => {
  const { logger, config, flags, correlationId } = context;
  const dryRunFlag = Boolean(options['dry-run'] ?? options.dryRun ?? false);
  logger.info('Publish command invoked', {
    push: options.push ?? false,
    dryRun: dryRunFlag,
    tag: options.tag,
  });

  try {
    const pluginId = await inferPluginId(config.pluginDir);
    const cliRequest = await loadRequest<PublishCliRequest>(
      options,
      {
        pluginId,
        push: options.push ?? false,
        message: options.message,
        tag: options.tag,
        dryRun: dryRunFlag,
      },
      context
    );

    if (!cliRequest.pluginId) {
      throw new Error(
        'Unable to determine plugin identifier. Provide pluginId via --input JSON or ensure .claude-plugin/plugin.json has a valid name.'
      );
    }

    if (cliRequest.tag && !cliRequest.push) {
      throw new Error('--tag requires --push to propagate annotated tags to the remote.');
    }

    const nonInteractive = isNonInteractive(options);
    const gitAdapter = new CliGitAdapter(logger);
    const publishService = await createPublishService(config, flags, gitAdapter, logger);

    const domainRequest: DomainPublishRequest = {
      pluginId: cliRequest.pluginId,
      push: cliRequest.push,
      message: cliRequest.message,
      tag: cliRequest.tag,
      dryRun: cliRequest.dryRun,
      correlationId,
      scriptReviewDigest: cliRequest.scriptReviewDigest,
    };

    if (domainRequest.push && !domainRequest.dryRun) {
      await ensurePushConfirmation({
        pluginId: cliRequest.pluginId,
        gitAdapter,
        nonInteractive,
        logger,
      });
    }

    const result = await executePublishWithConsent(
      domainRequest,
      publishService,
      context,
      nonInteractive
    );

    logger.setTransactionId(result.transactionId);
    logPublishMessages(result, logger);
    logger.audit('Publish transaction completed', {
      pluginId: cliRequest.pluginId,
      transactionId: result.transactionId,
      push: domainRequest.push ?? false,
      dryRun: domainRequest.dryRun ?? false,
      success: result.success,
      gitOperations: result.gitOperations,
    });

    const response = buildPublishResponse(result, domainRequest, context);
    await writeResponse(response, options, context);
    return toCommandResult(response);
  } catch (error) {
    logger.error('Publish command failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const response: PublishResponse = {
      ...buildBaseResponse(
        {
          success: false,
          status: 'error',
          message: `Publish command failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-PUBLISH-CLI',
        message: (error as Error).message,
        severity: 'ERROR',
      },
      messages: [],
    };

    await writeResponse(response, options, context);
    return toCommandResult(response);
  }
};

export const publishCommand: CommandMetadata<PublishOptions> = {
  name: 'publish',
  aliases: ['pub'],
  description: 'Publish a plugin to the marketplace',
  usage: 'plugin publish [--push] [--message <msg>]',
  requiredFlags: ['enablePublish'],
  specAnchors: ['FR-005', 'FR-008', 'CRIT-005', 'CRIT-004', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-PUBLISH-001', 'ERR-PUBLISH-002', 'ERR-PUBLISH-003', 'ERR-PUBLISH-CONSENT', 'ERR-SCHEMA-001', 'ERR-PUBLISH-CLI'],
  examples: [
    {
      command: 'plugin publish',
      description: 'Validate manifests and capture git status without pushing',
    },
    {
      command: 'plugin publish --push',
      description: 'Publish and push to remote repository',
    },
    {
      command: 'plugin publish --push --message "Release v1.2.3"',
      description: 'Publish with a custom commit message',
    },
  ],
  handler: publishHandler,
  builder: (yargs) => {
    return yargs
      .option('push', {
        describe: 'Push changes to remote after publishing',
        type: 'boolean',
        default: false,
      })
      .option('message', {
        describe: 'Commit message for the publish operation',
        type: 'string',
        alias: 'm',
      })
      .option('tag', {
        describe: 'Tag name to create after commit (requires --push)',
        type: 'string',
        alias: 't',
      })
      .option('dry-run', {
        describe: 'Validate without making changes',
        type: 'boolean',
        default: false,
      })
      .option('non-interactive', {
        describe: 'Disable prompts; rely on environment variables for confirmations',
        type: 'boolean',
        default: false,
      });
  },
};

async function inferPluginId(pluginDir: string): Promise<string | undefined> {
  try {
    const manifestPath = join(pluginDir, 'plugin.json');
    const raw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const id = manifest['id'];
    const name = manifest['name'];
    if (typeof id === 'string' && id.trim().length > 0) {
      return id;
    }
    if (typeof name === 'string' && name.trim().length > 0) {
      return name;
    }
    return undefined;
  } catch (error) {
    throw new Error(
      `Failed to read plugin manifest from ${join(pluginDir, 'plugin.json')}: ${
        (error as Error).message
      }`
    );
  }
}

async function executePublishWithConsent(
  request: DomainPublishRequest,
  service: PublishService,
  context: CommandContext,
  nonInteractive: boolean
): Promise<DomainPublishResult> {
  const { logger } = context;
  let result = await service.publish(request);
  let attempts = 0;

  while (!result.success && attempts < 3) {
    attempts += 1;

    if (result.error?.code === 'ERR-PUBLISH-CONSENT') {
      const digest = await resolveLifecycleConsent(
        result.error.details as ConsentErrorDetails,
        logger,
        nonInteractive
      );

      if (!digest) {
        throw new Error('Publish aborted by user (lifecycle script not approved)');
      }

      if (request.scriptReviewDigest === digest) {
        throw new Error(
          'Lifecycle consent digest was rejected by the publish service. Verify the script digest and try again.'
        );
      }

      request.scriptReviewDigest = digest;
      result = await service.publish(request);
      continue;
    }

    break;
  }

  return result;
}

async function resolveLifecycleConsent(
  details: ConsentErrorDetails,
  logger: ILogger,
  nonInteractive: boolean
): Promise<string | undefined> {
  if (nonInteractive) {
    const envDigest = process.env.LIFECYCLE_CONSENT_DIGEST;
    if (!envDigest) {
      throw new Error(
        'Non-interactive mode requires LIFECYCLE_CONSENT_DIGEST to approve publish lifecycle scripts.'
      );
    }
    logger.info('Lifecycle consent provided via LIFECYCLE_CONSENT_DIGEST');
    return envDigest;
  }

  if (!details.script) {
    logger.warn('Lifecycle script details missing; cannot prompt for consent');
    return undefined;
  }

  renderLifecyclePreview(details.script);
  const rl = createInterface({ input, output });
  const answer = (await rl.question("Type 'I TRUST THIS SCRIPT' to continue: ")).trim();
  rl.close();

  if (answer !== 'I TRUST THIS SCRIPT') {
    logger.warn('Lifecycle script consent declined by user');
    return undefined;
  }

  return details.script.digest;
}

function renderLifecyclePreview(script: {
  path: string;
  digest: string;
  preview?: string;
  bytes?: number;
}): void {
  process.stdout.write('\n┌──────────────── Publish Lifecycle Script ────────────────┐\n');
  process.stdout.write(`│ Path: ${script.path.padEnd(48)}│\n`);
  process.stdout.write(`│ Digest: ${script.digest.slice(0, 48).padEnd(48)}│\n`);
  if (typeof script.bytes === 'number') {
    process.stdout.write(`│ Size: ${`${script.bytes} bytes`.padEnd(48)}│\n`);
  }
  process.stdout.write('├───────────────────────────────────────────────────────────┤\n');
  const preview = script.preview?.trim() ?? '<no preview available>';
  process.stdout.write(`${preview}\n`);
  process.stdout.write('└───────────────────────────────────────────────────────────┘\n\n');
}

function isNonInteractive(options: PublishOptions): boolean {
  return Boolean(options['non-interactive'] ?? options.nonInteractive ?? false);
}

async function ensurePushConfirmation(args: {
  pluginId: string;
  gitAdapter: CliGitAdapter;
  nonInteractive: boolean;
  logger: ILogger;
}): Promise<void> {
  let provenance: GitProvenance | undefined;
  try {
    provenance = await args.gitAdapter.getProvenance(process.cwd());
  } catch {
    // Ignore provenance errors here; publish service will surface them later.
  }

  if (args.nonInteractive) {
    const envValue = (process.env.PUBLISH_PUSH_CONFIRM || '').toLowerCase();
    if (!['1', 'true', 'yes', 'push'].includes(envValue)) {
      throw new Error(
        'Non-interactive pushes require PUBLISH_PUSH_CONFIRM=yes to acknowledge remote mutations.'
      );
    }
    args.logger.info('Git push confirmed via PUBLISH_PUSH_CONFIRM');
    return;
  }

  const remoteSummary = provenance
    ? `${provenance.remoteName}/${provenance.branch}`
    : 'configured remote';
  const rl = createInterface({ input, output });
  const answer = (
    await rl.question(
      `About to push ${args.pluginId} changes to ${remoteSummary}. Type PUSH to continue: `
    )
  )
    .trim()
    .toUpperCase();
  rl.close();

  if (answer !== 'PUSH') {
    throw new Error('Publish aborted by user (push confirmation declined)');
  }

  args.logger.info('Git push confirmed interactively');
}

function buildPublishResponse(
  result: DomainPublishResult,
  request: DomainPublishRequest,
  context: CommandContext
): PublishResponse {
  const message = result.success
    ? request.dryRun
      ? `Validation complete for ${request.pluginId} (dry-run)`
      : `Successfully published ${request.pluginId}`
    : result.error?.message ?? `Failed to publish ${request.pluginId}`;

  const response: PublishResponse = {
    ...buildBaseResponse(
      {
        success: result.success,
        status: request.dryRun ? 'dry-run' : result.success ? 'success' : 'error',
        message,
      },
      context
    ),
    transactionId: result.transactionId,
    data: result.success
      ? {
          pluginId: request.pluginId,
          gitProvenance: result.gitProvenance,
          manifestValidation: result.manifestValidation,
          gitOperations: result.gitOperations,
          durationMs: result.metadata.durationMs,
          dryRun: Boolean(request.dryRun),
          messages: result.messages,
        }
      : undefined,
    error: result.error
      ? {
          code: result.error.code,
          message: result.error.message,
          severity: 'ERROR',
          failedStep: result.error.failedStep,
          details: result.error.details,
        }
      : undefined,
    messages: result.messages,
  };

  return response;
}

function logPublishMessages(result: DomainPublishResult, logger: ILogger): void {
  for (const entry of result.messages) {
    const data = entry.step ? { step: entry.step } : undefined;
    switch (entry.level) {
      case 'warn':
        logger.warn(entry.message, data);
        break;
      case 'error':
        logger.error(entry.message, data);
        break;
      default:
        logger.info(entry.message, data);
        break;
    }
  }
}

async function createPublishService(
  config: Config,
  flags: FeatureFlags,
  gitAdapter: CliGitAdapter,
  logger: ILogger
): Promise<PublishService> {
  const validator = new ManifestValidatorAdapter(logger);
  await validator.initialize();
  return new PublishService(config, flags, validator, gitAdapter);
}

class ManifestValidatorAdapter {
  private readonly schemaValidator: SchemaValidator;
  private initialized = false;
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
    this.schemaValidator = new SchemaValidator();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.schemaValidator.initialize('schemas');
    this.initialized = true;
  }

  async validatePluginManifest(manifestPath: string): Promise<ManifestValidationResult> {
    const data = await this.readJson(manifestPath);
    const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const pluginName =
      typeof data['name'] === 'string'
        ? (data['name'] as string)
        : typeof data['id'] === 'string'
          ? (data['id'] as string)
          : undefined;
    const result = this.schemaValidator.validatePluginManifest(data, pluginName);
    return this.toManifestValidation(result.status, result.errors, result.warnings, digest);
  }

  async validateMarketplaceIndex(indexPath: string): Promise<ManifestValidationResult> {
    const data = await this.readJson(indexPath);
    const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const result = this.schemaValidator.validateMarketplace(data);
    return this.toManifestValidation(result.status, result.errors, result.warnings, digest);
  }

  private toManifestValidation(
    status: ValidationStatus,
    errors: Array<{ code: string; message: string; path?: string }> | undefined,
    warnings: Array<{ code: string; message: string; path?: string }> | undefined,
    digest?: string
  ): ManifestValidationResult {
    return {
      valid: status !== ValidationStatus.ERROR,
      errors: (errors ?? []).map(({ code, message, path }) => ({ code, message, path })),
      warnings: (warnings ?? []).map(({ code, message, path }) => ({ code, message, path })),
      digest,
    };
  }

  private async readJson(filePath: string): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.logger.error('Failed to read JSON file for validation', {
        path: filePath,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

class CliGitAdapter {
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  async getProvenance(repoPath: string): Promise<GitProvenance> {
    const branch = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    const commitSha = await this.runGit(['rev-parse', 'HEAD'], repoPath);
    const remoteName = await this.getRemoteName(branch, repoPath);
    const repoUrl = await this.runGit(
      ['config', '--get', `remote.${remoteName}.url`],
      repoPath
    );
    const isDirty = (await this.runGit(['status', '--porcelain'], repoPath)).length > 0;

    const trackingStatus = await this.getTrackingStatus(repoPath);

    return {
      repoUrl,
      commitSha,
      branch,
      isDirty,
      remoteName,
      trackingStatus: trackingStatus ?? undefined,
    };
  }

  async stage(repoPath: string, files: string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    await this.runGit(['add', ...files], repoPath);
  }

  async commit(repoPath: string, message: string): Promise<string> {
    await this.runGit(['commit', '--allow-empty', '-m', message], repoPath);
    return this.runGit(['rev-parse', 'HEAD'], repoPath);
  }

  async createTag(repoPath: string, tagName: string, message?: string): Promise<void> {
    const args = ['tag', '-a', tagName, '-m', message ?? `Release ${tagName}`];
    await this.runGit(args, repoPath);
  }

  async push(repoPath: string, options?: { includeTags?: boolean }): Promise<void> {
    const args = ['push'];
    if (options?.includeTags) {
      args.push('--follow-tags');
    }
    await this.runGit(args, repoPath);
  }

  private async getRemoteName(branch: string, repoPath: string): Promise<string> {
    try {
      const remote = await this.runGit(
        ['config', `branch.${branch}.remote`],
        repoPath
      );
      return remote || 'origin';
    } catch {
      return 'origin';
    }
  }

  private async getTrackingStatus(
    repoPath: string
  ): Promise<{ ahead: number; behind: number } | null> {
    try {
      const output = await this.runGit(
        ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
        repoPath
      );
      const [behind, ahead] = output.split('\t').map((value) => Number.parseInt(value, 10) || 0);
      return { ahead, behind };
    } catch {
      return null;
    }
  }

  private async runGit(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd });
      return stdout.trim();
    } catch (error) {
      this.logger.error('Git command failed', {
        args,
        cwd,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
