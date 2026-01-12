/**
 * @yellow-plugins/cli - Search Command
 *
 * Handles searching for plugins in the marketplace.
 * Implements text search with exact and fuzzy matching.
 *
 * Part of Task I1.T4: CLI command manifest
 * Enhanced in Task I3.T1: Marketplace ingestion & caching
 *
 * @specification FR-002, FR-007, CRIT-007
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

interface SearchOptions extends BaseCommandOptions {
  query: string;
  exact?: boolean;
  category?: string;
  tag?: string;
  limit?: number;
}

/**
 * Search request payload
 */
interface SearchRequest {
  query: string;
  exact?: boolean;
  category?: string;
  tag?: string;
  limit?: number;
  offset?: number;
  correlationId?: string;
}

/**
 * Search response payload
 */
interface SearchResponse {
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

const searchHandler: CommandHandler<SearchOptions> = async (options, context) => {
  const { logger, config, correlationId, startTime } = context;
  const startTimeMs = startTime.getTime();

  logger.info('Search command invoked', { options });

  try {
    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<SearchRequest>(
      options,
      {
        query: options.query,
        exact: options.exact,
        category: options.category,
        tag: options.tag,
        limit: options.limit,
        correlationId,
      },
      context
    );

    // Validate required query field
    if (!request.query || request.query.trim() === '') {
      const errorResponse: SearchResponse = {
        ...buildBaseResponse({ success: false, message: 'Search query is required' }, context),
        error: {
          code: 'ERR-SEARCH-001',
          message: 'Missing required argument: query',
          severity: 'ERROR',
          category: 'VALIDATION',
          specReference: 'FR-002, FR-007',
          resolution: 'Provide a search query string',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    // Initialize validator and marketplace service
    const validator = await createValidator();
    const marketplaceService = new MarketplaceIndexService(validator, logger);

    // Load marketplace index
    const indexPath = path.join(config.pluginDir, 'marketplace.json');
    logger.debug('Loading marketplace index', { indexPath });

    try {
      await marketplaceService.loadIndex(indexPath);
    } catch (error) {
      const errorResponse: SearchResponse = {
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
      query: request.query,
      exact: request.exact ?? false,
      category: request.category as MarketplaceQuery['category'],
      tag: request.tag,
      limit: request.limit ?? 50,
      offset: request.offset ?? 0,
    };

    // Execute search query
    const result = await marketplaceService.search(query);

    logger.info('Search query executed', {
      query: request.query,
      exact: request.exact,
      totalCount: result.totalCount,
      returnedCount: result.plugins.length,
    });

    const endTimeMs = Date.now();
    const durationMs = endTimeMs - startTimeMs;

    // Build response
    const response: SearchResponse = {
      ...buildBaseResponse(
        {
          success: true,
          status: warnings.length > 0 ? 'warning' : 'success',
          message: `Found ${result.totalCount} matching plugin(s)${warnings.length > 0 ? ' (with warnings)' : ''}`,
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

    logger.info('Search command completed', {
      durationMs,
      warnings: warnings.length,
      totalCount: result.totalCount,
    });

    await writeResponse(response, options, context);
    return toCommandResult(response);
  } catch (error) {
    const endTimeMs = Date.now();
    const durationMs = endTimeMs - startTimeMs;

    logger.error('Search command failed', { error, durationMs });

    const errorResponse: SearchResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: `Search failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-SEARCH-999',
        message: (error as Error).message,
        severity: 'ERROR',
        category: 'EXECUTION',
      },
    };

    await writeResponse(errorResponse, options, context);
    return toCommandResult(errorResponse);
  }
};

export const searchCommand: CommandMetadata<SearchOptions> = {
  name: 'search',
  aliases: ['find'],
  description: 'Search for plugins in the marketplace',
  usage: 'plugin search <query> [--exact]',
  requiredFlags: undefined,
  specAnchors: ['FR-007', 'CRIT-007', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-SEARCH-001', 'ERR-SEARCH-002'],
  examples: [
    {
      command: 'plugin search "code formatter"',
      description: 'Search for plugins matching the query',
    },
    {
      command: 'plugin search linter --exact',
      description: 'Search for exact matches only',
    },
  ],
  handler: searchHandler,
  builder: (yargs) => {
    return yargs
      .positional('query', {
        describe: 'Search query',
        type: 'string',
        demandOption: true,
      })
      .option('exact', {
        describe: 'Match query exactly (no fuzzy matching)',
        type: 'boolean',
        default: false,
      })
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
      .option('limit', {
        describe: 'Maximum number of results to display',
        type: 'number',
        alias: 'l',
        default: 50,
      });
  },
};
