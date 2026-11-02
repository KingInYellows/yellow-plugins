import { describe, expect, it } from 'vitest';

import {
  classifyTurn,
  needsInput,
  parseResult,
  structuredOutput,
  type TurnOutcome,
} from '../src/classify';

function outcome(over: Partial<TurnOutcome> & { json?: object }): TurnOutcome {
  const { json, ...rest } = over;
  return {
    exitCode: 0,
    signal: null,
    killedByDeadline: false,
    cancelled: false,
    stdout: json === undefined ? '' : JSON.stringify(json),
    stderr: '',
    ...rest,
  };
}

const ok = {
  status: 'SUCCESS',
  conversation_id: 'c1',
  response: 'done',
  denied_actions: [],
};

describe('classifyTurn', () => {
  it('print_timeout with SUCCESS and exit 0 is TIMED_OUT', () => {
    expect(
      classifyTurn(
        outcome({ json: { ...ok, finished_reason: 'print_timeout' } })
      ).kind
    ).toBe('TIMED_OUT');
  });

  it('our deadline kill is TIMED_OUT even with no output', () => {
    expect(
      classifyTurn(
        outcome({ exitCode: null, signal: 'SIGTERM', killedByDeadline: true })
      ).kind
    ).toBe('TIMED_OUT');
  });

  it('owner cancel, SIGTERM or finished_reason interrupted is INTERRUPTED', () => {
    expect(classifyTurn(outcome({ cancelled: true })).kind).toBe('INTERRUPTED');
    expect(
      classifyTurn(outcome({ exitCode: null, signal: 'SIGTERM' })).kind
    ).toBe('INTERRUPTED');
    expect(
      classifyTurn(
        outcome({
          exitCode: 1,
          json: { status: 'ERROR', finished_reason: 'interrupted' },
        })
      ).kind
    ).toBe('INTERRUPTED');
  });

  it('non-empty denied_actions is DENIED and carries the actions', () => {
    const c = classifyTurn(
      outcome({
        json: {
          ...ok,
          response: '',
          denied_actions: [{ tool: 'command', input: 'npm -v' }],
        },
      })
    );
    expect(c.kind).toBe('DENIED');
    expect(c.kind === 'DENIED' && c.deniedActions).toHaveLength(1);
  });

  it('SUCCESS with finished_reason absent is OK (agy 1.4.12 normal finish)', () => {
    expect(classifyTurn(outcome({ json: ok })).kind).toBe('OK');
  });

  it('SUCCESS with an unrecognized finished_reason is UNVERIFIED', () => {
    const c = classifyTurn(
      outcome({ json: { ...ok, finished_reason: 'stop' } })
    );
    expect(c.kind).toBe('UNVERIFIED');
    expect(c.kind === 'UNVERIFIED' && c.finishedReason).toBe('stop');
  });

  it('SUCCESS with a non-string finished_reason is UNVERIFIED', () => {
    for (const bad of [null, 0, { x: 1 }]) {
      expect(
        classifyTurn(outcome({ json: { ...ok, finished_reason: bad } })).kind
      ).toBe('UNVERIFIED');
    }
  });

  it('SUCCESS with a non-array denied_actions is MODEL_ERROR', () => {
    for (const bad of [null, 'x', { a: 1 }]) {
      expect(
        classifyTurn(outcome({ json: { ...ok, denied_actions: bad } })).kind
      ).toBe('MODEL_ERROR');
    }
  });

  it('SUCCESS with a non-zero exit is not OK', () => {
    expect(classifyTurn(outcome({ exitCode: 3, json: ok })).kind).toBe(
      'MODEL_ERROR'
    );
  });

  it('authentication required on stderr is AUTH_REQUIRED', () => {
    expect(
      classifyTurn(
        outcome({
          exitCode: 1,
          stderr: 'Error: Authentication required. Run agy to sign in.',
        })
      ).kind
    ).toBe('AUTH_REQUIRED');
  });

  it('quota exhaustion on stderr is QUOTA, other errors MODEL_ERROR', () => {
    expect(
      classifyTurn(
        outcome({
          exitCode: 3,
          json: { status: 'ERROR' },
          stderr: 'RESOURCE_EXHAUSTED: quota exceeded',
        })
      ).kind
    ).toBe('QUOTA');
    expect(
      classifyTurn(
        outcome({
          exitCode: 3,
          json: { status: 'ERROR', response: 'fixed the 429 quota handler' },
        })
      ).kind
    ).toBe('MODEL_ERROR');
    const e = classifyTurn(
      outcome({
        exitCode: 3,
        json: { status: 'ERROR' },
        stderr: 'model overloaded',
      })
    );
    expect(e.kind).toBe('MODEL_ERROR');
    expect(e.kind === 'MODEL_ERROR' && e.detail).toBe('model overloaded');
    const empty = classifyTurn(outcome({ exitCode: 7 }));
    expect(empty.kind === 'MODEL_ERROR' && empty.detail).toBe(
      'agy exited with 7'
    );
  });
});

