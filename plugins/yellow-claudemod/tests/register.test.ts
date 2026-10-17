import type {
  AgentSpawnInput,
  AgentSpawnResult,
  CommandRunInput,
  On,
} from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

const REVIEWER = 'yellow-review:review:adversarial-reviewer';
const SECURITY = 'yellow-core:review:security-sentinel';

// Stands in for the engine beneath the plugin: each spawn runs on the model
// asked for, else on the agent's own frontmatter model (opus here).
function engine(on: On): void {
  mock.store(on);
  mock.clock(on);
  on('session.measure', ($, e) => ({ changed: e.changed }));
  on('agent.spawn', ($, e) => ({
    model: e.model ?? 'opus',
    agentId: `a-${e.subagentType}`,
  }));
  on('command.run', () => ({ text: 'engine' }));
}

function window(percentUsed: number) {
  return {
    context: {} as never,
    rateLimits: [
      { kind: 'five_hour', percentUsed },
      { kind: 'seven_day', percentUsed: 10 },
    ],
    changed: ['rateLimits' as const],
  };
}

// The engine stamps origin and presentation, and fills a spawn's identity
// fields; a test raising the events directly supplies them.
async function status($: Engine): Promise<string> {
  const input = { command: 'claudemod-status', args: '20' } as CommandRunInput;
  return (await $.command.run(input)).text ?? '';
}

function spawn(
  $: Engine,
  subagentType: string,
  extra: Partial<AgentSpawnInput> = {}
): Promise<AgentSpawnResult> {
  const plugin = subagentType.includes(':')
    ? subagentType.split(':')[0]!
    : 'engine';
  const input = {
    tool_use_id: `t-${subagentType}`,
    prompt: 'x',
    description: 'x',
    subagentType,
    provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
    parentModel: 'opus',
    background: false,
    fork: false,
    ...extra,
  } as AgentSpawnInput;
  return $.agent.spawn(input);
}

describe('downshift off (the default)', () => {
  test('leaves every spawn on its own model and records it', async ($, on) => {
    engine(on);
    await $.session.measure(window(99));
    const ran = await spawn($, REVIEWER);
    expect(ran.model).toBe('opus');
    const text = await status($);
    expect(text).toContain('Downshift: off');
    expect(text).toContain(`${REVIEWER}: ran opus`);
    expect(text).not.toContain('[downshifted]');
  });
});

describe('downshift on', () => {
  const options = { downshift_enabled: true, downshift_threshold: 80 };

  test(
    'moves a listed Opus reviewer to sonnet past the threshold',
    { options },
    async ($, on) => {
      engine(on);
      await $.session.measure(window(85));
      const ran = await spawn($, REVIEWER);
      expect(ran.model).toBe('sonnet');
      expect(await status($)).toContain(
        `${REVIEWER}: ran sonnet [downshifted]`
      );
    }
  );

  test('stays put below the threshold', { options }, async ($, on) => {
    engine(on);
    await $.session.measure(window(79));
    expect((await spawn($, REVIEWER)).model).toBe('opus');
  });

  test('never touches security-sentinel', { options }, async ($, on) => {
    engine(on);
    await $.session.measure(window(99));
    expect((await spawn($, SECURITY)).model).toBe('opus');
  });

  test("keeps a caller's explicit model", { options }, async ($, on) => {
    engine(on);
    await $.session.measure(window(99));
    const ran = await spawn($, REVIEWER, { model: 'opus' });
    expect(ran.model).toBe('opus');
    expect(await status($)).toContain('asked opus, ran opus');
  });

  test('leaves a fork on the parent model', { options }, async ($, on) => {
    engine(on);
    await $.session.measure(window(99));
    expect((await spawn($, REVIEWER, { fork: true })).model).toBe('opus');
  });

  test(
    'does nothing before the first usage reading',
    { options },
    async ($, on) => {
      engine(on);
      expect((await spawn($, REVIEWER)).model).toBe('opus');
      expect(await status($)).toContain('no reading yet');
    }
  );
});

describe('ledger', () => {
  test('keeps every row of a parallel fan-out', async ($, on) => {
    engine(on);
    const types = [
      REVIEWER,
      SECURITY,
      'yellow-core:review:performance-oracle',
      'general-purpose',
    ];
    await Promise.all(types.map((subagentType) => spawn($, subagentType)));
    const text = await status($);
    expect(text).toContain('Ledger: 4 spawn(s) recorded');
    for (const t of types) expect(text).toContain(`${t}: ran opus`);
  });

  test('runs a failing spawn once and lets the failure through', async ($, on) => {
    let calls = 0;
    mock.store(on);
    mock.clock(on);
    on('agent.spawn', () => {
      calls += 1;
      throw new Error('subagent aborted');
    });
    on('command.run', () => ({ text: 'engine' }));
    await expect(spawn($, REVIEWER)).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
