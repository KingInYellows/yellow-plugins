/**
 * @yellow-plugins/cli - Uninstall Command
 *
 * Executes uninstall transactions with lifecycle consent prompts,
 * cache retention policies, and atomic symlink cleanup.
 *
 * Part of Task I3.T4: Enhanced Uninstall Experience
 *
 * @specification docs/operations/uninstall.md
 * @error-catalog docs/contracts/error-codes.md#installation-errors-inst
 */

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
  CacheService,
  InstallService,
  RegistryService,
  type CacheRetentionPolicy,
  type Config,
  type UninstallRequest as DomainUninstallRequest,
  type UninstallResult as DomainUninstallResult,
} from '@yellow-plugins/domain';
import { CacheAdapter } from '@yellow-plugins/infrastructure';

import {
  buildBaseResponse,
  loadRequest,
  toCommandResult,
  writeResponse,
} from '../lib/io.js';
import type {
  CommandContext,
  CommandHandler,
  CommandMetadata,
  BaseCommandOptions,
} from '../types/commands.js';
import type { ILogger } from '../types/logging.js';

interface UninstallOptions extends BaseCommandOptions {
  plugin: string;
  force?: boolean;
  keepCache?: boolean;
  purgeCache?: boolean;
  keepLastN?: number;
}

interface CliUninstallRequest {
  pluginId: string;
  cacheRetentionPolicy?: CacheRetentionPolicy;
  keepLastN?: number;
  force?: boolean;
  confirmationToken?: string;
  scriptReviewDigest?: string;
  dryRun?: boolean;
}

interface UninstallResponse {
  success: boolean;
  status: 'success' | 'error' | 'dry-run';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    pluginId: string;
    registryDelta?: DomainUninstallResult['registryDelta'];
    cacheRetention?: DomainUninstallResult['cacheRetention'];
    durationMs: number;
    messages: DomainUninstallResult['messages'];
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface ConsentErrorDetails {
  reason?: string;
  script?: {
    path: string;
    digest: string;
    preview: string;
    bytes: number;
  };
}

const uninstallHandler: CommandHandler<UninstallOptions> = async (options, context) => {
  const { logger, correlationId } = context;
  logger.info('Starting uninstall operation', {
    pluginId: options.plugin,
    force: options.force,
    keepCache: options.keepCache,
    purgeCache: options.purgeCache,
  });

  try {
    const policyFromFlags = derivePolicyFromFlags(options);
    const requestPayload = await loadRequest<CliUninstallRequest>(
      options,
      {
        pluginId: options.plugin,
        cacheRetentionPolicy: policyFromFlags,
        keepLastN: options.keepLastN,
        force: options.force,
        dryRun: options.dryRun,
      },
      context
    );

    if (!requestPayload.pluginId) {
      throw new Error('Plugin identifier is required for uninstall');
    }

    const domainRequest: DomainUninstallRequest = {
      pluginId: requestPayload.pluginId,
      cacheRetentionPolicy: requestPayload.cacheRetentionPolicy ?? policyFromFlags,
      keepLastN: requestPayload.keepLastN ?? options.keepLastN ?? 3,
      confirmationToken: requestPayload.confirmationToken,
      scriptReviewDigest: requestPayload.scriptReviewDigest,
      force: requestPayload.force ?? options.force ?? false,
      dryRun: requestPayload.dryRun ?? options.dryRun ?? false,
      correlationId,
    };

    const uninstallService = createUninstallService(context.config);
    const result = await executeWithPrompts(domainRequest, uninstallService, context);

    logger.setTransactionId(result.transactionId);
    logUninstallMessages(result, logger);

    const response: UninstallResponse = {
      ...buildBaseResponse(
        {
          success: result.success,
          status: domainRequest.dryRun ? 'dry-run' : result.success ? 'success' : 'error',
          message: result.success
            ? `Successfully uninstalled ${requestPayload.pluginId}`
            : `Failed to uninstall ${requestPayload.pluginId}`,
        },
        context
      ),
      transactionId: result.transactionId,
      data: result.success
        ? {
            pluginId: requestPayload.pluginId,
            registryDelta: result.registryDelta,
            cacheRetention: result.cacheRetention,
            durationMs: result.metadata.durationMs,
            messages: result.messages,
          }
        : undefined,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
          }
        : undefined,
    };

    await writeResponse(response, options, context);
    return toCommandResult(response);
  } catch (error) {
    logger.error('Uninstall command failed', {
      pluginId: options.plugin,
      error: (error as Error).message,
    });

    const response: UninstallResponse = {
      ...buildBaseResponse(
        {
          success: false,
          status: 'error',
          message: `Failed to uninstall ${options.plugin}: ${(error as Error).message}`,
        },
        context
      ),
      transactionId: context.logger.getContext().transactionId!,
      error: {
        code: 'ERR-UNINSTALL-CLI',
        message: (error as Error).message,
      },
    };

    await writeResponse(response, options, context);
    return toCommandResult(response);
  }
};

async function executeWithPrompts(
  request: DomainUninstallRequest,
  uninstallService: InstallService,
  context: CommandContext
): Promise<DomainUninstallResult> {
  const { logger } = context;
  let result = await uninstallService.uninstall(request);
  let attempts = 0;

  while (!result.success && attempts < 3) {
    attempts += 1;

    if (
      result.error?.code === 'ERR-UNINSTALL-CONFIRM' &&
      !request.force &&
      !request.dryRun
    ) {
      const confirmation = await promptForConfirmation(request.pluginId, logger);
      if (!confirmation) {
        throw new Error('Uninstall aborted by user (confirmation declined)');
      }
      request.confirmationToken = confirmation;
      result = await uninstallService.uninstall(request);
      continue;
    }

    if (
      result.error?.code === 'ERR-UNINSTALL-CONSENT' &&
      !request.force &&
      !request.dryRun
    ) {
      const digest = await promptForConsent(
        request.pluginId,
        (result.error.details as ConsentErrorDetails) || {},
        logger
      );
      if (!digest) {
        throw new Error('Uninstall aborted by user (lifecycle script not approved)');
      }
      request.scriptReviewDigest = digest;
      result = await uninstallService.uninstall(request);
      continue;
    }

    break;
  }

  return result;
}

