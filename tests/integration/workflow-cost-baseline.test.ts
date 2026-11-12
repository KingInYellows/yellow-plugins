/**
 * scripts/workflow-cost-baseline.js against synthetic transcripts. The record
 * shapes copy what Claude Code 2.1.322 writes; no real session is read.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const baseline = createRequire(import.meta.url)(
  resolve(ROOT, 'scripts/workflow-cost-baseline.js')
);

type Usage = Record<string, unknown>;

let dir: string;
let clock: number;
let ids: number;

function at(minutes: number): string {
  return new Date(clock + minutes * 60_000).toISOString();
}

function typed(minute: number, text: string) {
  return {
    type: 'user',
    uuid: `u${(ids += 1)}`,
    timestamp: at(minute),
    entrypoint: 'cli',
    origin: { kind: 'human' },
    message: { role: 'user', content: text },
  };
}

function command(minute: number, name: string) {
  return typed(
    minute,
    `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>`
  );
}

function assistant(
  minute: number,
  id: string,
  usage: Usage,
  content: unknown[] = [{ type: 'text', text: 'ok' }],
  model = 'claude-opus-5-5'
) {
  return {
    type: 'assistant',
    timestamp: at(minute),
    entrypoint: 'cli',
    message: { id, model, role: 'assistant', content, usage },
  };
}

function toolUse(id: string, name: string, input: unknown) {
  return { type: 'tool_use', id, name, input };
}

function turn(minute: number, minutes: number) {
  return {
    type: 'system',
    subtype: 'turn_duration',
    timestamp: at(minute),
    durationMs: minutes * 60_000,
  };
}

function writeSession(name: string, records: unknown[]): string {
  const project = join(dir, '-home-user-repo');
  mkdirSync(project, { recursive: true });
  const file = join(project, `${name}.jsonl`);
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function writeSubagent(
  session: string,
  agent: string,
  toolUseId: string,
  records: unknown[]
) {
  const sub = join(dir, '-home-user-repo', session, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, `agent-${agent}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  );
  writeFileSync(
    join(sub, `agent-${agent}.meta.json`),
    JSON.stringify({ toolUseId })
  );
}

const collect = () => baseline.collectRuns({ projectsDir: dir });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'workflow-cost-'));
  clock = Date.parse('2026-11-01T10:00:00Z');
  ids = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('run boundaries', () => {
  it('counts a typed command until the next human prompt', async () => {
    writeSession('s1', [
      typed(0, 'hello'),
      assistant(1, 'm0', { input_tokens: 999, output_tokens: 999 }),
      command(2, 'yellow-review:review:resolve-pr'),
      assistant(3, 'm1', { input_tokens: 10, output_tokens: 20 }),
      assistant(4, 'm2', { input_tokens: 1, output_tokens: 2 }),
      typed(5, 'thanks'),
      assistant(6, 'm3', { input_tokens: 999, output_tokens: 999 }),
    ]);

    const runs = await collect();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      workflow: '/review:resolve',
      trigger: 'typed',
      endedBy: 'prompt',
      calls: 2,
      wallSeconds: 180,
    });
    expect(runs[0].tokens).toMatchObject({ input: 11, output: 22 });
  });

  it('counts a response once though it is written once per content block', async () => {
    const usage = { input_tokens: 5, output_tokens: 7 };
    writeSession('s1', [
      command(0, 'yellow-core:flow:plan'),
      assistant(1, 'm1', usage, [{ type: 'thinking', thinking: '' }]),
      assistant(1, 'm1', usage, [{ type: 'text', text: 'plan' }]),
    ]);

    const [run] = await collect();

    expect(run.calls).toBe(1);
    expect(run.tokens).toMatchObject({ input: 5, output: 7 });
  });

  it('keeps a run open across notifications, tool results and skill bodies', async () => {
    writeSession('s1', [
      command(0, 'yellow-core:flow:work'),
      assistant(1, 'm1', { output_tokens: 1 }),
      {
        type: 'user',
        timestamp: at(2),
        origin: { kind: 'task-notification' },
        message: {
          role: 'user',
          content: '<task-notification>done</task-notification>',
        },
      },
      {
        type: 'user',
        timestamp: at(3),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'x' }],
        },
      },
      {
        type: 'user',
        timestamp: at(4),
        isMeta: true,
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'skill body' }],
        },
      },
      assistant(5, 'm2', { output_tokens: 1 }),
    ]);

    const [run] = await collect();

    expect(run).toMatchObject({ calls: 2, endedBy: 'eof', wallSeconds: 300 });
  });

  it('starts a model-invoked run at the Skill call, including that response', async () => {
    const usage = { input_tokens: 4, output_tokens: 6 };
    writeSession('s1', [
      typed(0, 'review PR 12 please'),
      assistant(1, 'm1', usage, [{ type: 'text', text: 'on it' }]),
      assistant(1, 'm1', usage, [
        toolUse('t1', 'Skill', { skill: 'yellow-review:review:review-pr' }),
      ]),
      assistant(2, 'm2', { output_tokens: 3 }),
    ]);

    const [run] = await collect();

    expect(run).toMatchObject({
      workflow: '/review:pr',
      trigger: 'model',
      calls: 2,
    });
    expect(run.tokens.output).toBe(9);
  });
});

describe('nested workflows', () => {
  it('reports a nested run on its own and inside its parent', async () => {
    writeSession('s1', [
      command(0, 'yellow-review:review:sweep'),
      assistant(1, 'm1', { output_tokens: 1 }, [
        toolUse('t1', 'Skill', { skill: 'review:pr' }),
      ]),
      assistant(2, 'm2', { output_tokens: 10 }),
      assistant(3, 'm3', { output_tokens: 1 }, [
        toolUse('t2', 'Skill', { skill: 'yellow-review:review:resolve-pr' }),
      ]),
      assistant(4, 'm4', { output_tokens: 100 }),
    ]);

    const runs = await collect();
    const output = Object.fromEntries(
      runs.map((run: { workflow: string; tokens: { output: number } }) => [
        run.workflow,
        run.tokens.output,
      ])
    );

    expect(output).toEqual({
      '/review:pr': 11,
      '/review:resolve': 101,
      '/review:sweep': 112,
    });
    expect(
      runs.find((run: { workflow: string }) => run.workflow === '/review:pr')
    ).toMatchObject({ trigger: 'nested', parent: '/review:sweep' });
  });

  it('charges the response that starts a nested run to it, whatever the block order', async () => {
    const usage = { output_tokens: 5 };
    writeSession('s1', [
      command(0, 'yellow-review:review:sweep'),
      assistant(1, 'm1', usage, [{ type: 'text', text: 'reviewing' }]),
      assistant(1, 'm1', usage, [
        toolUse('t1', 'Skill', { skill: 'review:pr' }),
      ]),
    ]);

    const runs = await collect();
    const nested = runs.find(
      (run: { workflow: string }) => run.workflow === '/review:pr'
    );

    expect(nested).toMatchObject({ calls: 1, parent: '/review:sweep' });
    expect(nested.tokens.output).toBe(5);
  });
});

describe('subagents', () => {
  it('adds a subagent, and the subagent it spawned, to the run that started it', async () => {
    writeSession('s1', [
      command(0, 'yellow-review:review:review-pr'),
      assistant(1, 'm1', { output_tokens: 1 }, [toolUse('t1', 'Agent', {})]),
      typed(9, 'unrelated'),
      assistant(10, 'm2', { output_tokens: 1 }, [toolUse('t9', 'Agent', {})]),
    ]);
    writeSubagent('s1', 'a', 't1', [
      assistant(
        2,
        'a1',
        { output_tokens: 50 },
        [toolUse('t2', 'Agent', {})],
        'claude-sonnet-5-5'
      ),
    ]);
    writeSubagent('s1', 'b', 't2', [
      assistant(3, 'b1', { output_tokens: 7 }, undefined, 'claude-haiku-5-5'),
    ]);
    writeSubagent('s1', 'c', 't9', [
      assistant(11, 'c1', { output_tokens: 999 }),
    ]);

    const [run] = await collect();

    expect(run.subagentCount).toBe(2);
    expect(run.tokens.output).toBe(58);
    expect(run.models).toEqual({
      'claude-opus-5-5': 1,
      'claude-sonnet-5-5': 1,
      'claude-haiku-5-5': 1,
    });
  });
});

describe('active time', () => {
  it('is the run overlap with completed turns, merging overlapping turns', async () => {
    writeSession('s1', [
      command(0, 'yellow-core:flow:plan'),
      assistant(1, 'm1', { output_tokens: 1 }),
      turn(10, 10),
      assistant(100, 'm2', { output_tokens: 1 }),
      turn(110, 10),
      turn(112, 8),
    ]);

    const [run] = await collect();

    expect(run.wallSeconds).toBe(112 * 60);
    expect(run.activeSeconds).toBe(22 * 60);
  });
});

describe('usageCost', () => {
  it('prices each token class at the model rate', () => {
    const cost = baseline.usageCost('claude-opus-5-5', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 2_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
    });

    expect(cost).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 6);
  });

  it('uses the higher Claude Haiku 5.5 rate above 100,000 prompt tokens', () => {
    const small = { input_tokens: 100_000, output_tokens: 0 };
    const large = { input_tokens: 100_001, output_tokens: 0 };

    expect(baseline.usageCost('claude-haiku-5-5', small)).toBeCloseTo(0.01, 6);
    expect(baseline.usageCost('claude-haiku-5-5', large)).toBeCloseTo(
      0.0500005,
      6
    );
  });

  it('returns null for a model with no listed price', () => {
    expect(
      baseline.usageCost('some-new-model', { input_tokens: 1 })
    ).toBeNull();
  });
});

describe('readHeadless', () => {
  it('sums the result objects of claude -p --output-format json', () => {
    const file = join(dir, 'drain.jsonl');
    writeFileSync(
      file,
      [
        'not json',
        JSON.stringify({
          total_cost_usd: 0.25,
          num_turns: 3,
          duration_ms: 4000,
          is_error: false,
          usage: { output_tokens: 10 },
        }),
        JSON.stringify({
          total_cost_usd: 0.5,
          num_turns: 1,
          duration_ms: 2000,
          is_error: true,
          usage: { output_tokens: 5 },
        }),
      ].join('\n')
    );

    const [row] = baseline.readHeadless([file]);

    expect(row).toMatchObject({
      label: 'drain',
      results: 2,
      errors: 1,
      turns: 4,
      durationSeconds: 6,
      costUsd: 0.75,
    });
    expect(row.tokens.output).toBe(15);
  });
});

describe('command line', () => {
  const run = (args: string[], configDir: string) =>
    spawnSync(
      process.execPath,
      [resolve(ROOT, 'scripts/workflow-cost-baseline.js'), ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      }
    );

  it('reports headless results on a machine with no transcript store', () => {
    const file = join(dir, 'eval.json');
    writeFileSync(file, JSON.stringify({ total_cost_usd: 1.5, num_turns: 2 }));

    const result = run(['--headless', file], join(dir, 'no-such-config'));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('| eval | 1 | 0 | 2 |');
  });

  it('fails when a named projects directory is missing', () => {
    const result = run(['--projects-dir', join(dir, 'missing')], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cannot read projects directory');
  });

  it.each(['2026-13-01', '2026-02-30', 'yesterday'])(
    'rejects the impossible date %s',
    (date) => {
      const result = run(['--since', date], dir);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('--since needs a real YYYY-MM-DD date');
    }
  );
});
