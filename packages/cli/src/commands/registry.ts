/**
 * @yellow-plugins/cli - Command Registry
 *
 * Central registry of all CLI commands with their metadata.
 * This registry drives command registration, help generation, and feature flag checks.
 *
 * Part of Task I1.T4: CLI command manifest
 */

import type { CommandMetadata, CommandRegistry } from '../types/commands.js';

import { browseCommand } from './browse.js';
import { checkUpdatesCommand } from './check-updates.js';
import { installCommand } from './install.js';
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
export const commandRegistry: CommandRegistry = {
  // Core lifecycle commands
  install: installCommand,
  update: updateCommand,
  uninstall: uninstallCommand,

  // Discovery commands
  browse: browseCommand,
  search: searchCommand,

  // Version management
  rollback: rollbackCommand,
  pin: pinCommand,
  'check-updates': checkUpdatesCommand,

  // Publishing
  publish: publishCommand,
};

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
export function getCommandsByCategory(): Record<string, CommandMetadata[]> {
  const {
    install,
    update,
    uninstall,
    browse,
    search,
    rollback,
    pin,
    publish,
  } = commandRegistry;
  const checkUpdates = commandRegistry['check-updates'];

  return {
    'Plugin Lifecycle': [install, update, uninstall],
    'Plugin Discovery': [browse, search],
    'Version Management': [rollback, pin, checkUpdates],
    Publishing: [publish],
  };
}
