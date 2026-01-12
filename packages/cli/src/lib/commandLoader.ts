/**
 * @yellow-plugins/cli - Command Loader
 *
 * Loads and registers commands from the registry into yargs.
 * Handles feature flag checks and context injection for command handlers.
 *
 * Part of Task I1.T4: CLI command manifest
 */

import type { IConfigProvider } from '@yellow-plugins/domain';
import type { Argv } from 'yargs';

import { getAllCommands } from '../commands/registry.js';
import type { BaseCommandOptions, CommandContext } from '../types/commands.js';

import { createLogger } from './logger.js';

/**
 * Register all commands from the registry into the yargs instance.
 */
export function registerCommands(cli: Argv, configProvider: IConfigProvider): void {
  const commands = getAllCommands();

  for (const command of commands) {
    cli.command({
      command: buildCommandString(command.name),
      aliases: command.aliases ?? [],
      describe: command.description,
      builder: (yargs) => {
        const withGlobalOptions = applyGlobalOptions(yargs);
        return command.builder ? command.builder(withGlobalOptions) : withGlobalOptions;
      },
      handler: async (argv) => {
        const config = configProvider.getConfig();
        const flags = configProvider.getFeatureFlags();
        const verbose = Boolean(argv['verbose']);
        const logger = createLogger(command.name, verbose);

        const context: CommandContext = {
          config,
          flags,
          correlationId: logger.getContext().correlationId,
          command: command.name,
          startTime: new Date(),
          logger,
        };

        if (command.requiredFlags && command.requiredFlags.length > 0) {
          for (const requiredFlag of command.requiredFlags) {
            if (!flags[requiredFlag]) {
              logger.error(
                `Command '${command.name}' requires feature flag '${requiredFlag}' to be enabled`,
                { requiredFlag, command: command.name }
              );
              process.exit(1);
            }
          }
        }

        try {
          const startTime = Date.now();
          const result = await command.handler(argv as BaseCommandOptions, context);
          const duration = Date.now() - startTime;

          logger.timing('Command completed', duration, {
            success: result.success,
            status: result.status,
          });

          if (!result.success) {
            process.exit(1);
          }
        } catch (error) {
          logger.error('Command failed with uncaught error', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          process.exit(1);
        }
      },
    });
  }
}

/**
 * Build the yargs command string with optional positionals.
 */
function buildCommandString(name: string): string {
  // For commands that have required positionals, they're defined in the builder
  // This just returns the command name
  return name;
}

/**
 * Apply global CLI options to a yargs instance.
 */
function applyGlobalOptions(yargs: Argv): Argv {
  return yargs
    .option('config', {
      describe: 'Path to config file',
      type: 'string',
    })
    .option('flags', {
      describe: 'Path to feature flags file',
      type: 'string',
    })
    .option('input', {
      describe: 'Input file or data',
      type: 'string',
      alias: 'i',
    })
    .option('output', {
      describe: 'Output file or destination',
      type: 'string',
      alias: 'o',
    })
    .option('verbose', {
      describe: 'Enable verbose output',
      type: 'boolean',
      default: false,
    })
    .option('dry-run', {
      describe: 'Simulate without making changes',
      type: 'boolean',
      default: false,
    });
}
