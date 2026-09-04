import { describe, expect, it } from 'vitest';

import { GoalEngineError } from '../src/errors.js';
import { requestCreate, requestValidate } from '../src/runtime.js';
import type { SpawnEngine, SpawnResult } from '../src/spawn.js';

function spawnOf(result: SpawnResult): SpawnEngine {
  return () => result;
}

describe('requestCreate', () => {
  it('returns requestId from JSON stdout', () => {
    const result = requestCreate(
      {
        env: {},
        spawn: spawnOf({
          exitCode: 0,
          stdout: '{"requestId":"req_1"}\n',
          stderr: '',
        }),
      },
      { repo: '/tmp/repo', goal: 'do it', output: '/tmp/request.json' }
    );
    expect(result.requestId).toBe('req_1');
    expect(result.output).toBe('/tmp/request.json');
  });

  it('maps engine exit 2 to GOAL_ENGINE_USAGE_ERROR', () => {
    try {
      requestCreate(
        {
          env: {},
          spawn: spawnOf({
            exitCode: 2,
            stdout: '',
            stderr: '{"error":{"code":"USAGE_ERROR","message":"bad args"}}\n',
          }),
        },
        { repo: '/tmp/repo', goal: 'do it', output: '/tmp/request.json' }
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as GoalEngineError).code).toBe('GOAL_ENGINE_USAGE_ERROR');
    }
  });
});

describe('requestValidate', () => {
  it('requires valid:true', () => {
    const result = requestValidate(
      {
        env: {},
        spawn: spawnOf({
          exitCode: 0,
          stdout: '{"valid":true}\n',
          stderr: '',
        }),
      },
      { request: '/tmp/request.json' }
    );
    expect(result.valid).toBe(true);
  });

  it('fail-closes when valid is not true', () => {
    try {
      requestValidate(
        {
          env: {},
          spawn: spawnOf({
            exitCode: 0,
            stdout: '{"valid":false}\n',
            stderr: '',
          }),
        },
        { request: '/tmp/request.json' }
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as GoalEngineError).code).toBe('GOAL_ENGINE_FAILED');
    }
  });
});
