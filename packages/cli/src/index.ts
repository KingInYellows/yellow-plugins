#!/usr/bin/env node

/**
 * @yellow-plugins/cli
 *
 * Minimal CLI for validating marketplace and plugin schemas.
 * Install/browse/rollback/publish commands have been removed
 * as Claude Code handles those natively.
 *
 * Usage:
 *   pnpm cli validate              # Validate .claude-plugin/marketplace.json
 *   pnpm cli validate:marketplace  # Validate only marketplace.json
 *   pnpm cli validate:plugins      # Show how to run the plugin manifest validator script
 */

import { createValidator } from '@yellow-plugins/infrastructure';

export const version = '2.0.0';

async function main(): Promise<void> {
  const command = process.argv[2] || 'validate';

  if (!['validate', 'validate:marketplace', 'validate:plugins'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: pnpm cli validate | pnpm cli validate:marketplace | pnpm cli validate:plugins');
    process.exit(1);
  }

  try {
    if (command === 'validate' || command === 'validate:marketplace') {
      const validator = await createValidator();
      const { readFileSync } = await import('fs');
      const { resolve } = await import('path');

      const marketplacePath = resolve(process.cwd(), '.claude-plugin/marketplace.json');
      const data = JSON.parse(readFileSync(marketplacePath, 'utf-8'));
      const result = validator.validateMarketplace(data);

      console.log(`Marketplace: ${result.status}`);
      if (result.errors.length > 0) {
        result.errors.forEach(e => console.error(`  [${e.code}] ${e.path}: ${e.message}`));
        process.exitCode = 1;
      }
    }
    if (command === 'validate' || command === 'validate:plugins') {
      console.log('\nPlugin validation delegated to: node scripts/validate-plugin.js');
    }
  } catch (error) {
    console.error('Validation failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
