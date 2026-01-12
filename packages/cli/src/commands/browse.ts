/**
 * @yellow-plugins/cli - Browse Command
 *
 * Handles browsing and discovering plugins in the marketplace.
 * Implements deterministic ranking and offline-first caching.
 *
 * Part of Task I1.T4: CLI command manifest
 * Enhanced in Task I3.T1: Marketplace ingestion & caching
 *
 * @specification FR-001, FR-002, FR-006, CRIT-006
 */

import * as path from 'node:path';

import { MarketplaceIndexService, type MarketplaceQuery } from '@yellow-plugins/domain';
import { createValidator } from '@yellow-plugins/infrastructure';

import {
  loadRequest,
  writeResponse,
  toCommandResult,
  buildBaseResponse,
} from '../lib/io.js';
import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface BrowseOptions extends BaseCommandOptions {
  category?: string;
  tag?: string;
  limit?: number;
  featured?: boolean;
  verified?: boolean;
}

/**
 * Browse request payload
 */
interface BrowseRequest {
  category?: string;
  tag?: string;
  limit?: number;
  offset?: number;
  featured?: boolean;
  verified?: boolean;
  correlationId?: string;
}

/**
 * Browse response payload
 */
interface BrowseResponse {
  success: boolean;
  status: 'success' | 'error' | 'warning';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    plugins: Array<{
      id: string;
      name: string;
      version: string;
      author?: string;
      description?: string;
      category: string;
      tags?: string[];
      featured?: boolean;
      verified?: boolean;
    }>;
    totalCount: number;
    query: MarketplaceQuery;
  };
  warnings?: string[];
  error?: {
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
    category: string;
    specReference?: string;
    resolution?: string;
  };
}

const browseHandler: CommandHandler<BrowseOptions> = async (options, context) => {
  const { logger, config, correlationId, startTime } = context;
  const startTimeMs = startTime.getTime();

  logger.info('Browse command invoked', { options });

  try {
    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<BrowseRequest>(
      options,
      {
        category: options.category,
        tag: options.tag,
        limit: options.limit,
        featured: options.featured,
        verified: options.verified,
        correlationId,
      },
      context
    );

    // Initialize validator and marketplace service
    const validator = await createValidator();
    const marketplaceService = new MarketplaceIndexService(validator, logger);

    // Load marketplace index
    const indexPath = path.join(config.pluginDir, 'marketplace.json');
    logger.debug('Loading marketplace index', { indexPath });

    try {
      await marketplaceService.loadIndex(indexPath);
    } catch (error) {
      const errorResponse: BrowseResponse = {
        ...buildBaseResponse({ success: false, message: 'Failed to load marketplace index' }, context),
        error: {
          code: 'ERR-DISC-001',
          message: (error as Error).message,
          severity: 'ERROR',
          category: 'DISCOVERY',
          specReference: 'FR-001, FR-002',
          resolution: 'Run marketplace generator to create/update the index, or check that marketplace.json exists in the plugin directory',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    // Check index freshness
    const freshness = await marketplaceService.checkFreshness(indexPath);
    const warnings: string[] = [];

    if (freshness.stale) {
      const ageHours = Math.floor(freshness.ageMs! / (1000 * 60 * 60));
      warnings.push(
        `Marketplace index is stale (${ageHours} hours old). Run marketplace generator to refresh.`
      );
      logger.warn('Marketplace index is stale', { ageHours });
    }

    if (freshness.integrityStatus === 'invalid') {
      warnings.push(
        'Marketplace index content hash mismatch detected. Regenerate marketplace.json to restore integrity.'
      );
      logger.warn('Marketplace index integrity check failed');
    }

    if (freshness.signatureStatus === 'invalid') {
      warnings.push(
        'Marketplace index signature mismatch detected. Fetch the latest marketplace repo or rerun the generator to re-sign the index.'
      );
      logger.warn('Marketplace index signature verification failed');
    }

    // Build query
    const query: MarketplaceQuery = {
      category: request.category as MarketplaceQuery['category'],
      tag: request.tag,
      featured: request.featured,
      verified: request.verified,
      limit: request.limit ?? 50,
      offset: request.offset ?? 0,
    };

    // Execute browse query
    const result = await marketplaceService.browse(query);

    logger.info('Browse query executed', {
      totalCount: result.totalCount,
      returnedCount: result.plugins.length,
      query,
    });

    const endTimeMs = Date.now();
    const durationMs = endTimeMs - startTimeMs;

    // Build response
    const response: BrowseResponse = {
      ...buildBaseResponse(
        {
          success: true,
          status: warnings.length > 0 ? 'warning' : 'success',
          message: `Found ${result.totalCount} plugin(s)${warnings.length > 0 ? ' (with warnings)' : ''}`,
        },
        context
      ),
      data: {
        plugins: result.plugins,
        totalCount: result.totalCount,
        query: result.query,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    logger.info('Browse command completed', {
      durationMs,
      warnings: warnings.length,
      totalCount: result.totalCount,
    });

    await writeResponse(response, options, context);
    return toCommandResult(response);
  } catch (error) {
    const endTimeMs = Date.now();
    const durationMs = endTimeMs - startTimeMs;

    logger.error('Browse command failed', { error, durationMs });

    const errorResponse: BrowseResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: `Browse failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-BROWSE-999',
        message: (error as Error).message,
        severity: 'ERROR',
        category: 'EXECUTION',
      },
    };

    await writeResponse(errorResponse, options, context);
    return toCommandResult(errorResponse);
  }
};

export const browseCommand: CommandMetadata<BrowseOptions> = {
  name: 'browse',
  aliases: ['list', 'ls'],
  description: 'Browse available plugins in the marketplace',
  usage: 'plugin browse [--category <cat>] [--tag <tag>] [--limit <n>]',
  requiredFlags: ['enableBrowse'],
  specAnchors: ['FR-006', 'CRIT-006', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-DISC-001', 'ERR-BROWSE-999'],
  examples: [
    {
      command: 'plugin browse',
      description: 'List all available plugins',
    },
    {
      command: 'plugin browse --category productivity',
      description: 'Browse plugins in a specific category',
    },
    {
      command: 'plugin browse --tag ai --limit 10',
      description: 'Browse plugins with a specific tag, limited to 10 results',
    },
  ],
  handler: browseHandler,
  builder: (yargs) => {
    return yargs
      .option('category', {
        describe: 'Filter by plugin category',
        type: 'string',
        alias: 'c',
      })
      .option('tag', {
        describe: 'Filter by plugin tag',
        type: 'string',
        alias: 't',
      })
      .option('featured', {
        describe: 'Show only featured plugins',
        type: 'boolean',
      })
      .option('verified', {
        describe: 'Show only verified plugins',
        type: 'boolean',
      })
      .option('limit', {
        describe: 'Maximum number of results to display',
        type: 'number',
        alias: 'l',
        default: 50,
      });
  },
};
