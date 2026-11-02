import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runTurn } from '../src/process';

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
      onSpawn: (p) => (pid = p),
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ status: 'SUCCESS', stdin: 0 });
    expect(out.stderr).toBe('note');
    expect(out.killedByDeadline).toBe(false);
    expect(pid).toBeGreaterThan(0);
  });

  it('a deadline sends SIGTERM and marks killedByDeadline', async () => {
    const f = script(
      "process.on('SIGTERM',()=>{process.stdout.write('partial');process.exit(1)});setInterval(()=>{},1000);"
    );
    const out = await runTurn(inv(f), { deadlineMs: 300, graceMs: 2_000 });
    expect(out.killedByDeadline).toBe(true);
    expect(out.stdout).toBe('partial');
  });

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const f = script("process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
    const out = await runTurn(inv(f), { deadlineMs: 200, graceMs: 200 });
    expect(out.killedByDeadline).toBe(true);
    expect(out.signal).toBe('SIGKILL');
  });

  it('an abort marks the run cancelled', async () => {
    const f = script('setInterval(()=>{},1000);');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const out = await runTurn(inv(f), { deadlineMs: 5_000, signal: ac.signal });
    expect(out.cancelled).toBe(true);
    expect(out.killedByDeadline).toBe(false);
  });

  it('a missing binary is AGY_NOT_INSTALLED', async () => {
    await expect(
      runTurn(
        { file: 'agy-definitely-missing', args: [], cwd: undefined, env: {} },
        { deadlineMs: 1_000 }
      )
    ).rejects.toMatchObject({ code: 'AGY_NOT_INSTALLED' });
  });
});
