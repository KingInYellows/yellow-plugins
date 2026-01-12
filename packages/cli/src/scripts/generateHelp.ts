#!/usr/bin/env tsx
/**
 * @yellow-plugins/cli - Help Documentation Generator Script
 *
 * Generates help-baseline.md from command metadata.
 * Run this script to update the help documentation.
 *
 * Part of Task I1.T4: CLI command manifest
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateHelpBaseline } from '../lib/helpGenerator.js';

// Resolve to project root (../../.. from this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..', '..', '..');
const docsDir = join(projectRoot, 'docs', 'cli');
const outputPath = join(docsDir, 'help-baseline.md');

// Ensure directory exists
mkdirSync(docsDir, { recursive: true });

try {
  const content = generateHelpBaseline();
  writeFileSync(outputPath, content, 'utf-8');
  process.stdout.write(`Generated help documentation: ${outputPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to generate help documentation: ${message}\n`);
  process.exit(1);
}
