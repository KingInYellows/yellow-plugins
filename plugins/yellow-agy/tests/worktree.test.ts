import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import type { GroupKill, SpawnSpec } from '../src/host-exec';
import { createHostExec, hostCommand, runSpawn } from '../src/host-exec';
import { BRIDGE_GROUP_SCRIPT } from '../src/invocation';
import {
  collectWorktree,
  createWorktree,
  deleteBranchIfEmpty,
  ignoredCollisions,
  removeWorktree,
  resetToSnapshot,
  snapshotRefs,
  snapshotWorktree,
  validateBranchName,
} from '../src/worktree';

import { git, makeRepo, testEnv } from './helpers';

const exec = createHostExec({ kind: 'posix' }, testEnv);

async function setup(): Promise<{ repo: string; wt: string; base: string }> {
  const { repo, root } = makeRepo();
  const wt = path.join(root, 'wt', 't1');
  const base = await createWorktree(exec, {
    repo,
    worktree: wt,
    branch: 'agy/t1',
    remote: 'origin',
    baseBranch: 'main',
  });
  return { repo, wt, base };
}

describe('worktree', () => {
  it('creates a worktree on a new branch at the fetched base', async () => {
    const { repo, wt, base } = await setup();
    expect(git(wt, 'rev-parse', 'HEAD').trim()).toBe(base);
    expect(git(wt, 'branch', '--show-current').trim()).toBe('agy/t1');
    // The base came from a private ref, which is gone afterwards.
    expect(git(repo, 'for-each-ref', 'refs/yellow-agy/fetch')).toBe('');
    await expect(
      createWorktree(exec, {
        repo,
        worktree: `${wt}-2`,
        branch: 'agy/t1',
        remote: 'origin',
        baseBranch: 'main',
      })
    ).rejects.toMatchObject({ code: 'AGY_WORKTREE' });
  });

  it('sweeps a leftover private fetch ref before creating', async () => {
    const { repo, wt, base } = await setup();
    git(repo, 'update-ref', 'refs/yellow-agy/fetch/stale', base);
    await createWorktree(exec, {
      repo,
      worktree: `${wt}-2`,
      branch: 'agy/t2',
      remote: 'origin',
      baseBranch: 'main',
    });
    expect(git(repo, 'for-each-ref', 'refs/yellow-agy/fetch')).toBe('');
  });

  it('drops the new branch when worktree add fails on an occupied path', async () => {
    const { repo, root } = makeRepo();
    const wt = path.join(root, 'wt', 'busy');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, 'f'), 'x');
    const opts = {
      repo,
      worktree: wt,
      branch: 'agy/busy',
      remote: 'origin',
      baseBranch: 'main',
    };
    await expect(createWorktree(exec, opts)).rejects.toBeInstanceOf(AgyError);
    expect(git(repo, 'branch', '--list', 'agy/busy')).toBe('');
    // Once the obstruction is gone, a retry succeeds.
    fs.rmSync(wt, { recursive: true });
    await createWorktree(exec, opts);
    expect(git(wt, 'branch', '--show-current').trim()).toBe('agy/busy');
  });

  it('leaves alone a branch another creator made after the existence check', async () => {
    const { repo, root } = makeRepo();
    const racing = {
      ...exec,
      git: async (
        args: readonly string[],
        o: Parameters<typeof exec.git>[1]
      ) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin') {
          git(repo, 'branch', 'agy/race', 'main');
        }
        return exec.git(args, o);
      },
    };
    const sha = git(repo, 'rev-parse', 'main').trim();
    await expect(
      createWorktree(racing, {
        repo,
        worktree: path.join(root, 'wt', 'race'),
        branch: 'agy/race',
        remote: 'origin',
        baseBranch: 'main',
      })
    ).rejects.toMatchObject({ code: 'AGY_WORKTREE' });
    expect(git(repo, 'rev-parse', 'agy/race').trim()).toBe(sha);
  });

  it('rejects a .lock component anywhere in a branch name', () => {
    expect(() => validateBranchName('agy/x.lock/y')).toThrow(AgyError);
    expect(validateBranchName('agy/x.locked/y')).toBe('agy/x.locked/y');
  });

  it('rejects unsafe branch names', () => {
    for (const bad of ['-x', 'a..b', 'a/', 'a.lock', 'a b', 'a/.b', '@{x}']) {
      expect(() => validateBranchName(bad)).toThrow(AgyError);
    }
    expect(validateBranchName('agy/feature-1')).toBe('agy/feature-1');
  });

  it('snapshot and reset restore staged, unstaged, untracked and deleted work', async () => {
    const { wt } = await setup();
    // Earlier-turn work: a staged edit, an unstaged edit on top, a new file.
    fs.writeFileSync(path.join(wt, 'a.txt'), 'staged\n');
    git(wt, 'add', 'a.txt');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'unstaged\n');
    fs.writeFileSync(path.join(wt, 'new.txt'), 'new\n');
    const status = git(wt, 'status', '--porcelain');
    const snap = await snapshotWorktree(exec, wt, 't1');
    expect(git(wt, 'rev-parse', snapshotRefs('t1').preTurn).trim()).toBe(
      snap.commit
    );
    // The real index is untouched by the snapshot.
    expect(git(wt, 'status', '--porcelain')).toBe(status);

    // The turn makes a mess, including deleting a tracked file.
    fs.rmSync(path.join(wt, '.gitignore'));
    fs.rmSync(path.join(wt, 'new.txt'));
    fs.writeFileSync(path.join(wt, 'a.txt'), 'agy\n');
    fs.writeFileSync(path.join(wt, 'junk.txt'), 'junk\n');
    git(wt, 'add', '-A');

    await resetToSnapshot(exec, wt, 't1', snap);
    expect(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8')).toBe('unstaged\n');
    expect(fs.readFileSync(path.join(wt, 'new.txt'), 'utf8')).toBe('new\n');
    expect(fs.readFileSync(path.join(wt, '.gitignore'), 'utf8')).toBe(
      'build/\n*.log\n'
    );
    expect(fs.existsSync(path.join(wt, 'junk.txt'))).toBe(false);
    expect(git(wt, 'show', ':a.txt')).toBe('staged\n');
    expect(git(wt, 'status', '--porcelain')).toBe(status);
    expect(git(wt, 'for-each-ref', 'refs/yellow-agy/')).toBe('');
  });

  it('reset keeps files ignored only by an uncommitted ignore rule', async () => {
    const { wt } = await setup();
    // Pre-turn: an uncommitted rule and the ignored file it protects, plus a
    // special-character name to exercise pattern escaping.
    fs.appendFileSync(path.join(wt, '.gitignore'), 'private.local\n[x]*.env\n');
    fs.writeFileSync(path.join(wt, 'private.local'), 'secret\n');
    fs.writeFileSync(path.join(wt, '[x]*.env'), 'k=v\n');
    fs.writeFileSync(path.join(wt, 'untracked.txt'), 'pre\n');
    const snap = await snapshotWorktree(exec, wt, 't1');
    // The turn rewrites an untracked file and adds junk.
    fs.writeFileSync(path.join(wt, 'untracked.txt'), 'agy\n');
    fs.writeFileSync(path.join(wt, 'junk.txt'), 'junk\n');
    await resetToSnapshot(exec, wt, 't1', snap);
    expect(fs.readFileSync(path.join(wt, 'private.local'), 'utf8')).toBe(
      'secret\n'
    );
    expect(fs.existsSync(path.join(wt, '[x]*.env'))).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'untracked.txt'), 'utf8')).toBe(
      'pre\n'
    );
    expect(fs.existsSync(path.join(wt, 'junk.txt'))).toBe(false);
    const scratch = git(
      wt,
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'yellow-agy-clean-t1'
    ).trim();
    expect(fs.existsSync(scratch)).toBe(false);
  });

  it.runIf(process.platform === 'linux')(
    'refuses a reset before touching anything when an ignored name is not UTF-8',
    async () => {
      const { wt } = await setup();
      const snap = await snapshotWorktree(exec, wt, 't1');
      const name = Buffer.concat([
        Buffer.from(path.join(wt, 'x')),
        Buffer.from([0xe9]),
        Buffer.from('.log'),
      ]);
      fs.writeFileSync(name, 'keep\n');
      fs.writeFileSync(path.join(wt, 'junk.txt'), 'junk\n');
      await expect(resetToSnapshot(exec, wt, 't1', snap)).rejects.toMatchObject(
        { code: 'AGY_WORKTREE' }
      );
      expect(fs.existsSync(name)).toBe(true);
      expect(fs.existsSync(path.join(wt, 'junk.txt'))).toBe(true);
    }
  );

  it('reset keeps an ignored file that the snapshot rules un-ignore', async () => {
    const { wt } = await setup();
    // Committed: *.log is ignored but keep.log is negated, so tracked-able.
    fs.appendFileSync(path.join(wt, '.gitignore'), '!keep.log\n');
    git(wt, 'commit', '-q', '-am', 'negate keep.log');
    const snap = await snapshotWorktree(exec, wt, 't1');
    // The turn drops the negation and creates the file, now ignored, inside
    // an ignored dir as well.
    fs.writeFileSync(path.join(wt, '.gitignore'), 'build/\n*.log\n');
    fs.writeFileSync(path.join(wt, 'keep.log'), 'mine\n');
    fs.mkdirSync(path.join(wt, 'build'));
    fs.writeFileSync(path.join(wt, 'build', 'keep.log'), 'mine too\n');
    await resetToSnapshot(exec, wt, 't1', snap);
    expect(fs.readFileSync(path.join(wt, 'keep.log'), 'utf8')).toBe('mine\n');
    expect(fs.existsSync(path.join(wt, 'build', 'keep.log'))).toBe(true);
    expect(fs.readFileSync(path.join(wt, '.gitignore'), 'utf8')).toContain(
      '!keep.log'
    );
    expect(git(wt, 'status', '--porcelain')).toBe('?? keep.log\n');
  });

  it('refuses a reset that would delete an ignored file in the way', async () => {
    const { wt } = await setup();
    fs.mkdirSync(path.join(wt, 'build'));
    fs.writeFileSync(path.join(wt, 'build', 'out.js'), 'x\n');
    const snap = await snapshotWorktree(exec, wt, 't1');
    expect(await ignoredCollisions(exec, wt, snap)).toEqual([]);
    // Ignored files no tracked path needs are fine.
    fs.writeFileSync(path.join(wt, 'x.log'), 'log\n');
    expect(await ignoredCollisions(exec, wt, snap)).toEqual([]);
    // A tracked path that turns into an ignored untracked file collides.
    git(wt, 'add', '-f', 'build/out.js');
    git(wt, 'commit', '-q', '-m', 'track build');
    const snap2 = await snapshotWorktree(exec, wt, 't1');
    git(wt, 'rm', '-q', '--cached', 'build/out.js');
    // The whole ignored dir is reported, since git lists it collapsed.
    expect(await ignoredCollisions(exec, wt, snap2)).toEqual(['build']);
    await expect(resetToSnapshot(exec, wt, 't1', snap2)).rejects.toMatchObject({
      code: 'AGY_WORKTREE',
    });
  });

  it('collect refuses a worktree holding a nested git repository', async () => {
    const { wt, base } = await setup();
    const nested = path.join(wt, 'nested');
    fs.mkdirSync(nested);
    git(nested, 'init', '-q');
    fs.writeFileSync(path.join(nested, 'only-copy.txt'), 'x\n');
    git(nested, 'add', 'only-copy.txt');
    git(
      nested,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-qm',
      'x'
    );
    const status = git(wt, 'status', '--porcelain');
    await expect(collectWorktree(exec, wt, 't1', base)).rejects.toMatchObject({
      code: 'AGY_WORKTREE',
    });
    expect(git(wt, 'status', '--porcelain')).toBe(status);
    expect(fs.existsSync(path.join(nested, 'only-copy.txt'))).toBe(true);
  });

  it('collect returns commits and uncommitted changes without touching the index', async () => {
    const { wt, base } = await setup();
    fs.writeFileSync(path.join(wt, 'a.txt'), 'committed\n');
    git(wt, 'commit', '-q', '-am', 'change a');
    fs.writeFileSync(path.join(wt, 'b.txt'), 'untracked\n');
    fs.writeFileSync(path.join(wt, 'c.txt'), 'staged only\n');
    git(wt, 'add', 'c.txt');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'dirty\n');
    const status = git(wt, 'status', '--porcelain');
    const got = await collectWorktree(exec, wt, 't1', base);
    expect(got.uncommitted.toString()).toContain('+staged only');
    expect(got.commitCount).toBe(1);
    expect(got.commits.toString()).toContain('Subject: [PATCH] change a');
    expect(got.uncommitted.toString()).toContain('+untracked');
    expect(got.uncommitted.toString()).toContain('+dirty');
    expect(git(wt, 'status', '--porcelain')).toBe(status);
    await expect(
      collectWorktree(exec, wt, '../../x', base)
    ).rejects.toMatchObject({ code: 'AGY_INVALID_INPUT' });
  });

  it('collect runs no external diff or textconv helper', async () => {
    const { wt, base } = await setup();
    const marker = path.join(wt, '..', 'helper-ran');
    const helper = path.join(wt, '..', 'helper.sh');
    fs.writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\necho HIJACK\n`, {
      mode: 0o755,
    });
    git(wt, 'config', 'diff.external', helper);
    git(wt, 'config', 'diff.conv.textconv', helper);
    fs.writeFileSync(path.join(wt, '.gitattributes'), '*.txt diff=conv\n');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'committed\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'change a');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'dirty\n');
    const got = await collectWorktree(exec, wt, 't1', base);
    expect(fs.existsSync(marker)).toBe(false);
    expect(got.commits.toString()).not.toContain('HIJACK');
    expect(got.uncommitted.toString()).toContain('+dirty');
    expect(got.uncommitted.toString()).not.toContain('HIJACK');
  });

  it('collect writes plain patches whatever the color and prefix config', async () => {
    const { wt, base } = await setup();
    git(wt, 'config', 'color.ui', 'always');
    git(wt, 'config', 'color.diff', 'always');
    git(wt, 'config', 'diff.noprefix', 'true');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'committed\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'change a');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'dirty\n');
    const got = await collectWorktree(exec, wt, 't1', base);
    for (const patch of [got.commits, got.uncommitted]) {
      expect(patch.includes(0x1b)).toBe(false);
      expect(patch.toString()).toContain('--- a/a.txt');
    }
  });

  it('collect keeps non-UTF-8 bytes in patches', async () => {
    const { wt, base } = await setup();
    fs.writeFileSync(
      path.join(wt, 'latin1.txt'),
      Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])
    );
    const got = await collectWorktree(exec, wt, 't1', base);
    expect(got.uncommitted.includes(Buffer.from([0x66, 0xe9, 0x0a]))).toBe(
      true
    );
  });

  it('removes the worktree and deletes only an empty branch', async () => {
    const { repo, wt, base } = await setup();
    await removeWorktree(exec, repo, wt);
    expect(fs.existsSync(wt)).toBe(false);
    expect(await deleteBranchIfEmpty(exec, repo, 'agy/t1', base)).toBe(true);
    expect(await deleteBranchIfEmpty(exec, repo, 'agy/t1', base)).toBe(false);
  });
});

describe('hostCommand', () => {
  it('bridge commands are exec-only and unset distro git config', () => {
    const spec = hostCommand(
      { kind: 'wsl-bridge' },
      'git',
      ['status'],
      {
        cwd: '/home/o/w',
        env: { GIT_INDEX_FILE: '/home/o/i' },
        filterDrivers: ['lfs'],
      },
      { WSLENV: 'X', GIT_CONFIG_PARAMETERS: "'core.hooksPath=/x'" }
    );
    expect(spec.file).toBe('wsl.exe');
    expect(spec.args.slice(0, 4)).toEqual(['--cd', '/home/o/w', '-e', 'env']);
    expect(spec.args).toContain('GIT_CONFIG_PARAMETERS');
    expect(spec.args).toContain('GIT_CONFIG_VALUE_0=/dev/null');
    expect(spec.args).toContain('GIT_CONFIG_VALUE_1=false');
    expect(spec.args).toContain('GIT_CONFIG_KEY_10=filter.lfs.clean');
    expect(spec.args.slice(-2)).toEqual(['git', 'status']);
    // The command leads its own Linux group and reports its pgid (CLAUDE-246).
    expect(spec.args.slice(-8, -2)).toEqual([
      'setsid',
      '-w',
      'sh',
      '-c',
      BRIDGE_GROUP_SCRIPT,
      'sh',
    ]);
    expect(spec.linuxGroup).toEqual({});
    expect(
      hostCommand(
        { kind: 'wsl-bridge', distro: 'Ubuntu' },
        'git',
        [],
        { cwd: '/home/o/w', filterDrivers: [] },
        {}
      ).linuxGroup
    ).toEqual({ distro: 'Ubuntu' });
    expect(
      hostCommand(
        { kind: 'posix' },
        'git',
        [],
        { cwd: '/x', filterDrivers: [] },
        {}
      ).linuxGroup
    ).toBeUndefined();
    expect(spec.env['WSLENV']).toBeUndefined();
    expect(() =>
      hostCommand(
        { kind: 'wsl-bridge' },
        'git',
        [],
        { cwd: '/mnt/c/x', filterDrivers: [] },
        {}
      )
    ).toThrow(AgyError);
    for (const cwd of ['/mnt', '/home/o/../../mnt/c', '/home//o', 'rel']) {
      expect(
        () =>
          hostCommand(
            { kind: 'wsl-bridge' },
            'git',
            [],
            { cwd, filterDrivers: [] },
            {}
          ),
        cwd
      ).toThrow(AgyError);
    }
    // '/' is allowed (the bridge file ops run there).
    expect(
      hostCommand(
        { kind: 'wsl-bridge' },
        'rm',
        [],
        { cwd: '/', filterDrivers: [] },
        {}
      ).file
    ).toBe('wsl.exe');
  });

  it('callers cannot set GIT_CONFIG_* over the hook overrides', () => {
    expect(() =>
      hostCommand(
        { kind: 'posix' },
        'git',
        [],
        {
          cwd: '/x',
          env: { GIT_CONFIG_COUNT: '0' },
          filterDrivers: [],
        },
        {}
      )
    ).toThrow(AgyError);
  });
});

describe('runSpawn on a bridge Linux group (CLAUDE-246)', () => {
  // Stands in for wsl.exe: `setsid -w` puts the command in a new group that
  // killing the spawned process (or its own group) does not reach.
  const bridgeSpec = (cmd: string[]): SpawnSpec => ({
    file: 'setsid',
    args: ['-w', 'sh', '-c', BRIDGE_GROUP_SCRIPT, 'sh', ...cmd],
    cwd: undefined,
    env: { PATH: process.env['PATH'] ?? '' },
    linuxGroup: { distro: 'Ubuntu' },
  });
  // A killed process nobody has reaped yet is a zombie: dead for this test.
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
    } catch {
      return true;
    }
  };

  // Flaky on busy runners: after SIGKILL, init reaps the orphan and the pid
  // can be reused before alive() reads it. The same test passed on #1679 and
  // #1681, then failed on main run 42109216980 with the group kill asserted.
  it.skip('kills the Linux group on timeout and waits for that kill before rejecting', async () => {
    const kills: string[][] = [];
    let killedAt = 0;
    let pgid = 0;
    const groupKill: GroupKill = async (file, args) => {
      kills.push([file, ...args]);
      pgid = Number(args[args.length - 1]?.slice(1));
      await new Promise((r) => setTimeout(r, 100));
      process.kill(-pgid, 'SIGKILL');
      killedAt = Date.now();
    };
    const err = await runSpawn(
      bridgeSpec(['sleep', '30']),
      undefined,
      500,
      'AGY_INTERNAL',
      groupKill
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AGY_INTERNAL' });
    expect(killedAt).toBeGreaterThan(0);
    expect(kills).toHaveLength(1);
    expect(kills[0]?.slice(0, 7)).toEqual([
      'wsl.exe',
      '-d',
      'Ubuntu',
      '-e',
      'kill',
      '-s',
      'KILL',
    ]);
    expect(pgid).toBeGreaterThan(1);
    expect(alive(pgid)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'a clean exit strips the pgid line and kills nothing',
    async () => {
      const kills: string[][] = [];
      const res = await runSpawn(
        bridgeSpec(['sh', '-c', 'echo out; echo warn >&2']),
        undefined,
        10_000,
        'AGY_INTERNAL',
        async (file, args) => {
          kills.push([file, ...args]);
        }
      );
      expect(res.code).toBe(0);
      expect(res.stdout).toBe('out\n');
      expect(res.stderr).toBe('warn\n');
      expect(kills).toEqual([]);
    }
  );

  it.skipIf(process.platform === 'win32')(
    'passes stdin through the group wrapper',
    async () => {
      const res = await runSpawn(bridgeSpec(['cat']), 'hello', 10_000);
      expect(res.stdout).toBe('hello');
    }
  );
});

describe('createHostExec', () => {
  it('turns off the repo filter drivers on every git call', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hostfilter-'));
    try {
      const marker = path.join(dir, 'ran');
      const raw = (args: string[]) =>
        execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
      raw(['init', '-q']);
      fs.writeFileSync(
        path.join(dir, 'f.sh'),
        `#!/bin/sh\ntouch '${marker}'\ncat\n`,
        {
          mode: 0o755,
        }
      );
      raw(['config', 'filter.demo.clean', 'sh ./f.sh']);
      fs.writeFileSync(path.join(dir, '.gitattributes'), 'd.txt filter=demo\n');
      fs.writeFileSync(path.join(dir, 'd.txt'), 'hi\n');
      expect(await exec.filterDrivers(dir)).toContain('demo');
      const res = await exec.git(['add', 'd.txt'], { cwd: dir });
      expect(res.code).toBe(0);
      expect(fs.existsSync(marker)).toBe(false);
      // A driver added after the first call is discovered on the next one.
      raw(['config', 'filter.later.clean', 'sh ./f.sh']);
      fs.writeFileSync(
        path.join(dir, '.gitattributes'),
        'e.txt filter=later\n'
      );
      fs.writeFileSync(path.join(dir, 'e.txt'), 'hi\n');
      const res2 = await exec.git(['add', 'e.txt'], { cwd: dir });
      expect(res2.code).toBe(0);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
