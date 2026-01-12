/**
 * @yellow-plugins/cli - Command Registry
 *
 * Central registry of all CLI commands with their metadata.
 * This registry drives command registration, help generation, and feature flag checks.
 *
 * Part of Task I1.T4: CLI command manifest
 */

import type {
  BaseCommandOptions,
  CommandMetadata,
  CommandRegistry,
} from '../types/commands.js';

import { browseCommand } from './browse.js';
import { checkUpdatesCommand } from './check-updates.js';
import { installCommand } from './install.js';
import { metricsCommand } from './metrics.js';
import { pinCommand } from './pin.js';
import { publishCommand } from './publish.js';
import { rollbackCommand } from './rollback.js';
import { searchCommand } from './search.js';
import { uninstallCommand } from './uninstall.js';
import { updateCommand } from './update.js';

/**
 * Central command registry mapping command names to their metadata.
 * Order defines the display order in help output.
 */
const toBaseMetadata = <T extends BaseCommandOptions>(
  metadata: CommandMetadata<T>
): CommandMetadata => metadata as CommandMetadata;

const commandRegistryDefinition = {
  // Core lifecycle commands
  install: toBaseMetadata(installCommand),
  update: toBaseMetadata(updateCommand),
  uninstall: toBaseMetadata(uninstallCommand),

  // Discovery commands
  browse: toBaseMetadata(browseCommand),
  search: toBaseMetadata(searchCommand),

  // Version management
  rollback: toBaseMetadata(rollbackCommand),
  pin: toBaseMetadata(pinCommand),
  'check-updates': toBaseMetadata(checkUpdatesCommand),

  // Publishing
  publish: toBaseMetadata(publishCommand),

  // Observability
  metrics: toBaseMetadata(metricsCommand),
} as const satisfies CommandRegistry;

export const commandRegistry: CommandRegistry = commandRegistryDefinition;

/**
 * Get all registered commands as an array.
 */
export function getAllCommands(): CommandMetadata[] {
  return Object.values(commandRegistry);
}

/**
 * Get a command by name or alias.
 */
export function getCommand(nameOrAlias: string): CommandMetadata | undefined {
  // Direct lookup
  if (commandRegistry[nameOrAlias]) {
    return commandRegistry[nameOrAlias];
  }

  // Search by alias
  return Object.values(commandRegistry).find(
    (cmd) => cmd.aliases?.includes(nameOrAlias)
  );
}

/**
 * Get commands grouped by category for help display.
 */
type RegisteredCommand = keyof typeof commandRegistryDefinition;

const requireRegisteredCommand = (name: RegisteredCommand): CommandMetadata => {
  const command = commandRegistry[name];
  if (!command) {
    throw new Error(`Command "${name}" is not registered.`);
  }
  return command;
};

export function getCommandsByCategory(): Record<string, CommandMetadata[]> {
  const categories: Record<string, RegisteredCommand[]> = {
    'Plugin Lifecycle': ['install', 'update', 'uninstall'],
    'Plugin Discovery': ['browse', 'search'],
    'Version Management': ['rollback', 'pin', 'check-updates'],
    Publishing: ['publish'],
    Observability: ['metrics'],
  };

  const grouped: Record<string, CommandMetadata[]> = {};

  for (const [category, keys] of Object.entries(categories)) {
    grouped[category] = keys.map((key) => requireRegisteredCommand(key));
  }

  return grouped;
}