describe('classifyTurn row order', () => {
  it('print_timeout wins over denied_actions', () => {
    expect(
      classifyTurn(
        outcome({
          json: {
            ...ok,
            finished_reason: 'print_timeout',
            denied_actions: [{ tool: 'command' }],
          },
        })
      ).kind
    ).toBe('TIMED_OUT');
  });

  it('our deadline kill wins over a SUCCESS result', () => {
    expect(
      classifyTurn(outcome({ killedByDeadline: true, json: ok })).kind
    ).toBe('TIMED_OUT');
  });

  it('a clean SUCCESS wins over auth text on stderr', () => {
    expect(
      classifyTurn(
        outcome({ json: ok, stderr: 'warning: authentication required soon' })
      ).kind
    ).toBe('OK');
  });
});

describe('parseResult', () => {
  it('reads JSON after leading notices and ignores non-objects', () => {
    expect(parseResult('notice: MCP starting\n{"status":"SUCCESS"}')).toEqual({
      status: 'SUCCESS',
    });
    expect(parseResult('[1,2]')).toBeUndefined();
    expect(parseResult('')).toBeUndefined();
    expect(parseResult('not json')).toBeUndefined();
  });

  it('drops a malformed conversation_id so the next turn cannot break', () => {
    expect(
      parseResult('{"status":"SUCCESS","conversation_id":"abc-123_X"}')
    ).toEqual({ status: 'SUCCESS', conversation_id: 'abc-123_X' });
    for (const bad of ['"--settings=x"', '"a b"', '42', '""']) {
      expect(
        parseResult(`{"status":"SUCCESS","conversation_id":${bad}}`),
        bad
      ).toEqual({ status: 'SUCCESS' });
    }
  });

  it('drops a non-string response; needsInput ignores non-strings', () => {
    expect(parseResult('{"status":"SUCCESS","response":null}')).toEqual({
      status: 'SUCCESS',
    });
    expect(needsInput(null)).toBeUndefined();
    expect(needsInput(42)).toBeUndefined();
  });
});

describe('needsInput and structuredOutput', () => {
  it('only a final NEEDS_INPUT line marks a question', () => {
    expect(needsInput('Working.\nNEEDS_INPUT: which branch?')).toBe(
      'which branch?'
    );
    expect(needsInput('NEEDS_INPUT: early\nthen more text')).toBeUndefined();
    expect(needsInput('Should I continue?')).toBeUndefined();
    expect(needsInput(undefined)).toBeUndefined();
  });

  it('trusts structured_output only from a turn that passed --json-schema', () => {
    const r = { structured_output: { steps: [] } };
    expect(structuredOutput(r, true)).toEqual({ steps: [] });
    expect(structuredOutput(r, false)).toBeUndefined();
  });
});
