import { describe, expect, it } from 'vitest';

import { GoalEngineError } from '../src/errors.js';
import { PINNED_ENGINE_VERSION } from '../src/pin.js';
import { setup } from '../src/runtime.js';
import type { SpawnEngine, SpawnResult } from '../src/spawn.js';

function spawnOf(result: SpawnResult): SpawnEngine {
  return () => result;
}

describe('setup', () => {
  it.each([1, 3, 126, 127])(
    'rejects validation-shaped stdout from version at exit %i',
    (exitCode) => {
      expect(() =>
        setup({
          env: {},
          spawn: spawnOf({
            exitCode,
            stdout: '{"valid":false,"errors":[]}\n',
            stderr: '',
          }),
        })
      ).toThrowError(
        expect.objectContaining({ code: 'GOAL_ENGINE_UNPARSEABLE' })
      );
    }
  );
  it.each([
    {
      exitCode: 0,
      stdout: '{"engineVersion":"0.1.0"}\n{"extra":true}\n',
      stderr: '',
    },
    {
      exitCode: 0,
      stdout: '{"engineVersion":"0.1.0"}\n',
      stderr: '{"error":{"code":"FAILED","message":"bad"}}\n',
    },
    { exitCode: 1, stdout: '', stderr: 'not-json\n' },
    {
      exitCode: 2,
      stdout: '',
      stderr: '{"error":{"code":"FAILED","message":"bad"}}\n',
    },
    {
      exitCode: 1,
      stdout: '',
      stderr: '{"error":{"code":"FAILED","message":"bad"}}\nextra\n',
    },
  ])('rejects malformed or contradictory process output %#', (result) => {
    expect(() => setup({ env: {}, spawn: spawnOf(result) })).toThrowError(
      expect.objectContaining({ code: 'GOAL_ENGINE_UNPARSEABLE' })
    );
  });
  it('accepts a matching engineVersion', () => {
    const result = setup({
      env: { GOAL_GEN_BIN: '/tmp/goal-gen' },
      spawn: spawnOf({
        exitCode: 0,
        stdout: `{"engineVersion":"${PINNED_ENGINE_VERSION}"}\n`,
        stderr: '',
      }),
    });
    expect(result.engineVersion).toBe(PINNED_ENGINE_VERSION);
    expect(result.pinnedVersion).toBe(PINNED_ENGINE_VERSION);
    expect(result.binary).toBe('/tmp/goal-gen');
  });

  it('fail-closes on version mismatch', () => {
    expect(() =>
      setup({
        env: {},
        spawn: spawnOf({
          exitCode: 0,
          stdout: '{"engineVersion":"9.9.9"}\n',
          stderr: '',
        }),
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'GOAL_ENGINE_VERSION_MISMATCH',
      })
    );
  });

  it('fail-closes on unparseable stdout', () => {
    try {
      setup({
        env: {},
        spawn: spawnOf({ exitCode: 0, stdout: 'hello\n', stderr: '' }),
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as GoalEngineError).code).toBe('GOAL_ENGINE_UNPARSEABLE');
    }
  });
});
