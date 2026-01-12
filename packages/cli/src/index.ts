#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { getConfigProvider } from '@yellow-plugins/infrastructure';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { getPreflightBanner } from './bootstrap/flags.js';
import { registerCommands } from './lib/commandLoader.js';

/**
 * @yellow-plugins/cli
 *
 * CLI layer - Command-line interface for the plugin marketplace.
 * This package provides user-facing commands for installing, updating,
 * discovering, and managing Claude Code plugins.
 *
 * Enhanced in Task I1.T2: Configuration and feature-flag system
 * Enhanced in Task I1.T4: CLI command manifest and structured logging
 */

export const version = '1.1.0';

/**
 * Returns the CLI banner text without printing it, making it easy to test.
 */
export function getCliBanner(): string[] {
  try {
    const configProvider = getConfigProvider();
    const config = configProvider.getConfig();
    const flags = configProvider.getFeatureFlags();
    return getPreflightBanner(flags, config, version);
  } catch (error) {
    // Fallback to minimal banner if config loading fails
    return [
      `Yellow Plugins CLI v${version}`,
      'Plugin marketplace for Claude Code',
      '',
      'Warning: Failed to load configuration',
      '',
    ];
  }
}

/**
 * Default CLI runner used when the file is executed directly.
 * Now integrates yargs command routing with feature flag checks.
 */
export async function runCli(): Promise<void> {
  try {
    const configProvider = getConfigProvider();
    const config = configProvider.getConfig();
    const flags = configProvider.getFeatureFlags();

    // Print preflight banner to stderr so it doesn't interfere with structured output
    process.stderr.write(getPreflightBanner(flags, config, version).join('\n') + '\n');

    const rawArgs = hideBin(process.argv);
    const sanitizedArgs = rawArgs.length > 0 && rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

    // Build and execute yargs CLI
    const cli = yargs(sanitizedArgs)
      .scriptName('plugin')
      .version(version)
      .alias('version', 'v')
      .alias('help', 'h')
      .usage('$0 <command> [options]')
      .strict()
      .demandCommand(1, 'You must provide a command')
      .recommendCommands()
      .epilogue('For more information, visit: https://github.com/kingyellow/yellow-plugins')
      .wrap(Math.min(120, process.stdout.columns || 80));

    // Register all commands from the registry
    registerCommands(cli, configProvider);

    // Parse and execute
    await cli.parse();
  } catch (error) {
    // Fallback to minimal output
    console.error(`Yellow Plugins CLI v${version}`);
    console.error('Plugin marketplace for Claude Code');
    console.error('');
    console.error('Error: Failed to initialize CLI');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const isDirectExecution = (() => {
  if (typeof process === 'undefined' || !process.argv) {
    return false;
  }

  try {
    const entryPoint = process.argv[1];
    if (!entryPoint) {
      return false;
    }

    return fileURLToPath(import.meta.url) === entryPoint;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  runCli();
}
