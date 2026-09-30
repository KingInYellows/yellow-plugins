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

  it('the shipped adapter exposes no mutating or cancelling method', () => {
    const methods = Object.getOwnPropertyNames(JulesSdkAdapter.prototype)
      .filter((name) => name !== 'constructor')
      .sort();
    expect(methods).toEqual(
      [
        'close',
        'fail',
        'getSession',
        'getSource',
        'listActivities',
        'listSessions',
        'listSources',
        'sessionClient',
      ].sort()
    );
  });
});
