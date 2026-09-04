import { describe, expect, it } from 'vitest';

import { createDefaultSpawn } from '../src/spawn.js';

describe('bounded process transport', () => {
  it('kills a child that ignores SIGTERM within the configured timeout', () => {
    const spawn = createDefaultSpawn(
      { ...process.env, GOAL_GEN_BIN: process.execPath },
      150
    );
    const started = Date.now();
    expect(() =>
      spawn([
        '-e',
        "process.on('SIGTERM', () => {}); setTimeout(() => {}, 1500)",
      ])
    ).toThrow(/timed out after 150ms/);
    expect(Date.now() - started).toBeLessThan(1200);
  });

  it('does not describe a spontaneous termination as a timeout', () => {
    const spawn = createDefaultSpawn({
      ...process.env,
      GOAL_GEN_BIN: process.execPath,
    });
    expect(() => spawn(['-e', "process.kill(process.pid, 'SIGTERM')"])).toThrow(
      /terminated by SIGTERM/
    );
  });
});
