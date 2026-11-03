import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import {
  BRIDGE_GROUP_SCRIPT,
  BRIDGE_PGID_MARKER,
  bridgeKillCommand,
} from '../src/invocation';
import { runTurn, splitPgidMarker } from '../src/process';

import { tmpDir } from './helpers';

function script(body: string): string {
  const dir = tmpDir('agy-proc-');
  const file = path.join(dir, 'fake.js');
  fs.writeFileSync(file, body);
  return file;
}

const inv = (file: string) => ({
  file: process.execPath,
  args: [file],
  cwd: undefined,
  env: { PATH: process.env['PATH'] ?? '' },
});

describe('runTurn', () => {
  it('captures stdout, stderr and the exit code with stdin closed', async () => {
    const f = script(
      "let n=0;process.stdin.on('data',()=>n++);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({status:'SUCCESS',stdin:n}));process.stderr.write('note');process.exit(0)});"
    );
    let pid = 0;
    const out = await runTurn(inv(f), {
      deadlineMs: 5_000,
      onSpawn: (p) => {
        pid = p;
      },
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ status: 'SUCCESS', stdin: 0 });
    expect(out.stderr).toBe('note');
    expect(out.killedByDeadline).toBe(false);
    expect(pid).toBeGreaterThan(0);
  });

  // POSIX signal semantics; Windows has no SIGTERM handler or signal name.
  it.skipIf(process.platform === 'win32')(
    'a deadline sends SIGTERM and marks killedByDeadline',
    async () => {
      const f = script(
        "process.on('SIGTERM',()=>{process.stdout.write('partial');process.exit(1)});setInterval(()=>{},1000);"
      );
      const out = await runTurn(inv(f), { deadlineMs: 300, graceMs: 2_000 });
      expect(out.killedByDeadline).toBe(true);
      expect(out.stdout).toBe('partial');
    }
  );

  // POSIX signal semantics; Windows has no SIGTERM handler or signal name.
  it.skipIf(process.platform === 'win32')(
    'escalates to SIGKILL when SIGTERM is ignored',
    async () => {
      const f = script(
        "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"
      );
      const out = await runTurn(inv(f), { deadlineMs: 200, graceMs: 200 });
      expect(out.killedByDeadline).toBe(true);
      expect(out.signal).toBe('SIGKILL');
    }
  );

  it('an abort marks the run cancelled', async () => {
    const f = script('setInterval(()=>{},1000);');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const out = await runTurn(inv(f), { deadlineMs: 5_000, signal: ac.signal });
    expect(out.cancelled).toBe(true);
    expect(out.killedByDeadline).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'settles when agy exits but a tool it started still holds the pipes',
    async () => {
      // The leader spawns a long sleeper sharing its stdout, then exits.
      const f = script(
        "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});process.stdout.write('done');process.exit(0);"
      );
      const started = Date.now();
      const out = await runTurn(inv(f), { deadlineMs: 20_000, graceMs: 500 });
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(out.exitCode).toBe(0);
      expect(out.stdout).toBe('done');
    },
    15_000
  );

  it('a missing binary is AGY_NOT_INSTALLED', async () => {
    await expect(
      runTurn(
        { file: 'agy-definitely-missing', args: [], cwd: undefined, env: {} },
        { deadlineMs: 1_000 }
      )
    ).rejects.toMatchObject({ code: 'AGY_NOT_INSTALLED' });
  });
});

describe('bridge Linux process group', () => {
  it('bridgeKillCommand signals the negative pgid through wsl.exe', () => {
    expect(bridgeKillCommand('Ubuntu-24.04', 4242, 'TERM')).toEqual({
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu-24.04', '-e', 'kill', '-s', 'TERM', '--', '-4242'],
    });
    expect(bridgeKillCommand(undefined, 7, 'KILL').args[0]).toBe('-e');
    expect(() => bridgeKillCommand(undefined, 1, 'KILL')).toThrow(AgyError);
  });

  it('splitPgidMarker finds the marker line, even after a WSL warning', () => {
    expect(splitPgidMarker(Buffer.from(`${BRIDGE_PGID_MARKER}12`))).toBe(
      undefined
    );
    const hit = splitPgidMarker(Buffer.from(`${BRIDGE_PGID_MARKER}12\nwarn`));
    expect(hit?.pgid).toBe(12);
    expect(hit?.rest.toString()).toBe('warn');
    const late = splitPgidMarker(
      Buffer.from(`wsl: Failed to translate\r\n\0${BRIDGE_PGID_MARKER}34\r\nx`)
    );
    expect(late?.pgid).toBe(34);
    expect(late?.rest.toString()).toBe('wsl: Failed to translate\r\nx');
    // No marker yet: keep waiting, until the scan limit passes.
    expect(splitPgidMarker(Buffer.from('setsid: not found\n'))).toBe(undefined);
    const flood = Buffer.from(`${'x'.repeat(100)}\n`.repeat(700));
    const miss = splitPgidMarker(flood);
    expect(miss?.pgid).toBeUndefined();
    expect(miss?.rest.equals(flood)).toBe(true);
    // A marker past the limit is not scanned for, even in one buffer.
    const past = Buffer.concat([
      flood,
      Buffer.from(`${BRIDGE_PGID_MARKER}56\n`),
    ]);
    const skipped = splitPgidMarker(past);
    expect(skipped?.pgid).toBeUndefined();
    expect(skipped?.rest.equals(past)).toBe(true);
  });

  // setsid(1) is util-linux; macOS has no such command.
  it.skipIf(process.platform !== 'linux')(
    'a deadline signals the group the wrapper reports, not only the spawned process',
    async () => {
      const kills: string[][] = [];
      const out = await runTurn(
        {
          file: 'setsid',
          args: ['-w', 'sh', '-c', BRIDGE_GROUP_SCRIPT, 'sh', 'sleep', '30'],
          cwd: undefined,
          env: { PATH: process.env['PATH'] ?? '' },
          linuxGroup: {},
        },
        {
          deadlineMs: 300,
          graceMs: 300,
          // Stand-in for wsl.exe: run the same kill locally.
          spawnKill: (_file, args) => {
            const at = args.indexOf('kill');
            kills.push(args.slice(at));
            try {
              execFileSync('kill', args.slice(at + 1), { stdio: 'ignore' });
            } catch {
              // group already gone
            }
          },
        }
      );
      expect(out.killedByDeadline).toBe(true);
      expect(out.stderr).not.toContain(BRIDGE_PGID_MARKER);
      expect(kills.length).toBeGreaterThan(0);
      const pgid = Number(kills[0]?.at(-1)?.slice(1));
      expect(pgid).toBeGreaterThan(1);
      expect(() => process.kill(-pgid, 0)).toThrow();
    }
  );

  it('rejects deadlines and grace periods Node would clamp to 1 ms', async () => {
    const f = script('process.exit(0);');
    for (const opts of [
      { deadlineMs: 2 ** 31 },
      { deadlineMs: 1_000, graceMs: -5 },
      { deadlineMs: 1_000, graceMs: Number.POSITIVE_INFINITY },
    ]) {
      await expect(runTurn(inv(f), opts), JSON.stringify(opts)).rejects.toThrow(
        AgyError
      );
    }
  });

  it('a failed onSpawn write stops the turn and rejects with that error', async () => {
    const f = script('setInterval(()=>{},1000);');
    const boom = new AgyError('AGY_INTERNAL', 'journal write failed');
    await expect(
      runTurn(inv(f), {
        deadlineMs: 10_000,
        graceMs: 200,
        onSpawn: () => Promise.reject(boom),
      })
    ).rejects.toBe(boom);
  });
});
