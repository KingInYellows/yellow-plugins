/**
 * @yellow-plugins/cli - Check Updates Command
 *
 * Checks for available updates to installed plugins with changelog metadata.
 * Implements CRIT-008 changelog-aware update flow.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * @specification docs/contracts/cli-contracts.md#update-contract
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import {
  CacheService,
  ChangelogService,
  InstallService,
  RegistryService,
  UpdateService,
  type Config,
  type IHttpAdapter,
} from '@yellow-plugins/domain';
import { CacheAdapter } from '@yellow-plugins/infrastructure';

import {
  loadRequest,
  writeResponse,
  toCommandResult,
  buildBaseResponse,
  buildCompatibilityIntent,
} from '../lib/io.js';
import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface CheckUpdatesOptions extends BaseCommandOptions {
  plugin?: string;
  json?: boolean;
  fetchChangelogs?: boolean;
  bypassChangelogCache?: boolean;
}

/**
 * Check-updates request payload.
 * Reuses update contract structure with checkOnly semantics.
 */
interface CheckUpdatesRequest {
  pluginId?: string;
  all?: boolean;
  fetchChangelogs?: boolean;
  bypassChangelogCache?: boolean;
  compatibilityIntent: {
    nodeVersion: string;
    os: string;
    arch: string;
    claudeVersion?: string;
  };
  correlationId?: string;
  dryRun?: boolean;
  flagOverrides?: Record<string, boolean>;
  telemetryContext?: {
    sessionId?: string;
    gitCommit?: string;
    tags?: Record<string, string>;
  };
}

/**
 * Check-updates response payload.
 * Uses update contract's availableUpdates field.
 */
interface CheckUpdatesResponse {
  success: boolean;
  status: 'success' | 'error' | 'dry-run' | 'partial';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    availableUpdates: Array<{
      pluginId: string;
      currentVersion: string;
      latestVersion: string;
      changelogUrl?: string;
      changelogStatus?: string;
      changelogMessage?: string;
    }>;
    upToDate: string[];
    skipped: Array<{
      pluginId: string;
      reason: string;
      errorCode?: string;
    }>;
    marketplaceWarning?: {
      stale: boolean;
      message: string;
      lastUpdated?: string;
    };
    flagEvaluations?: {
      flags: Record<string, boolean>;
      source: 'config' | 'override' | 'default';
      appliedFlags: string[];
    };
  };
  error?: {
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
    category: string;
    specReference?: string;
    resolution?: string;
    context?: Record<string, unknown>;
  };
  telemetry?: {
    durationMs: number;
    cacheStatus?: 'hit' | 'miss' | 'partial';
    changelogsFetched?: number;
    changelogCacheHits?: number;
  };
}

