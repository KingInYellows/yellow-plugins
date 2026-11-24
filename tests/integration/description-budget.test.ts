/**
 * Unit-level tests for scripts/lib/description-budget.js BOM handling
 * and kind coverage (command, agent, skill) without going through the CLI.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import YAML from 'yaml';

const require = createRequire(import.meta.url);
const {
  collectDescriptionBudget,
  formatBomError,
  hasLeadingBom,
} = require('../../scripts/lib/description-budget.js');

function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match ? match[1] : null;
}

function parseFrontmatter(frontmatter: string) {
  try {
    return YAML.parse(frontmatter);
  } catch {
    return null;
  }
}

function collect(pluginsDir: string, files: string[], pluginNames: string[]) {
  return collectDescriptionBudget({
    pluginsDir,
    pluginNames,
    files,
    extractFrontmatter,
    parseFrontmatter,
  });
}

describe('description-budget BOM handling', () => {
  it('detects a leading UTF-8 BOM and formats the path-stable error', () => {
    expect(hasLeadingBom('\uFEFF---\nname: x\n---\n')).toBe(true);
    expect(hasLeadingBom('---\nname: x\n---\n')).toBe(false);
    expect(hasLeadingBom('')).toBe(false);
    expect(hasLeadingBom(undefined)).toBe(false);
    expect(formatBomError('alpha/commands/demo/cmd.md')).toContain(
      'alpha/commands/demo/cmd.md: leading UTF-8 BOM'
    );
  });

  let root: string;
  let pluginsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'description-budget-'));
    pluginsDir = join(root, 'plugins');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRel(relPath: string, body: string): string {
    const abs = join(pluginsDir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    return abs;
  }

  it.each([
    [
      'commands',
      'alpha/commands/demo/cmd.md',
      '\uFEFF---\nname: demo:cmd\ndescription: abcdefghij\n---\n\nBody.\n',
    ],
    [
      'agents',
      'alpha/agents/demo-agent.md',
      '\uFEFF---\nname: demo-agent\ndescription: abcdefghij\n---\n\nBody.\n',
    ],
    [
      'skills',
      'alpha/skills/demo-skill/SKILL.md',
      '\uFEFF---\nname: demo-skill\ndescription: abcdefghij\n---\n\nBody.\n',
    ],
  ])('records a bom issue for a %s file and does not count it', (kind, relPath, body) => {
    const filePath = writeRel(relPath, body);
    const budget = collect(pluginsDir, [filePath], ['alpha']);
    expect(budget.plugins.alpha).toBe(0);
    expect(budget.kinds[kind]).toBe(0);
    expect(budget.issues).toEqual([
      { filePath, kind, reason: 'bom' },
    ]);
  });

  it('classifies an overlapping commands/agents path once, under commands', () => {
    const filePath = writeRel(
      'alpha/commands/demo/agents/both.md',
      '\uFEFF---\nname: both\ndescription: abcdefghij\n---\n\nBody.\n'
    );
    const budget = collect(pluginsDir, [filePath, filePath], ['alpha']);
    expect(budget.issues).toEqual([
      { filePath, kind: 'commands', reason: 'bom' },
    ]);
  });
});