function derivePolicyFromFlags(options: UninstallOptions): CacheRetentionPolicy {
  if (options.purgeCache) {
    return 'purge-all';
  }
  if (options.keepCache) {
    return 'keep-all';
  }
  return 'keep-last-n';
}

function createUninstallService(config: Config): InstallService {
  const cacheAdapter = new CacheAdapter();
  const cacheService = new CacheService(config, cacheAdapter);
  const registryService = new RegistryService(config, cacheAdapter);
  return new InstallService(config, cacheService, registryService);
}

async function promptForConfirmation(pluginId: string, logger: ILogger): Promise<string | undefined> {
  const rl = createInterface({ input, output });
  const answer = (
    await rl.question(`Type the plugin ID (${pluginId}) to confirm uninstall: `)
  ).trim();
  rl.close();

  if (!answer) {
    logger.warn('No confirmation provided; uninstall will be aborted');
    return undefined;
  }

  if (answer !== pluginId) {
    logger.warn('Confirmation token mismatch; uninstall will be aborted', {
      expected: pluginId,
      received: answer,
    });
    return undefined;
  }

  return answer;
}

async function promptForConsent(
  pluginId: string,
  details: ConsentErrorDetails,
  logger: ILogger
): Promise<string | undefined> {
  if (!details.script) {
    logger.warn('Lifecycle script details missing; cannot collect consent');
    return undefined;
  }

  process.stdout.write('\n┌──────────────── Lifecycle Uninstall Script ────────────────┐\n');
  process.stdout.write(`│ Plugin: ${pluginId.padEnd(48)}│\n`);
  process.stdout.write(
    `│ Script: ${details.script.path.padEnd(48)}│\n`
  );
  process.stdout.write(
    `│ Digest: ${details.script.digest.slice(0, 48).padEnd(48)}│\n`
  );
  process.stdout.write('├───────────────────────────────────────────────────────────┤\n');
  process.stdout.write(`${details.script.preview}\n`);
  process.stdout.write('└───────────────────────────────────────────────────────────┘\n');

  const rl = createInterface({ input, output });
  const answer = (
    await rl.question('Do you consent to execute this script? (yes/no): ')
  )
    .trim()
    .toLowerCase();
  rl.close();

  if (!answer || (answer !== 'y' && answer !== 'yes')) {
    logger.warn('Lifecycle script consent denied by user');
    return undefined;
  }

  return details.script.digest;
}

function logUninstallMessages(result: DomainUninstallResult, logger: ILogger): void {
  if (result.messages.length === 0) {
    return;
  }

  for (const message of result.messages) {
    if (message.level === 'error') {
      logger.error(message.message, { step: message.step });
    } else if (message.level === 'warn') {
      logger.warn(message.message, { step: message.step });
    } else {
      logger.info(message.message, { step: message.step });
    }
  }
}

export const uninstallCommand: CommandMetadata<UninstallOptions> = {
  name: 'uninstall',
  aliases: ['rm', 'remove'],
  description: 'Uninstall a plugin with lifecycle hooks and cache management',
  usage: 'plugin uninstall <plugin-id> [--force] [--keep-cache] [--purge-cache] [--keep-last-n=3]',
  specAnchors: ['FR-010', 'CRIT-004', 'CRIT-011', '6-3-uninstall-flow'],
  errorCodes: [
    'ERR-UNINSTALL-001',
    'ERR-UNINSTALL-002',
    'ERR-UNINSTALL-CONFIRM',
    'ERR-UNINSTALL-CONSENT',
    'ERR-UNINSTALL-999',
  ],
  examples: [
    {
      command: 'plugin uninstall example-plugin',
      description: 'Uninstall a plugin (keeps last 3 cached versions)',
    },
    {
      command: 'plugin uninstall example-plugin --keep-cache',
      description: 'Uninstall but preserve all cached versions for rollback',
    },
    {
      command: 'plugin uninstall example-plugin --purge-cache',
      description: 'Uninstall and remove all cached versions',
    },
    {
      command: 'plugin uninstall example-plugin --force',
      description: 'Force uninstall without confirmation prompts',
    },
    {
      command: 'plugin uninstall example-plugin --keep-last-n=5',
      description: 'Uninstall but keep the last 5 cached versions',
    },
  ],
  handler: uninstallHandler,
  builder: (yargs) =>
    yargs
      .positional('plugin', {
        describe: 'Plugin identifier to uninstall',
        type: 'string',
        demandOption: true,
      })
      .option('force', {
        describe: 'Skip confirmation prompts and lifecycle script review',
        type: 'boolean',
        default: false,
      })
      .option('keep-cache', {
        describe: 'Preserve all cached versions after uninstall',
        type: 'boolean',
        default: false,
        conflicts: 'purge-cache',
      })
      .option('purge-cache', {
        describe: 'Remove all cached versions after uninstall',
        type: 'boolean',
        default: false,
        conflicts: 'keep-cache',
      })
      .option('keep-last-n', {
        describe: 'Number of cached versions to retain (default: 3)',
        type: 'number',
        default: 3,
      }),
};
