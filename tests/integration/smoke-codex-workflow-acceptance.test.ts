/* eslint-disable @typescript-eslint/no-var-requires */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  assessWorkflow,
  contains,
  loadGtSetupBaseline,
} = require('../../scripts/smoke-codex-workflow-acceptance');
const root = resolve(__dirname, '../..');
const skill = { path: '/installed/codex/skills/cursor-plan/SKILL.md' };
const observed = (key: string, method = 'fixture/tool') => ({
  method,
  params: { tool: 'fixture_observe', key },
});

describe('workflow acceptance evidence', () => {
  const test = {
    expected: { status: 'ok' },
    requiredObservations: ['cursor-plan'],
  };
  it.each([
    { events: [] },
    { events: [observed('wrong-key')] },
    { events: [observed('cursor-plan', 'fixture/denied')] },
    {
      events: [
        {
          method: 'fixture/tool',
          params: { tool: 'fixture_read', key: 'cursor-plan' },
        },
      ],
    },
  ])(
    'rejects absent or unsuccessful required observations: %j',
    ({ events }) => {
      expect(() =>
        assessWorkflow(test, '{"status":"ok"}', [skill.path], skill, events)
      ).toThrow(/observation/i);
    }
  );
  it('accepts completed observation evidence from this case', () => {
    expect(() =>
      assessWorkflow(test, '{"status":"ok"}', [skill.path], skill, [
        observed('cursor-plan'),
      ])
    ).not.toThrow();
  });
  it('rejects evidence from a previous case', () => {
    expect(() =>
      assessWorkflow(
        test,
        '{"status":"ok"}',
        [skill.path],
        skill,
        [observed('cursor-plan')],
        1
      )
    ).toThrow(/observation/i);
  });
  it.each([
    [
      'remote-orchestration-final.json',
      'cursor-success-no-auth',
      'cursor-plan',
    ],
    [
      'remote-orchestration-final.json',
      'codex-ready-native',
      'codex-readiness',
    ],
    ['analysis-final.json', 'debt-success', 'debt-snapshot'],
    ['developer-docs-final.json', 'worktrees-success', 'worktrees'],
  ])('requires probe evidence in %s case %s', (file, id, key) => {
    const corpus = JSON.parse(
      readFileSync(join(root, 'tests/fixtures/codex-expansion', file), 'utf8')
    );
    const row = corpus.cases.find((entry: { id: string }) => entry.id === id);
    expect(row.requiredObservations).toContain(key);
    expect(corpus.observations[key].actual).toBeDefined();
  });
});

describe('array output contracts', () => {
  it.each([
    [[1], []],
    [[], [1]],
    [[1, 2], [1]],
    [[1], [1, 2]],
    [[{ nested: ['extra'] }], [{ nested: [] }]],
  ])(
    'rejects unexpected or missing array members: %j versus %j',
    (actual, expected) => {
      expect(contains(actual, expected)).toBe(false);
    }
  );
  it('preserves partial object matching inside exact-length arrays', () => {
    expect(contains([{ status: 'ok', detail: true }], [{ status: 'ok' }])).toBe(
      true
    );
    expect(contains([], [])).toBe(true);
  });
  it('rejects fabricated findings in the actual clean-rubric case', () => {
    const test = JSON.parse(
      readFileSync(
        join(root, 'tests/fixtures/codex-expansion/policy.json'),
        'utf8'
      )
    ).cases[0];
    const output = {
      ...test.expected,
      findings: [{ priority: 'P0', finding: 'fabricated' }],
    };
    expect(() =>
      assessWorkflow(
        test,
        JSON.stringify(output),
        [skill.path, '/fixture/change.diff'],
        skill,
        []
      )
    ).toThrow(/Output contract mismatch/);
  });
});

describe('immutable Graphite setup baseline', () => {
  it('loads the historical bytes independently of cwd and Git availability', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yellow-baseline-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `const {loadGtSetupBaseline}=require(${JSON.stringify(join(root, 'scripts/smoke-codex-workflow-acceptance.js'))}); const b=loadGtSetupBaseline(); console.log(JSON.stringify({bytes:b.bytes.toString(),provenance:b.provenance}));`,
        ],
        { cwd: dir, env: { PATH: '' }, encoding: 'utf8' }
      );
      expect(result.status).toBe(0);
      const baseline = JSON.parse(result.stdout);
      expect(baseline.provenance.sourceRevision).toBe(
        'd2ab958b7cf045f46382a2ab8f34601828c1c3d5'
      );
      expect(baseline.provenance.sha256).toBe(
        'fb20820a5905083abbc4af061125cfce706f92c80b5712ed7d207b3accc0fb9f'
      );
      expect(baseline.bytes).not.toBe(
        readFileSync(
          join(root, 'plugins/gt-workflow/codex/skills/gt-setup/SKILL.md'),
          'utf8'
        )
      );
      expect(baseline.bytes).toContain('### Phase 1: Validate Prerequisites');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects missing or modified baseline bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yellow-baseline-'));
    try {
      expect(() => loadGtSetupBaseline(dir)).toThrow();
      cpSync(join(root, 'tests/fixtures/codex-expansion/baselines'), dir, {
        recursive: true,
      });
      writeFileSync(join(dir, 'gt-setup-before.txt'), 'changed baseline');
      expect(() => loadGtSetupBaseline(dir)).toThrow(/hash mismatch/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