const checkUpdatesHandler: CommandHandler<CheckUpdatesOptions> = async (options, context) => {
  const { logger, correlationId, startTime } = context;
  const startTimeMs = startTime.getTime();

  logger.info('Check-updates command invoked', { pluginId: options.plugin });

  try {
    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<CheckUpdatesRequest>(
      options,
      {
        pluginId: options.plugin,
        all: !options.plugin, // If no plugin specified, check all
        fetchChangelogs: options.fetchChangelogs ?? true, // Fetch changelogs by default
        bypassChangelogCache: options.bypassChangelogCache ?? false,
        compatibilityIntent: buildCompatibilityIntent(),
        correlationId,
        dryRun: options.dryRun,
      },
      context
    );

    logger.info('Check-updates request prepared', { request });

    const updateService = createUpdateService(context.config);
    const result = await updateService.checkUpdates({
      pluginId: request.pluginId,
      all: request.all,
      fetchChangelogs: request.fetchChangelogs,
      bypassChangelogCache: request.bypassChangelogCache,
      correlationId,
      transactionId: undefined,
    });

    if (result.transactionId) {
      logger.setTransactionId(result.transactionId);
    }

    const availableUpdates = result.updatesAvailable.map((update) => ({
      pluginId: update.pluginId,
      currentVersion: update.currentVersion,
      latestVersion: update.latestVersion,
      changelogUrl: update.changelogUrl,
      changelogStatus: update.changelog?.status,
      changelogMessage: update.changelog?.displayMessage,
      changelogFetchDurationMs: update.changelog?.metadata.durationMs,
      pinned: update.pinned ?? false,
    }));

    const status: CheckUpdatesResponse['status'] = !result.success
      ? 'error'
      : result.skipped.length > 0
      ? 'partial'
      : 'success';

    const message = !result.success
      ? result.error?.message ?? 'Check-updates failed'
      : availableUpdates.length === 0
      ? 'All plugins are up-to-date'
      : `Found ${availableUpdates.length} plugin update${availableUpdates.length === 1 ? '' : 's'}`;

    const baseResponse = buildBaseResponse(
      {
        success: result.success,
        status,
        message,
      },
      context
    );

    const response: CheckUpdatesResponse = {
      ...baseResponse,
      transactionId: result.transactionId ?? baseResponse.transactionId,
      data: {
        availableUpdates,
        upToDate: result.upToDate,
        skipped: result.skipped,
        marketplaceWarning: result.marketplaceWarning
          ? {
              stale: result.marketplaceWarning.stale,
              message: result.marketplaceWarning.message,
              lastUpdated: result.marketplaceWarning.lastUpdated?.toISOString(),
            }
          : undefined,
        flagEvaluations: {
          flags: context.flags as unknown as Record<string, boolean>,
          source: 'config',
          appliedFlags: [],
        },
      },
      telemetry: {
        durationMs: result.metadata.durationMs,
        cacheStatus: deriveCacheStatus(
          result.metadata.changelogsFetched,
          result.metadata.changelogCacheHits
        ),
        changelogsFetched: result.metadata.changelogsFetched,
        changelogCacheHits: result.metadata.changelogCacheHits,
      },
    };

    if (!result.success && result.error) {
      response.error = {
        code: result.error.code ?? 'ERR-CHECK-999',
        message: result.error.message,
        severity: 'ERROR',
        category: 'EXECUTION',
        context: result.error.details ? { details: result.error.details } : undefined,
      };
    }

    logger.info('Check-updates completed', {
      updates: availableUpdates.length,
      upToDate: result.upToDate.length,
      skipped: result.skipped.length,
      marketplaceWarning: response.data?.marketplaceWarning?.message,
    });

    // Write response to JSON output if requested
    await writeResponse(response, options, context);

    // Return CLI-compatible result
    return toCommandResult(response);
  } catch (error) {
    logger.error('Check-updates command failed', { error });

    const endTimeMs = new Date().getTime();
    const durationMs = endTimeMs - startTimeMs;

    const errorResponse: CheckUpdatesResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: `Check-updates failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-CHECK-999',
        message: (error as Error).message,
        severity: 'ERROR',
        category: 'EXECUTION',
        context: {
          error: String(error),
        },
      },
      telemetry: {
        durationMs,
      },
    };

    await writeResponse(errorResponse, options, context);
    return toCommandResult(errorResponse);
  }
};



export const checkUpdatesCommand: CommandMetadata<CheckUpdatesOptions> = {
  name: 'check-updates',
  aliases: ['cu', 'outdated'],
  description: 'Check for available plugin updates with changelog metadata',
  usage: 'plugin check-updates [plugin-id] [--json] [--fetch-changelogs]',
  requiredFlags: undefined,
  specAnchors: ['FR-009', 'CRIT-008', 'CRIT-009', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-CHECK-001', 'ERR-CHECK-002', 'ERR-CHECK-999'],
  examples: [
    {
      command: 'plugin check-updates',
      description: 'Check all installed plugins for updates',
    },
    {
      command: 'plugin check-updates example-plugin',
      description: 'Check a specific plugin for updates',
    },
    {
      command: 'plugin check-updates --json',
      description: 'Output results in JSON format',
    },
    {
      command: 'plugin check-updates --fetch-changelogs',
      description: 'Fetch changelog metadata for available updates',
    },
  ],
  handler: checkUpdatesHandler,
  builder: (yargs) => {
    return yargs
      .positional('plugin', {
        describe: 'Plugin identifier to check (omit for all)',
        type: 'string',
      })
      .option('json', {
        describe: 'Output in JSON format',
        type: 'boolean',
        default: false,
      })
      .option('fetch-changelogs', {
        describe: 'Fetch changelog metadata for updates',
        type: 'boolean',
        default: true,
      })
      .option('bypass-changelog-cache', {
        describe: 'Force refresh of remote changelogs (ignore cache)',
        type: 'boolean',
        default: false,
      });
  },
};

function createUpdateService(config: Config): UpdateService {
  const cacheAdapter = new CacheAdapter();
  const registryService = new RegistryService(config, cacheAdapter);
  const cacheService = new CacheService(config, cacheAdapter);
  const installService = new InstallService(config, cacheService, registryService);
  const httpAdapter = createHttpAdapter();
  const changelogService = new ChangelogService(config, httpAdapter);

  return new UpdateService(config, registryService, installService, changelogService);
}

function createHttpAdapter(): IHttpAdapter {
  return {
    fetch(urlString, options) {
      return new Promise((resolve) => {
        try {
          const parsed = new URL(urlString);
          const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
          const req = transport(
            {
              method: 'GET',
              hostname: parsed.hostname,
              port: parsed.port || undefined,
              path: `${parsed.pathname}${parsed.search}`,
              timeout: options.timeoutMs,
              headers: {
                'user-agent': 'yellow-plugins-cli/1.1',
                accept: 'text/plain, text/markdown',
              },
            },
            (res) => {
              const chunks: string[] = [];
              let totalBytes = 0;
              res.setEncoding('utf8');
              res.on('data', (chunk: string) => {
                totalBytes += Buffer.byteLength(chunk);
                if (options.maxContentLength && totalBytes > options.maxContentLength) {
                  req.destroy(new Error('Response exceeded configured limit'));
                  res.destroy();
                  resolve({
                    success: false,
                    status: res.statusCode ?? 0,
                    error: 'Response exceeded configured limit',
                  });
                  return;
                }
                chunks.push(chunk);
              });
              res.on('end', () => {
                resolve({
                  success: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400,
                  status: res.statusCode ?? 0,
                  content: chunks.join(''),
                  contentLength:
                    Number.parseInt(res.headers['content-length'] || '', 10) || totalBytes,
                });
              });
            }
          );

          req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
          });
          req.on('error', (error) => {
            resolve({
              success: false,
              status: 0,
              error: (error as Error).message,
            });
          });

          req.end();
        } catch (error) {
          resolve({
            success: false,
            status: 0,
            error: (error as Error).message,
          });
        }
      });
    },
  };
}

function deriveCacheStatus(
  fetched?: number,
  hits?: number
): 'hit' | 'miss' | 'partial' | undefined {
  if (typeof fetched !== 'number') {
    return undefined;
  }

  if (fetched === 0) {
    return 'hit';
  }

  if (!hits || hits === 0) {
    return 'miss';
  }

  if (hits >= fetched) {
    return 'hit';
  }

  return 'partial';
}
