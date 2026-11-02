import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import { createHostExec } from '../src/host-exec';
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

    // The turn makes a mess.
    fs.rmSync(path.join(wt, 'new.txt'));
    fs.writeFileSync(path.join(wt, 'a.txt'), 'agy\n');
    fs.writeFileSync(path.join(wt, 'junk.txt'), 'junk\n');
    git(wt, 'add', '-A');

    await resetToSnapshot(exec, wt, 't1', snap);
    expect(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8')).toBe('unstaged\n');
    expect(fs.readFileSync(path.join(wt, 'new.txt'), 'utf8')).toBe('new\n');
    expect(fs.existsSync(path.join(wt, 'junk.txt'))).toBe(false);
    expect(git(wt, 'show', ':a.txt')).toBe('staged\n');
    expect(git(wt, 'status', '--porcelain')).toBe(status);
    expect(git(wt, 'for-each-ref', 'refs/yellow-agy/')).toBe('');
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

  it('collect returns commits and uncommitted changes without touching the index', async () => {
    const { wt, base } = await setup();
    fs.writeFileSync(path.join(wt, 'a.txt'), 'committed\n');
    git(wt, 'commit', '-q', '-am', 'change a');
    fs.writeFileSync(path.join(wt, 'b.txt'), 'untracked\n');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'dirty\n');
    const status = git(wt, 'status', '--porcelain');
    const got = await collectWorktree(exec, wt, 't1', base);
    expect(got.commitCount).toBe(1);
    expect(got.commits).toContain('Subject: [PATCH] change a');
    expect(got.uncommitted).toContain('+untracked');
    expect(got.uncommitted).toContain('+dirty');
    expect(git(wt, 'status', '--porcelain')).toBe(status);
  });

  it('removes the worktree and deletes only an empty branch', async () => {
    const { repo, wt, base } = await setup();
    await removeWorktree(exec, repo, wt);
    expect(fs.existsSync(wt)).toBe(false);
    expect(await deleteBranchIfEmpty(exec, repo, 'agy/t1', base)).toBe(true);
    expect(await deleteBranchIfEmpty(exec, repo, 'agy/t1', base)).toBe(false);
  });
});
