import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CliDeps } from '../src/cli';
import { main } from '../src/cli';
import { writeHostConfig } from '../src/host-config';
import type { Lifecycle, LifecycleDeps } from '../src/lifecycle';
import { readJournal, writeJournal } from '../src/state';
import type { TtyHandle } from '../src/tty';

import { makeRepo, tmpDir } from './helpers';

/** A terminal that types back the code it was shown (or `answer`). */
function fakeTty(answer?: string): { open: () => TtyHandle; shown: string[] } {
  const shown: string[] = [];
  return {
    shown,
    open: () => ({
      write: (t) => shown.push(t),
      readLine: async () =>
        answer ??
        /Type ([A-Z2-9]{6}) to confirm/.exec(shown.join(''))?.[1] ??
        '',
      close: () => undefined,
    }),
  };
}

function setup(extra: Partial<CliDeps> = {}) {
  const { repo, root } = makeRepo();
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  writeHostConfig(data, {
    version: 1,
    host: { kind: 'posix' },
    worktreeRoot: path.join(root, 'worktrees'),
    schemaPath: path.join(root, 'plan.schema.json'),
    sandboxVerified: false,
  });
  const out: unknown[] = [];
  const deps: CliDeps = {
    env: { YELLOW_AGY_DATA_DIR: data, HOME: process.env['HOME'] },
    stdout: (t) => out.push(JSON.parse(t)),
    ...extra,
  };
  const call = async (...argv: string[]) => {
    const exit = await main(argv, deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { exit, json: out.at(-1) as any };
  };
  return { repo, root, data, call, deps };
}

const authorizeArgs = (repo: string) => [
  'authorize',
  '--repo',
  repo,
  '--branch',
  'agy/*',
  '--operations',
  'create,approve,reply,collect',
  '--allow-command',
  'pnpm test',
  '--min-quota-percent',
  '20',
];

describe('cli', () => {
  it('authorize writes a grant only after the owner types the code', async () => {
    const tty = fakeTty();
    const s = setup({ openTty: tty.open });
    const made = await s.call(...authorizeArgs(s.repo));
    expect(made.exit).toBe(0);
    expect(made.json.grant).toMatchObject({
      repo: fs.realpathSync(s.repo),
      branchPattern: 'agy/*',
      allowCommands: ['pnpm test'],
      minQuotaPercent: 20,
    });
    expect(tty.shown.join('')).toContain('branches:           agy/*');
    const list = await s.call('authorize', '--list');
    expect(list.json.grants).toHaveLength(1);
    const id = made.json.grant.grantId as string;
    const rev = await s.call('authorize', '--revoke', id);
    expect(rev.json).toMatchObject({ ok: true, grantId: id });
    expect((await s.call('authorize', '--list')).json.grants[0].revoked).toBe(
      true
    );
  });

  it('a wrong code or no terminal writes nothing', async () => {
    const wrong = setup({ openTty: fakeTty('AAAAAA').open });
    const w = await wrong.call(...authorizeArgs(wrong.repo));
    expect(w).toMatchObject({
      exit: 2,
      json: { ok: false, error: { code: 'AGY_AUTHORITY_DENIED' } },
    });
    expect((await wrong.call('authorize', '--list')).json.grants).toEqual([]);
    const none = setup({
      openTty: () => {
        throw Object.assign(new Error('no tty'), { code: 'ENXIO' });
      },
    });
    const n = await none.call(...authorizeArgs(none.repo));
    expect(n.json.error.code).toBe('AGY_CONFIRMATION_REQUIRED');
  });

  it('delegate needs a covering grant and runs under it', async () => {
    let seen: LifecycleDeps | undefined;
    let input: unknown;
    const s = setup({
      openTty: fakeTty().open,
      lifecycle: (d) => {
        seen = d;
        return {
          recover: async () => undefined,
          delegate: async (i: unknown) => {
            input = i;
            return { ok: true, localId: 't1', state: 'PLAN_PENDING' };
          },
        } as unknown as Lifecycle;
      },
    });
    const prompt = path.join(s.root, 'prompt.txt');
    fs.writeFileSync(prompt, 'Add b.txt');
    const args = [
      'delegate',
      '--repo',
      s.repo,
      '--branch',
      'agy/one',
      '--base',
      'main',
      '--prompt-file',
      prompt,
    ];
    const denied = await s.call(...args);
    expect(denied.json.error.code).toBe('AGY_AUTHORITY_DENIED');
    expect(denied.exit).toBe(2);
    const g = (await s.call(...authorizeArgs(s.repo))).json.grant;
    const ok = await s.call(...args, '--request-id', 'r1');
    expect(ok.json).toMatchObject({ ok: true, operation: 'delegate' });
    expect(seen).toMatchObject({
      grantId: g.grantId,
      allowCommands: ['pnpm test'],
      sandboxVerified: false,
    });
    expect(input).toMatchObject({
      requestId: 'r1',
      branch: 'agy/one',
      prompt: 'Add b.txt',
      baseBranch: 'main',
      remote: 'origin',
    });
    expect(
      (
        await s.call(
          'delegate',
          '--repo',
          s.repo,
          '--branch',
          'main',
          '--base',
          'main',
          '--prompt-file',
          prompt
        )
      ).json.error.code
    ).toBe('AGY_AUTHORITY_DENIED');
  });

  it('a finished delegate replays after its grant is spent or revoked', async () => {
    const s = setup({
      openTty: fakeTty().open,
      lifecycle: () =>
        ({
          recover: async () => undefined,
          delegate: async () => {
            throw new Error('no new delegate expected');
          },
        }) as unknown as Lifecycle,
    });
    const g = (await s.call(...authorizeArgs(s.repo))).json.grant;
    await s.call('authorize', '--revoke', g.grantId);
    const j = readJournal(s.data);
    writeJournal(s.data, {
      ...j,
      requests: {
        r1: {
          requestId: 'r1',
          op: 'delegate',
          localId: 't1',
          status: 'done',
          outcome: { ok: true, localId: 't1', state: 'PLAN_PENDING' },
          at: new Date().toISOString(),
        },
      },
    });
    const prompt = path.join(s.root, 'p.txt');
    fs.writeFileSync(prompt, 'x');
    const r = await s.call(
      'delegate',
      '--repo',
      s.repo,
      '--branch',
      'agy/x',
      '--base',
      'main',
      '--prompt-file',
      prompt,
      '--request-id',
      'r1'
    );
    expect(r).toMatchObject({ exit: 0, json: { ok: true, localId: 't1' } });
  });

  it('a failed outcome exits with its catalog code', async () => {
    const s = setup({
      openTty: fakeTty().open,
      lifecycle: () =>
        ({
          recover: async () => undefined,
          delegate: async () => ({
            ok: false,
            code: 'AGY_MODEL_ERROR',
            localId: 't1',
            state: 'FAILED',
          }),
        }) as unknown as Lifecycle,
    });
    await s.call(...authorizeArgs(s.repo));
    const prompt = path.join(s.root, 'p.txt');
    fs.writeFileSync(prompt, 'x');
    const r = await s.call(
      'delegate',
      '--repo',
      s.repo,
      '--branch',
      'agy/x',
      '--base',
      'main',
      '--prompt-file',
      prompt
    );
    expect(r).toMatchObject({ exit: 1, json: { ok: false, state: 'FAILED' } });
  });

  it('refuses bad input before anything runs', async () => {
    const s = setup();
    expect((await s.call('push')).json.error.code).toBe('AGY_INVALID_INPUT');
    expect((await s.call('status', '--bogus')).json.error.code).toBe(
      'AGY_INVALID_INPUT'
    );
    expect((await s.call('approve', '--task', 'nope')).json.error.code).toBe(
      'AGY_INVALID_INPUT'
    );
    expect((await s.call('status')).json).toMatchObject({
      ok: true,
      tasks: [],
    });
    const empty = path.join(tmpDir('yellow-agy-cli-'), 'data');
    fs.mkdirSync(empty, { mode: 0o700 });
    const out: string[] = [];
    await main(['delegate'], {
      env: { YELLOW_AGY_DATA_DIR: empty },
      stdout: (t) => out.push(t),
    });
    expect(JSON.parse(out[0] ?? '').error.code).toBe('AGY_NOT_INSTALLED');
  });
});
