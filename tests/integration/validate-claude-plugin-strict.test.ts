/**
 * Unit checks for scripts/validate-claude-plugin-strict.js (CLAUDE-323):
 * findings come from every section of a `claude plugin validate --json`
 * report, and only entries in the known list are tolerated. main() runs
 * against a fake `claude` binary for the exit and output cases (CLAUDE-373).
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const { collectFindings, classify, targets, main } = require(
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

  it('reports an error outside manifest and contents as an error', () => {
    const found = collectFindings(
      {
        ...report,
        target: join(ROOT, 'plugins/demo/.claude-plugin/plugin.json'),
        error: 'validator crashed',
        hosts: { errors: [{ message: 'unknown host' }] },
      },
      ROOT
    );
    expect(found).toEqual(
      expect.arrayContaining([
        {
          level: 'error',
          file: 'plugins/demo/.claude-plugin/plugin.json',
          path: 'error',
          message: 'validator crashed',
        },
        {
          level: 'error',
          file: 'plugins/demo/.claude-plugin/plugin.json',
          path: 'hosts.errors',
          message: 'unknown host',
        },
      ])
    );
    expect(found).toHaveLength(4);
  });

  it('validates the marketplace and every plugin with a manifest', () => {
    const list = targets(ROOT);
    expect(list[0]).toBe('.');
    expect(list).toContain('plugins/yellow-core');
  });
});

describe('validate-claude-plugin-strict main()', () => {
  // A tree with the marketplace and one plugin, and a fake `claude` that
  // answers each target from cases.json: { "<target>": { status, report } }.
  // A report of null prints non-JSON output.
  const tmp = mkdtempSync(join(tmpdir(), 'strict-main-'));
  const root = join(tmp, 'repo');
  mkdirSync(join(root, 'plugins', 'demo', '.claude-plugin'), {
    recursive: true,
  });
  writeFileSync(
    join(root, 'plugins', 'demo', '.claude-plugin', 'plugin.json'),
    '{}'
  );
  const casesFile = join(tmp, 'cases.json');
  const bin = join(tmp, 'claude');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('9.9.9 (fake)'); process.exit(0); }
const c = JSON.parse(fs.readFileSync(${JSON.stringify(casesFile)}, 'utf8'))[args[args.length - 1]];
process.stdout.write(c.report === null ? 'boom' : JSON.stringify(c.report));
process.exit(c.status);
`
  );
  chmodSync(bin, 0o755);
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const knownWarning = (file: string) => ({
    manifest: { file: join(root, file), errors: [], warnings: [] },
    contents: [
      {
        file: join(root, 'plugins/demo/CLAUDE.md'),
        errors: [],
        warnings: [
          {
            path: 'root',
            message:
              'CLAUDE.md at the plugin root is not loaded as project context.',
          },
        ],
      },
    ],
  });
  const clean = (file: string) => ({
    manifest: { file: join(root, file), errors: [], warnings: [] },
    contents: [],
  });

  let log: string[];
  beforeEach(() => {
    log = [];
    const keep = (...a: unknown[]) => log.push(a.join(' '));
    vi.spyOn(console, 'log').mockImplementation(keep);
    vi.spyOn(console, 'error').mockImplementation(keep);
  });
  afterEach(() => vi.restoreAllMocks());

  function run(cases: Record<string, { status: number; report: unknown }>) {
    writeFileSync(casesFile, JSON.stringify(cases));
    return main(['--claude', bin], { root });
  }

  it('passes when every target is clean', () => {
    expect(
      run({
        '.': { status: 0, report: clean('.claude-plugin/marketplace.json') },
        'plugins/demo': {
          status: 0,
          report: clean('plugins/demo/.claude-plugin/plugin.json'),
        },
      })
    ).toBe(0);
    expect(log.join('\n')).toContain('Using');
    expect(log.join('\n')).toContain('9.9.9 (fake)');
  });

  it('passes a strict exit 1 explained by a known warning', () => {
    expect(
      run({
        '.': { status: 0, report: clean('.claude-plugin/marketplace.json') },
        'plugins/demo': {
          status: 1,
          report: knownWarning('plugins/demo/.claude-plugin/plugin.json'),
        },
      })
    ).toBe(0);
    expect(log.join('\n')).toContain('1 known, 0 new');
  });

  it('fails a nonzero exit with nothing listed', () => {
    expect(
      run({
        '.': { status: 2, report: clean('.claude-plugin/marketplace.json') },
        'plugins/demo': {
          status: 0,
          report: clean('plugins/demo/.claude-plugin/plugin.json'),
        },
      })
    ).toBe(1);
    expect(log.join('\n')).toContain(
      '.: validator exited 2 with no error or warning listed'
    );
  });

  it('fails an error outside manifest and contents even beside a known warning', () => {
    expect(
      run({
        '.': { status: 0, report: clean('.claude-plugin/marketplace.json') },
        'plugins/demo': {
          status: 1,
          report: {
            ...knownWarning('plugins/demo/.claude-plugin/plugin.json'),
            target: join(root, 'plugins/demo/.claude-plugin/plugin.json'),
            error: 'could not load hooks',
          },
        },
      })
    ).toBe(1);
    expect(log.join('\n')).toContain(
      '::error file=plugins/demo/.claude-plugin/plugin.json::error (error): could not load hooks'
    );
  });

  it('fails an unknown warning', () => {
    const r = clean('plugins/demo/.claude-plugin/plugin.json');
    r.manifest.warnings = [{ path: 'name', message: 'odd name' }] as never[];
    expect(
      run({
        '.': { status: 0, report: clean('.claude-plugin/marketplace.json') },
        'plugins/demo': { status: 1, report: r },
      })
    ).toBe(1);
    expect(log.join('\n')).toContain('0 known, 1 new');
  });

  it('throws when the validator prints no JSON', () => {
    expect(() =>
      run({
        '.': { status: 1, report: null },
        'plugins/demo': { status: 0, report: clean('x') },
      })
    ).toThrow(/\.: validator printed no JSON report \(exit 1\)/);
  });

  it('warns about a known entry that matched nothing', () => {
    run({
      '.': { status: 0, report: clean('.claude-plugin/marketplace.json') },
      'plugins/demo': {
        status: 0,
        report: clean('plugins/demo/.claude-plugin/plugin.json'),
      },
    });
    expect(log.join('\n')).toContain(
      'known difference "plugin-root-claude-md" no longer occurs'
    );
  });

  it('rejects an unknown argument', () => {
    expect(main(['--bogus'], { root })).toBe(2);
  });
});
