import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = resolve(
  __dirname,
  '../../scripts/smoke-codex-plugin-lifecycle.js'
);
const { summarizeControl } = createRequire(import.meta.url)(script);
const commands = [
  { type: 'commandExecution', command: 'git push', exitCode: 0 },
  {
    type: 'commandExecution',
    command: 'gt modify -m "bad message"',
    exitCode: 0,
  },
];
const runs = [
  {
    id: 'session',
    eventName: 'sessionStart',
    status: 'completed',
    entries: [],
  },
  {
    id: 'push',
    eventName: 'preToolUse',
    status: 'blocked',
    entries: [{ kind: 'feedback', text: 'Raw git push denied' }],
  },
  { id: 'modify', eventName: 'preToolUse', status: 'completed', entries: [] },
  {
    id: 'warning',
    eventName: 'postToolUse',
    status: 'completed',
    entries: [{ kind: 'warning', text: 'Use conventional commits' }],
  },
];
function trustedEvents() {
  return [
    ...runs.flatMap((run) => [
      { method: 'hook/started', params: { run } },
      { method: 'hook/completed', params: { run } },
    ]),
    { method: 'item/completed', params: { item: commands[1] } },
  ];
}
const modify = { bin: 'gt', args: ['modify', '-m', 'bad message'] };
const push = { bin: 'git', args: ['push'] };

describe('optional Codex lifecycle gate', () => {
  it('plans controls without using CLI, profiles, or isolation tools', () => {
    const result = spawnSync(process.execPath, [script, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_BIN: '/absent' },
    });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.controls).toEqual(['untrusted', 'trusted']);
    expect(report.commands).toEqual(['git push', 'gt modify -m "bad message"']);
    expect(report.skillActivation).toBe('not-tested');
  });

  it('rejects public access to internal execution and unknown arguments', () => {
    for (const args of [['--inside', '/tmp/arbitrary'], ['--bad']]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, YELLOW_CODEX_FIXTURE: '' },
      });
      expect(result.status).toBe(1);
    }
  });

  it('accepts actual event, command and stub evidence for both controls', () => {
    expect(
      summarizeControl(trustedEvents(), [modify], true).pushStubCalls
    ).toBe(0);
    const events = commands.map((item) => ({
      method: 'item/completed',
      params: { item },
    }));
    expect(summarizeControl(events, [push, modify], false).pushStubCalls).toBe(
      1
    );
  });

  it('rejects a trusted push reaching the mutation stub', () => {
    expect(() =>
      summarizeControl(trustedEvents(), [push, modify], true)
    ).toThrow('git push trust control mismatch');
  });

  it('rejects an untrusted negative control that never ran the push', () => {
    const events = commands.map((item) => ({
      method: 'item/completed',
      params: { item },
    }));
    expect(() => summarizeControl(events, [modify], false)).toThrow(
      'git push trust control mismatch'
    );
  });

  it.each(['sessionStart', 'preToolUse', 'postToolUse'])(
    'rejects absent %s lifecycle evidence',
    (event) => {
      const events = trustedEvents().filter(
        (e) => !('run' in e.params && e.params.run.eventName === event)
      );
      expect(() => summarizeControl(events, [modify], true)).toThrow();
    }
  );

  it('rejects a warning masquerading as a denial', () => {
    const events = trustedEvents();
    for (const event of events) {
      if ('run' in event.params && event.params.run.id === 'push')
        event.params.run = { ...event.params.run, status: 'completed' };
    }
    expect(() => summarizeControl(events, [modify], true)).toThrow(
      'Missing push denial evidence'
    );
  });

  it('rejects a failed command despite matching stub logs', () => {
    const events = trustedEvents();
    events[events.length - 1] = {
      method: 'item/completed',
      params: { item: { ...commands[1], exitCode: 1 } },
    };
    expect(() => summarizeControl(events, [modify], true)).toThrow(
      'Trusted command execution mismatch'
    );
  });

  it('rejects unexpected untrusted hook execution', () => {
    expect(() =>
      summarizeControl(trustedEvents(), [push, modify], false)
    ).toThrow();
  });
});
