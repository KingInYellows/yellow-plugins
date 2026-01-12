#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { getConfigProvider } from '@yellow-plugins/infrastructure';

import { getPreflightBanner, printPreflightBanner } from './bootstrap/flags.js';

/**
 * @yellow-plugins/cli
 *
 * CLI layer - Command-line interface for the plugin marketplace.
 * This package provides user-facing commands for installing, updating,
 * discovering, and managing Claude Code plugins.
 *
 * Enhanced in Task I1.T2: Configuration and feature-flag system
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
 */
export function runCli(): void {
  try {
    const configProvider = getConfigProvider();
    const config = configProvider.getConfig();
    const flags = configProvider.getFeatureFlags();
    printPreflightBanner(flags, config, version);
  } catch (error) {
    // Fallback to minimal output
    console.log(`Yellow Plugins CLI v${version}`);
    console.log('Plugin marketplace for Claude Code');
    console.log('');
    console.log('Warning: Failed to load configuration');
    console.log('');
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
