import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectHost,
  readHostConfig,
  writeHostConfig,
} from '../src/host-config';
import { confirmOnTty } from '../src/tty';

import { tmpDir } from './helpers';

describe('host config', () => {
  it('records a POSIX host with a real worktree root', () => {
    const base = tmpDir('yellow-agy-host-');
    const c = detectHost({
      env: { XDG_DATA_HOME: base },
      platform: 'linux',
      which: (cmd) => cmd === 'agy',
    });
    expect(c.host).toEqual({ kind: 'posix' });
    expect(c.worktreeRoot).toBe(path.join(base, 'yellow-agy', 'worktrees'));
    expect(fs.statSync(c.worktreeRoot).isDirectory()).toBe(true);
    expect(() =>
      detectHost({ env: {}, platform: 'linux', which: () => false })
    ).toThrow(expect.objectContaining({ code: 'AGY_NOT_INSTALLED' }));
    // Native Windows spawns agy.exe, so a bare `agy` shim doesn't count.
    expect(() =>
      detectHost({
        env: {},
        platform: 'win32',
        which: (cmd) => cmd === 'agy',
      })
    ).toThrow(expect.objectContaining({ code: 'AGY_NOT_INSTALLED' }));
    const data = tmpDir('yellow-agy-data-');
    writeHostConfig(data, c);
    expect(readHostConfig(data)).toEqual(c);
  });

  it('resolves the WSL worktree root with realpath and refuses /mnt', () => {
    const calls: string[][] = [];
    const bridge = (real: string) =>
      detectHost({
        env: { YELLOW_AGY_WSL_DISTRO: 'Ubuntu' },
        platform: 'win32',
        which: (cmd) => cmd === 'wsl.exe',
        wslRun: (distro, args) => {
          calls.push([distro ?? '', ...args]);
          return args.includes('command -v agy') ? '/usr/bin/agy' : real;
        },
      });
    const c = bridge('/home/u/.local/share/yellow-agy/worktrees');
    expect(c.host).toEqual({ kind: 'wsl-bridge', distro: 'Ubuntu' });
    expect(c.schemaPath).toBe(
      '/home/u/.local/share/yellow-agy/plan.schema.json'
    );
    expect(calls[1]?.slice(0, 3)).toEqual(['Ubuntu', 'sh', '-c']);
    expect(calls[1]?.[3]).toContain('realpath -e --');
    expect(() => bridge('/mnt/c/Users/u/worktrees')).toThrow(
      expect.objectContaining({ code: 'AGY_BRIDGE' })
    );
    expect(() =>
      detectHost({
        env: { YELLOW_AGY_WSL_DISTRO: '-d x' },
        platform: 'win32',
        which: (cmd) => cmd === 'wsl.exe',
      })
    ).toThrow(expect.objectContaining({ code: 'AGY_BRIDGE' }));
  });

  it('refuses until setup has recorded a host', () => {
    const data = tmpDir('yellow-agy-data-');
    expect(() => readHostConfig(data)).toThrow(
      expect.objectContaining({ code: 'AGY_NOT_INSTALLED' })
    );
    fs.writeFileSync(
      path.join(data, 'host.json'),
      '{"version":1,"host":{"kind":"vm"}}'
    );
    expect(() => readHostConfig(data)).toThrow(
      expect.objectContaining({ code: 'AGY_INTERNAL' })
    );
  });
});

describe('terminal confirmation', () => {
  const handle = (readLine: () => Promise<string | null>) => () => ({
    write: () => undefined,
    readLine,
    close: () => undefined,
  });

  it('refuses on EOF and on timeout', async () => {
    await expect(
      confirmOnTty({ summary: 's', openTty: handle(async () => null) })
    ).rejects.toMatchObject({ code: 'AGY_AUTHORITY_DENIED' });
    await expect(
      confirmOnTty({
        summary: 's',
        openTty: handle(async () => {
          throw new Error('timeout');
        }),
      })
    ).rejects.toMatchObject({ code: 'AGY_AUTHORITY_DENIED' });
  });
});
