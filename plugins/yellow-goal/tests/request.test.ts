import { describe, expect, it } from 'vitest';

import { GoalEngineError } from '../src/errors.js';
import { PINNED_ENGINE_VERSION } from '../src/pin.js';
import { requestCreate, requestValidate } from '../src/runtime.js';
import type { SpawnEngine, SpawnResult } from '../src/spawn.js';

function spawnOf(result: SpawnResult): SpawnEngine {
  return (args) =>
    args[0] === 'version'
      ? {
          exitCode: 0,
          stdout: `{"engineVersion":"${PINNED_ENGINE_VERSION}"}\n`,
          stderr: '',
        }
      : result;
}

describe('requestCreate', () => {
  it('rejects the validation-only stdout failure shape', () => {
    expect(() =>
      requestCreate(
        {
          env: {},
          spawn: spawnOf({
            exitCode: 1,
            stdout: '{"valid":false,"errors":[]}\n',
            stderr: '',
          }),
        },
        { repo: 'example/repo', goal: 'test', output: 'request.json' }
      )
    ).toThrowError(
      expect.objectContaining({ code: 'GOAL_ENGINE_UNPARSEABLE' })
    );
  });
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
  it.each([
    { valid: false, errors: [{ path: 'goal', message: 'Required' }] },
    {
      path: 'other.json',
      valid: false,
      errors: [{ path: 'goal', message: 'Required' }],
    },
    { path: 'request.json', valid: false, errors: [] },
    { path: 'request.json', valid: false, errors: [null] },
    {
      path: 'request.json',
      valid: false,
      errors: [{ path: 1, message: 'Required' }],
    },
    { path: 'request.json', valid: false, errors: [{ path: 'goal' }] },
  ])('rejects malformed validation failure %j', (output) => {
    expect(() =>
      requestValidate(
        {
          env: {},
          spawn: spawnOf({
            exitCode: 1,
            stdout: JSON.stringify(output) + '\n',
            stderr: '',
          }),
        },
        { request: 'request.json' }
      )
    ).toThrowError(
      expect.objectContaining({ code: 'GOAL_ENGINE_UNPARSEABLE' })
    );
  });
  it('preserves schema-invalid stdout with exit 1 and no stderr as a domain failure', () => {
    expect(() =>
      requestValidate(
        {
          env: {},
          spawn: spawnOf({
            exitCode: 1,
            stdout:
              '{"path":"request.json","valid":false,"errors":[{"path":"goal","message":"Required"}]}\n',
            stderr: '',
          }),
        },
        { request: 'request.json' }
      )
    ).toThrowError(expect.objectContaining({ code: 'GOAL_ENGINE_FAILED' }));
  });

  it('probes identity first and preserves an option-looking path as one positional', () => {
    const calls: string[][] = [];
    requestValidate(
      {
        env: {},
        spawn: (args) => {
          calls.push([...args]);
          return spawnOf({
            exitCode: 0,
            stdout: '{"valid":true}\n',
            stderr: '',
          })(args);
        },
      },
      { request: '--request.json' }
    );
    expect(calls).toEqual([
      ['version', '--json'],
      ['request', 'validate', '--json', '--', '--request.json'],
    ]);
  });
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
