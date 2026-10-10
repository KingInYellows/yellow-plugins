import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = resolve(
  __dirname,
  '../../scripts/smoke-codex-skill-activation.js'
);
const { assess, allowedRead, modelReadPath } = createRequire(import.meta.url)(
  script
);
const skill = { path: '/scratch/plugins/plan-status/SKILL.md' };
const expected = {
  open: { 'plans/ready.md': { checked: 2, total: 2, ready: true } },
  archived: {
    'plans/complete/shipped.md': { checked: 1, total: 1, ready: false },
  },
  archivedCount: 1,
};
const reads = [
  skill.path,
  '/scratch/project/plans/ready.md',
  '/scratch/project/plans/complete/shipped.md',
];
const direct = { expectedActivation: true, attachInstalledSkill: true };
const indirect = { expectedActivation: true, attachInstalledSkill: false };
const negative = {
  expectedActivation: false,
  attachInstalledSkill: false,
  expectedOutput: '4',
};

describe('real-model installed skill acceptance', () => {
  it('prints requirements without accessing credentials', () => {
    const result = spawnSync(process.execPath, [script, '--help'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--use-existing-login');
  });
  it('requires explicit native-login selection before accessing state', () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(result.status).toBe(1);
  });
  it('accepts direct and indirect installed reads with correct progress', () => {
    expect(
      assess(direct, JSON.stringify(expected), reads, skill, expected, true)
        .activation
    ).toBe('attached-installed-skill');
    expect(
      assess(indirect, JSON.stringify(expected), reads, skill, expected, true)
        .activation
    ).toBe('model-requested-installed-skill-read');
  });
  it('rejects correct output with no installed skill read', () => {
    expect(() =>
      assess(
        indirect,
        JSON.stringify(expected),
        reads.slice(1),
        skill,
        expected,
        true
      )
    ).toThrow('not activated');
    expect(() =>
      assess(
        direct,
        JSON.stringify(expected),
        reads.slice(1),
        skill,
        expected,
        true
      )
    ).toThrow('not activated');
  });
  it('rejects omitted fixture reads', () => {
    expect(() =>
      assess(
        direct,
        JSON.stringify(expected),
        [skill.path],
        skill,
        expected,
        true
      )
    ).toThrow('did not read');
  });
  it('rejects incorrect progress and archived ready annotations', () => {
    const wrong = structuredClone(expected);
    wrong.archived['plans/complete/shipped.md'].ready = true;
    expect(() =>
      assess(indirect, JSON.stringify(wrong), reads, skill, expected, true)
    ).toThrow('expectations');
  });
  it('rejects extra files and changed fixture/plugin hashes', () => {
    expect(() =>
      assess(
        direct,
        JSON.stringify({ ...expected, extra: true }),
        reads,
        skill,
        expected,
        true
      )
    ).toThrow('expectations');
    expect(() =>
      assess(direct, JSON.stringify(expected), reads, skill, expected, false)
    ).toThrow('changed');
  });
  it('requires unrelated output and zero reads', () => {
    expect(assess(negative, '4', [], skill, expected, true).activation).toBe(
      'none'
    );
    expect(() =>
      assess(negative, '4', [skill.path], skill, expected, true)
    ).toThrow('read');
    expect(() => assess(negative, '5', [], skill, expected, true)).toThrow(
      'mismatch'
    );
  });
  it('rejects non-JSON dashboard claims', () => {
    expect(() =>
      assess(direct, 'Unable to read files', reads, skill, expected, true)
    ).toThrow();
  });
  it('resolves only exact relative fixture reads and rejects traversal', () => {
    const target = '/scratch/project/plans/ready.md';
    const allowed = new Set([target, skill.path]);
    expect(modelReadPath('plans/ready.md', allowed, [target])).toBe(target);
    expect(modelReadPath(skill.path, allowed, [target])).toBe(skill.path);
    for (const input of [
      '../auth.json',
      '/owner/auth.json',
      'plans/../auth.json',
      'plans/missing.md',
    ])
      expect(() => modelReadPath(input, allowed, [target])).toThrow(
        'allowlist'
      );
  });
  it('restricts reads to exact normal files and rejects aliases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yellow-activation-test-'));
    try {
      const file = join(dir, 'fixture.md'),
        alias = join(dir, 'alias.md');
      writeFileSync(file, 'fixture');
      symlinkSync(file, alias);
      expect(allowedRead(file, new Set([file]))).toBe('fixture');
      expect(() => allowedRead('/owner/auth.json', new Set([file]))).toThrow(
        'allowlist'
      );
      expect(() => allowedRead(alias, new Set([alias]))).toThrow('alias');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
