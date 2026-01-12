#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

/**
 * @yellow-plugins/cli
 *
 * CLI layer - Command-line interface for the plugin marketplace.
 * This package provides user-facing commands for installing, updating,
 * discovering, and managing Claude Code plugins.
 *
 * Part of Task I1.T1: Bootstrap pnpm workspace
 */

const bannerLines = [
  'Yellow Plugins CLI v1.1.0',
  'Plugin marketplace for Claude Code',
  '',
  'Setup complete. CLI commands will be implemented in future iterations.',
];

export const version = '1.1.0';

/**
 * Returns the CLI banner text without printing it, making it easy to test.
 */
export function getCliBanner(): string[] {
  return [...bannerLines];
}

/**
 * Default CLI runner used when the file is executed directly.
 */
export function runCli(): void {
  for (const line of bannerLines) {
    console.log(line);
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
