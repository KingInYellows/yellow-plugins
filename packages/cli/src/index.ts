#!/usr/bin/env node

/**
 * @yellow-plugins/cli
 *
 * Minimal CLI for validating plugin schemas.
 * Install/browse/rollback/publish commands have been removed
 * as Claude Code handles those natively. Marketplace validation
 * (validate / validate:marketplace) was retired in R45 — the legacy
 * nested-shape schemas/marketplace.schema.json it validated against was
 * unused in CI; scripts/validate-marketplace.js plus
 * schemas/official-marketplace.schema.json remain the sole marketplace
 * gates.
 *
 * Usage:
 *   pnpm cli validate:plugins  # Run the plugin manifest validator script and exit with its status
 */

import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export const version = '2.0.0';

// Repo root is three levels up from this file (packages/cli/src or
// packages/cli/dist), independent of the caller's working directory.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function main(): Promise<void> {
  const command = process.argv[2] || 'validate:plugins';

  if (command !== 'validate:plugins') {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: pnpm cli validate:plugins');
    process.exit(1);
  }

  const result = spawnSync('node', [join(REPO_ROOT, 'scripts', 'validate-plugin.js')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  process.exit(result.status ?? 1);
}

main();
