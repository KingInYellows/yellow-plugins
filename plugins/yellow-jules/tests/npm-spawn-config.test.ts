import { describe, expect, it } from 'vitest';

import { npmSpawnConfig } from '../src/sdk-resolver.js';

describe('npmSpawnConfig', () => {
  it('uses npm.cmd through a shell on win32', () => {
    expect(npmSpawnConfig('win32')).toEqual({
      command: 'npm.cmd',
      shell: true,
    });
  });

  it.each(['linux', 'darwin'] as const)(
    'uses plain npm without a shell on %s',
    (p) => {
      expect(npmSpawnConfig(p)).toEqual({ command: 'npm', shell: false });
    }
  );
});
