import { describe, expect, it } from 'vitest';

import { AppErrorException } from '../src/errors.js';
import {
  UNSUPPORTED_CAPABILITIES,
  unsupportedCapability,
  type UnsupportedCapability,
} from '../src/runtime.js';
import { JulesSdkAdapter } from '../src/sdk-adapter.js';

describe('unsupported capabilities (R11)', () => {
  it.each([
    'cancel',
    'pause',
    'resume',
    'cost',
    'exactly-once',
  ] as UnsupportedCapability[])(
    '%s returns JULES_UNSUPPORTED_CAPABILITY with a CapabilityResult reason',
    (name) => {
      const capability = UNSUPPORTED_CAPABILITIES[name];
      expect(capability.supported).toBe(false);
      try {
        unsupportedCapability(name);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AppErrorException);
        const app = (err as AppErrorException).appError;
        expect(app.code).toBe('JULES_UNSUPPORTED_CAPABILITY');
        expect(app.retryable).toBe(false);
        expect(app.message).toContain(
          capability.supported ? '' : capability.reason
        );
      }
    }
  );

  it('the shipped adapter exposes exactly three writes and no cancel, pause, resume or blocking method', () => {
    const methods = Object.getOwnPropertyNames(JulesSdkAdapter.prototype)
      .filter((name) => name !== 'constructor')
      .sort();
    // Public surface: reads, plus createSession / sendMessage / approvePlan.
    // The rest are private helpers (fail, sessionClient, dispatchedSince, writeFailure).
    expect(methods).toEqual(
      [
        'approvePlan',
        'close',
        'createSession',
        'dispatchedSince',
        'fail',
        'getSession',
        'getSource',
        'listActivities',
        'listSessions',
        'listSources',
        'sendMessage',
        'sessionClient',
        'writeFailure',
      ].sort()
    );
    for (const forbidden of [
      'cancel',
      'pause',
      'resume',
      'run',
      'all',
      'result',
      'ask',
      'waitFor',
      'stream',
      'delete',
    ]) {
      expect(methods).not.toContain(forbidden);
    }
    const writes = methods.filter((m) =>
      /^(create|send|approve|cancel|pause|resume|delete|archive|unarchive)/.test(
        m
      )
    );
    expect(writes.sort()).toEqual(
      ['approvePlan', 'createSession', 'sendMessage'].sort()
    );
  });
});
