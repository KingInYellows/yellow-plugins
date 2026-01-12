/**
 * @yellow-plugins/cli - Pin Command
 *
 * Handles pinning plugins to specific versions to prevent cache eviction.
 * Implements pin/unpin operations with registry and cache coordination.
 *
 * Part of Task I3.T3: Pin management implementation
 *
 * @specification docs/contracts/cli-contracts.md#pin-contract
 */

import { PinService, CacheService, RegistryService } from '@yellow-plugins/domain';
import { CacheAdapter } from '@yellow-plugins/infrastructure';

import {
  loadRequest,
  writeResponse,
  toCommandResult,
  buildBaseResponse,
} from '../lib/io.js';
import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface PinOptions extends BaseCommandOptions {
  plugin: string;
  version?: string;
  unpin?: boolean;
  list?: boolean;
}

/**
 * Pin request payload.
 */
interface PinRequest {
  pluginId: string;
  version?: string;
  action: 'pin' | 'unpin' | 'list';
  correlationId?: string;
}

/**
 * Pin response payload.
 */
interface PinResponse {
  success: boolean;
  status: 'success' | 'error' | 'no-op';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    pluginId?: string;
    version?: string;
    action: 'pin' | 'unpin' | 'list';
    isPinned?: boolean;
    pins?: Array<{
      pluginId: string;
      version: string;
      installedAt: string;
      isCached: boolean;
      cachePath: string;
    }>;
  };
  error?: {
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
    category: string;
    specReference?: string;
    resolution?: string;
  };
}

const pinHandler: CommandHandler<PinOptions> = async (options, context) => {
  const { logger, correlationId } = context;

  logger.info('Pin command invoked', {
    pluginId: options.plugin,
    version: options.version,
    unpin: options.unpin,
    list: options.list,
  });

  try {
    // Determine action
    let action: 'pin' | 'unpin' | 'list' = 'pin';
    if (options.list) {
      action = 'list';
    } else if (options.unpin) {
      action = 'unpin';
    }

    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<PinRequest>(
      options,
      {
        pluginId: options.plugin || '',
        version: options.version,
        action,
        correlationId,
      },
      context
    );

    // Initialize services using context config
    const adapter = new CacheAdapter();
    const cacheService = new CacheService(context.config, adapter);
    const registryService = new RegistryService(context.config, adapter);
    const pinService = new PinService(registryService, cacheService);

    // Handle list action
    if (request.action === 'list') {
      const pins = await pinService.listPins();

      const response: PinResponse = {
        ...buildBaseResponse(
          {
            success: true,
            message: pins.length > 0
              ? `Found ${pins.length} pinned plugin(s)`
              : 'No pinned plugins',
          },
          context
        ),
        data: {
          action: 'list',
          pins: pins.map((pin) => ({
            pluginId: pin.pluginId,
            version: pin.version,
            installedAt: pin.installedAt.toISOString(),
            isCached: pin.isCached,
            cachePath: pin.cachePath,
          })),
        },
      };

      await writeResponse(response, options, context);
      return toCommandResult(response);
    }

    // Validate plugin ID for pin/unpin actions
    if (!request.pluginId) {
      const errorResponse: PinResponse = {
        ...buildBaseResponse(
          { success: false, message: 'Plugin ID is required' },
          context
        ),
        error: {
          code: 'ERR-PIN-001',
          message: 'Missing required argument: plugin',
          severity: 'ERROR',
          category: 'VALIDATION',
          specReference: 'FR-007, CRIT-002',
          resolution: 'Provide pluginId in JSON input or as CLI argument',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    // Execute pin or unpin action
    const result = request.action === 'pin'
      ? await pinService.pinPlugin(request.pluginId, request.version)
      : await pinService.unpinPlugin(request.pluginId);

    if (!result.success) {
      const errorResponse: PinResponse = {
        ...buildBaseResponse(
          { success: false, message: result.error?.message || 'Pin operation failed' },
          context
        ),
        data: {
          pluginId: request.pluginId,
          version: request.version,
          action: request.action,
        },
        error: {
          code: result.error?.code || 'ERR-PIN-002',
          message: result.error?.message || 'Unknown error',
          severity: 'ERROR',
          category: 'OPERATION',
          specReference: 'FR-007',
          resolution: result.error?.code === 'PLUGIN_NOT_FOUND'
            ? 'Install the plugin before pinning it'
            : result.error?.code === 'VERSION_NOT_CACHED'
            ? 'Install the specified version before pinning it'
            : 'Check error details and retry',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    // Success response
    const successResponse: PinResponse = {
      ...buildBaseResponse(
        {
          success: true,
          message: result.wasNoOp
            ? `Plugin ${request.pluginId} was already ${request.action === 'pin' ? 'pinned' : 'unpinned'}`
            : `Successfully ${request.action === 'pin' ? 'pinned' : 'unpinned'} plugin ${request.pluginId}`,
        },
        context
      ),
      status: result.wasNoOp ? 'no-op' : 'success',
      data: {
        pluginId: result.pluginId,
        version: result.version,
        action: request.action,
        isPinned: request.action === 'pin',
      },
    };

    await writeResponse(successResponse, options, context);

    // Log pin state for user feedback
    if (!result.wasNoOp) {
      logger.info(
        `Pin state updated: ${request.pluginId}@${result.version || 'current'} is now ${request.action === 'pin' ? 'pinned' : 'unpinned'}`,
        { pluginId: result.pluginId, version: result.version, action: request.action }
      );
    }

    return toCommandResult(successResponse);
  } catch (error) {
    logger.error('Pin command failed with unexpected error', { error });

    const errorResponse: PinResponse = {
      ...buildBaseResponse(
        { success: false, message: `Pin command failed: ${(error as Error).message}` },
        context
      ),
      error: {
        code: 'ERR-PIN-003',
        message: (error as Error).message,
        severity: 'ERROR',
        category: 'INTERNAL',
        specReference: 'FR-007',
      },
    };

    await writeResponse(errorResponse, options, context);
    return toCommandResult(errorResponse);
  }
};

export const pinCommand: CommandMetadata<PinOptions> = {
  name: 'pin',
  aliases: ['lock'],
  description: 'Pin a plugin to prevent cache eviction',
  usage: 'plugin pin <plugin-id> [--version <version>] [--unpin] [--list]',
  requiredFlags: undefined,
  specAnchors: ['FR-007', 'CRIT-002', '3-4-data-persistence'],
  errorCodes: ['ERR-PIN-001', 'ERR-PIN-002', 'ERR-PIN-003'],
  examples: [
    {
      command: 'plugin pin example-plugin',
      description: 'Pin plugin to current version',
    },
    {
      command: 'plugin pin example-plugin --version 1.2.3',
      description: 'Pin plugin to a specific version',
    },
    {
      command: 'plugin pin example-plugin --unpin',
      description: 'Unpin plugin to allow cache eviction',
    },
    {
      command: 'plugin pin --list',
      description: 'List all pinned plugins',
    },
  ],
  handler: pinHandler,
  builder: (yargs) => {
    return yargs
      .positional('plugin', {
        describe: 'Plugin identifier to pin',
        type: 'string',
        demandOption: false,
      })
      .option('version', {
        describe: 'Version to pin to (defaults to installed version)',
        type: 'string',
        alias: 'v',
      })
      .option('unpin', {
        describe: 'Remove version pin',
        type: 'boolean',
        default: false,
      })
      .option('list', {
        describe: 'List all pinned plugins',
        type: 'boolean',
        alias: 'l',
        default: false,
      });
  },
};
