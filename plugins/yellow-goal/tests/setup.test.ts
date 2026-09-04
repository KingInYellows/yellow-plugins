import { describe, expect, it } from 'vitest';

import { GoalEngineError } from '../src/errors.js';
import { PINNED_ENGINE_VERSION } from '../src/pin.js';
import { setup } from '../src/runtime.js';
import type { SpawnEngine, SpawnResult } from '../src/spawn.js';

function spawnOf(result: SpawnResult): SpawnEngine {
  return () => result;
}

describe('setup', () => {
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
    ).toThrow(GoalEngineError);
    try {
      setup({
        env: {},
        spawn: spawnOf({
          exitCode: 0,
          stdout: '{"engineVersion":"9.9.9"}\n',
          stderr: '',
        }),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(GoalEngineError);
      expect((err as GoalEngineError).code).toBe(
        'GOAL_ENGINE_VERSION_MISMATCH'
      );
    }
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
