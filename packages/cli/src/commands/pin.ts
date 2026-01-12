/**
 * @yellow-plugins/cli - Pin Command
 *
 * Handles pinning plugins to specific versions to prevent automatic updates.
 * Placeholder implementation for Task I1.T4.
 *
 * Part of Task I1.T4: CLI command manifest
 */

import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface PinOptions extends BaseCommandOptions {
  plugin: string;
  version?: string;
  unpin?: boolean;
}

const pinHandler: CommandHandler<PinOptions> = async (options, context) => {
  const { logger } = context;

  logger.info('Pin command invoked', { options });

  return {
    success: true,
    status: 'not-implemented',
    message: 'Pin command is not yet implemented',
    data: {
      command: 'pin',
      options,
    },
  };
};

export const pinCommand: CommandMetadata<PinOptions> = {
  name: 'pin',
  aliases: ['lock'],
  description: 'Pin a plugin to a specific version',
  usage: 'plugin pin <plugin-id> [--version <version>] [--unpin]',
  requiredFlags: undefined,
  specAnchors: ['FR-008', 'CRIT-008', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-PIN-001', 'ERR-PIN-002'],
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
      description: 'Unpin plugin to allow updates',
    },
  ],
  handler: pinHandler,
  builder: (yargs) => {
    return yargs
      .positional('plugin', {
        describe: 'Plugin identifier to pin',
        type: 'string',
        demandOption: true,
      })
      .option('version', {
        describe: 'Version to pin to (defaults to current)',
        type: 'string',
        alias: 'v',
      })
      .option('unpin', {
        describe: 'Remove version pin',
        type: 'boolean',
        default: false,
      });
  },
};
