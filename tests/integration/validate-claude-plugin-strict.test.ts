/**
 * Unit checks for scripts/validate-claude-plugin-strict.js (CLAUDE-323):
 * findings come from every section of a `claude plugin validate --json`
 * report, and only entries in the known list are tolerated.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const { collectFindings, classify, targets } = require(
  join(ROOT, 'scripts/validate-claude-plugin-strict.js')
);
const KNOWN = JSON.parse(
  readFileSync(join(ROOT, 'scripts/claude-plugin-validate-known.json'), 'utf8')
).known;

const report = {
  manifest: {
    file: join(ROOT, 'plugins/demo/.claude-plugin/plugin.json'),
    errors: [{ path: 'version', message: 'Invalid version' }],
    warnings: [],
  },
  contents: [
    {
      file: join(ROOT, 'plugins/demo/CLAUDE.md'),
      errors: [],
      warnings: [
        {
          path: 'root',
          message:
            'CLAUDE.md at the plugin root is not loaded as project context. To ship context with your plugin, use a skill instead.',
        },
      ],
    },
  ],
};

describe('validate-claude-plugin-strict', () => {
  it('collects errors and warnings with repo-relative files', () => {
    expect(collectFindings(report, ROOT)).toEqual([
      {
        level: 'error',
        file: 'plugins/demo/.claude-plugin/plugin.json',
        path: 'version',
        message: 'Invalid version',
      },
      expect.objectContaining({
        level: 'warning',
        file: 'plugins/demo/CLAUDE.md',
      }),
    ]);
  });

  it('tolerates the plugin-root CLAUDE.md warning and nothing else', () => {
    const { unknown, knownCount, stale } = classify(
      collectFindings(report, ROOT),
      KNOWN
    );
    expect(knownCount).toBe(1);
    expect(stale).toEqual([]);
    expect(unknown.map((f: { message: string }) => f.message)).toEqual([
      'Invalid version',
    ]);
  });

  it('does not tolerate the same warning for a CLAUDE.md outside a plugin root', () => {
    const moved = collectFindings(report, ROOT).map((f: { file: string }) => ({
      ...f,
      file: f.file.replace(
        'plugins/demo/CLAUDE.md',
        'plugins/demo/skills/x/CLAUDE.md'
      ),
    }));
    const { unknown, stale } = classify(moved, KNOWN);
    expect(unknown).toHaveLength(2);
    expect(stale).toEqual(['plugin-root-claude-md']);
  });

  it('validates the marketplace and every plugin with a manifest', () => {
    const list = targets(ROOT);
    expect(list[0]).toBe('.');
    expect(list).toContain('plugins/yellow-core');
  });
});
