/**
 * Trigger eval suite (CLAUDE-315): the free half. Checks the committed eval
 * sets, the case files the runner stages for `claude plugin eval`, and the
 * scoring of its JSON output. No model call.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const trigger = require('../../scripts/eval/trigger/run-trigger-eval.js');

const ROOT = join(__dirname, '..', '..');

describe('trigger eval sets', () => {
  const sets = trigger.loadSets(ROOT, []);

  it('has seed sets', () => {
    expect(sets.length).toBeGreaterThanOrEqual(3);
  });

  it.each(sets.map((s: { id: string }) => [s.id, s]))(
    '%s passes the set check',
    (_id, set) => {
      expect(trigger.checkSet(ROOT, set)).toEqual([]);
    }
  );

  it('a near-miss query in one set is not reused as a positive in the same set', () => {
    for (const set of sets) {
      const pos = new Set(
        set.data.queries
          .filter((q: { trigger: boolean }) => q.trigger)
          .map((q: { q: string }) => q.q)
      );
      for (const q of set.data.queries)
        if (!q.trigger) expect(pos.has(q.q)).toBe(false);
    }
  });
});

describe('componentInfo', () => {
  it('names a command by file path and frontmatter name', () => {
    const info = trigger.componentInfo(
      ROOT,
      'plugins/yellow-review/commands/review/review-pr.md'
    );
    expect(info.kind).toBe('command');
    expect(info.names).toEqual(['review:review-pr', 'review:pr']);
    const re = new RegExp(info.inputMatch);
    expect(
      re.test('{"skill":"yellow-review:review:review-pr","args":"42"}')
    ).toBe(true);
    expect(re.test('{"skill": "review:pr"}')).toBe(true);
    // A sibling whose name starts with the target's must not match.
    expect(re.test('{"skill":"yellow-review:review:review-pr-x"}')).toBe(false);
    expect(re.test('{"skill":"code-review","args":"42"}')).toBe(false);
  });

  it('names a skill by directory', () => {
    const info = trigger.componentInfo(
      ROOT,
      'plugins/yellow-core/skills/debugging/SKILL.md'
    );
    expect(info.kind).toBe('skill');
    expect(info.names).toEqual(['debugging']);
    expect(
      new RegExp(info.inputMatch).test('{"skill":"yellow-core:debugging"}')
    ).toBe(true);
    expect(new RegExp(info.inputMatch).test('{"skill":"debug"}')).toBe(false);
  });

  it('rejects a set aimed at a component the model cannot invoke', () => {
    const set = {
      id: 'yellow-core:brainstorming',
      plugin: 'yellow-core',
      data: {
        source: 'plugins/yellow-core/skills/brainstorming/SKILL.md',
        queries: [],
      },
    };
    expect(trigger.checkSet(ROOT, set).join('\n')).toMatch(
      /user-invocable: false/
    );
  });
});

describe('stage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trigger-stage-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes one case per query with dependency plugins and the free grader', () => {
    const sets = trigger.loadSets(ROOT, ['yellow-review:review-pr']);
    const cases = trigger.stage(ROOT, sets, dir, { runs: 3, maxTurns: 2 });
    expect(cases).toHaveLength(sets[0].data.queries.length);
    expect(readdirSync(join(dir, 'plugins')).sort()).toEqual([
      'yellow-core',
      'yellow-linear',
      'yellow-review',
    ]);
    const pos = JSON.parse(
      readFileSync(
        join(dir, 'evals', 'yellow-review--review-pr--p01', 'case.yaml'),
        'utf8'
      )
    );
    expect(pos.graders).toEqual([
      expect.objectContaining({ type: 'tool_used', tool: 'Skill', min: 1 }),
    ]);
    expect(pos.plugins).toContain('../../plugins/yellow-review');
    const negName = cases.find((c: { trigger: boolean }) => !c.trigger).name;
    const neg = JSON.parse(
      readFileSync(join(dir, 'evals', negName, 'case.yaml'), 'utf8')
    );
    // tool_used defaults min to 1; a near miss needs min 0 or it can never pass.
    expect(neg.graders[0]).toEqual(expect.objectContaining({ min: 0, max: 0 }));
  });
});

describe('score', () => {
  const cases = [
    { name: 'a--p01', set: 'p:c', trigger: true, split: 'train', q: 'x' },
    { name: 'a--p02', set: 'p:c', trigger: true, split: 'heldout', q: 'y' },
    { name: 'a--n01', set: 'p:c', trigger: false, split: 'heldout', q: 'z' },
  ];
  const run = (passed: boolean, error?: string) => ({
    error,
    graders: [{ passed }],
  });

  it('turns grader verdicts into trigger rates and set metrics', () => {
    const agg = {
      cases: [
        {
          name: 'a--p01',
          arms: {
            with: [
              run(true, 'exit 1: Reached maximum number of turns (2)'),
              run(true),
              run(false),
            ],
          },
        },
        { name: 'a--p02', arms: { with: [run(false), run(false), run(true)] } },
        // Near miss: grader passes when the target stays quiet.
        { name: 'a--n01', arms: { with: [run(true), run(true), run(false)] } },
      ],
    };
    const { sets, failedRuns } = trigger.score(agg, cases);
    expect(failedRuns).toBe(0);
    const s = sets['p:c'];
    expect(s.queries.map((q: { fired: number }) => q.fired)).toEqual([2, 1, 1]);
    expect(s.recall).toBe(0.5);
    expect(s.specificity).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.heldoutAccuracy).toBe(0.5);
  });

  it('counts a run that errored for another reason as failed', () => {
    const agg = {
      cases: [
        { name: 'a--p01', arms: { with: [run(false, 'exit 1: auth failed')] } },
      ],
    };
    expect(trigger.score(agg, cases.slice(0, 1)).failedRuns).toBe(1);
  });
});

describe('score fails closed', () => {
  const cases = [
    { name: 'a--p01', set: 'p:a', trigger: true, split: 'heldout', q: 'x' },
    { name: 'b--p01', set: 'p:b', trigger: true, split: 'heldout', q: 'y' },
  ];

  it('reports a selected case the aggregate lacks as unscored', () => {
    const agg = {
      cases: [
        { name: 'a--p01', arms: { with: [{ graders: [{ passed: true }] }] } },
      ],
    };
    const { sets, unscored } = trigger.score(agg, cases);
    expect(Object.keys(sets)).toEqual(['p:a']);
    expect(sets['p:a'].heldoutAccuracy).toBe(1);
    expect(unscored).toEqual(['b--p01']);
  });

  it('reports a case whose every run errored as unscored', () => {
    const agg = {
      cases: [
        { name: 'a--p01', arms: { with: [{ error: 'exit 1: auth failed' }] } },
      ],
    };
    const res = trigger.score(agg, cases.slice(0, 1));
    expect(res.unscored).toEqual(['a--p01']);
    expect(res.failedRuns).toBe(1);
    expect(res.sets).toEqual({});
  });

  it('scores nothing from an empty aggregate', () => {
    const res = trigger.score({ cases: [] }, cases);
    expect(res.sets).toEqual({});
    expect(res.unscored).toEqual(['a--p01', 'b--p01']);
  });
});

describe('caseMatches', () => {
  it('matches the CLI --case glob: * and ? only', () => {
    const name = 'yellow-core--flow-plan--p03';
    expect(trigger.caseMatches(undefined, name)).toBe(true);
    expect(trigger.caseMatches('yellow-core--flow-plan--p*', name)).toBe(true);
    expect(trigger.caseMatches('*--p0?', name)).toBe(true);
    expect(trigger.caseMatches('yellow-core--flow-plan--n*', name)).toBe(false);
    expect(trigger.caseMatches('yellow-core', name)).toBe(false);
    // Regex metacharacters in a glob are literal.
    expect(trigger.caseMatches('yellow.core*', name)).toBe(false);
  });
});
