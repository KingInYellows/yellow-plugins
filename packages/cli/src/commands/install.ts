/**
 * @yellow-plugins/cli - Install Command
 *
 * Handles plugin installation operations with JSON contract support.
 * Updated for Task I2.T4: CLI Contract Catalog implementation.
 *
 * Part of Task I1.T4: CLI command manifest
 * Part of Task I2.T4: CLI contract catalog and I/O helpers
 *
 * @specification docs/contracts/cli-contracts.md#install-contract
 * @schema api/cli-contracts/install.json
 */

import {
  loadRequest,
  writeResponse,
  toCommandResult,
  buildBaseResponse,
  buildCompatibilityIntent,
} from '../lib/io.js';
import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface InstallOptions extends BaseCommandOptions {
  plugin?: string;
  version?: string;
  force?: boolean;
}

/**
 * Install request payload matching api/cli-contracts/install.json schema.
 */
interface InstallRequest {
  pluginId: string;
  version?: string;
  force?: boolean;
  compatibilityIntent: {
    nodeVersion: string;
    os: string;
    arch: string;
    claudeVersion?: string;
  };
  skipLifecycle?: boolean;
  lifecycleConsent?: Array<{
    scriptType: string;
    digest: string;
    consentedAt: string;
  }>;
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
 * Install response payload matching api/cli-contracts/install.json schema.
 */
interface InstallResponse {
  success: boolean;
  status: 'success' | 'error' | 'dry-run' | 'partial';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    pluginId: string;
    version: string;
    installState: 'active' | 'staged' | 'failed';
    cachePath: string;
    symlinkTarget?: string;
    registryDelta?: {
      added: string[];
      modified: string[];
    };
    lifecycleScripts?: Array<{
      scriptType: string;
      exitCode: number;
      durationMs: number;
      digest: string;
    }>;
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
    bytesDownloaded?: number;
    lifecycleScriptsRun?: number;
    registryMutations?: number;
  };
}

const installHandler: CommandHandler<InstallOptions> = async (options, context) => {
  const { logger, correlationId, startTime } = context;
  const startTimeMs = startTime.getTime();

  logger.info('Install command invoked', { pluginId: options.plugin, version: options.version });

  try {
    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<InstallRequest>(
      options,
      {
        pluginId: options.plugin!,
        version: options.version,
        force: options.force,
        compatibilityIntent: buildCompatibilityIntent(),
        correlationId,
        dryRun: options.dryRun,
      },
      context
    );

    // Validate required fields
    if (!request.pluginId) {
      const errorResponse: InstallResponse = {
        ...buildBaseResponse({ success: false, message: 'Plugin ID is required' }, context),
        error: {
          code: 'ERR-INSTALL-001',
          message: 'Missing required argument: plugin',
          severity: 'ERROR',
          category: 'VALIDATION',
          specReference: 'FR-001, CRIT-001',
          resolution: 'Provide pluginId in JSON input or as CLI argument',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    logger.info('Install request prepared', { request });

    // TODO: Call installService.install(request)
    // For now, return placeholder response demonstrating contract structure
    // const installResult = await installService.install(request);

    const endTimeMs = new Date().getTime();
    const durationMs = endTimeMs - startTimeMs;

    // Build response following api/cli-contracts/install.json schema
    const response: InstallResponse = {
      ...buildBaseResponse(
        {
          success: true,
          status: request.dryRun ? 'dry-run' : 'success',
          message: `Install handler ready for ${request.pluginId}${request.version ? `@${request.version}` : ''} (service wiring pending)`,
        },
        context
      ),
      data: {
        pluginId: request.pluginId,
        version: request.version || 'latest',
        installState: request.dryRun ? 'staged' : 'active',
        cachePath: `.claude-plugin/cache/${request.pluginId}-${request.version || 'latest'}`,
        symlinkTarget: `.claude-plugin/plugins/${request.pluginId}`,
        registryDelta: {
          added: [request.pluginId],
          modified: [],
        },
        flagEvaluations: {
          flags: context.flags as unknown as Record<string, boolean>,
          source: 'config',
          appliedFlags: [],
        },
      },
      telemetry: {
        durationMs,
        cacheStatus: 'miss',
        bytesDownloaded: 0,
        lifecycleScriptsRun: 0,
        registryMutations: request.dryRun ? 0 : 1,
      },
    };

    // Write response to JSON output if requested
    await writeResponse(response, options, context);

    // Return CLI-compatible result
    return toCommandResult(response);
  } catch (error) {
    logger.error('Install command failed', { error });

    const endTimeMs = new Date().getTime();
    const durationMs = endTimeMs - startTimeMs;

    const errorResponse: InstallResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: `Installation failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-INSTALL-999',
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

export const installCommand: CommandMetadata<InstallOptions> = {
  name: 'install',
  aliases: ['i', 'add'],
  description: 'Install a plugin from the marketplace',
  usage: 'plugin install <plugin-id> [--version <version>] [--force]',
  requiredFlags: undefined, // No feature flag required for install
  specAnchors: ['FR-001', 'CRIT-001', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-INSTALL-001', 'ERR-INSTALL-002', 'ERR-COMPAT-001'],
  examples: [
    {
      command: 'plugin install example-plugin',
      description: 'Install the latest version of example-plugin',
    },
    {
      command: 'plugin install example-plugin --version 1.2.3',
      description: 'Install a specific version',
    },
    {
      command: 'plugin install example-plugin --force',
      description: 'Force reinstall even if already installed',
    },
  ],
  handler: installHandler,
  builder: (yargs) => {
    return yargs
      .positional('plugin', {
        describe: 'Plugin identifier to install',
        type: 'string',
      })
      .option('version', {
        describe: 'Specific version to install',
        type: 'string',
        alias: 'v',
      })
      .option('force', {
        describe: 'Force reinstall if already installed',
        type: 'boolean',
        default: false,
      });
  },
};
