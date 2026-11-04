import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function tmpDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** process.env without inherited GIT_* (GIT_DIR, GIT_INDEX_FILE, …). */
function cleanEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))
  );
}

const ISOLATED = { ...GIT_ENV, GIT_CONFIG_GLOBAL: os.devNull };

export const testEnv: Record<string, string | undefined> = {
  ...cleanEnv(),
  ...ISOLATED,
  HOME: process.env['HOME'],
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...cleanEnv(), ...ISOLATED },
    encoding: 'utf8',
  });
}

/** A bare "remote" with one commit on main, and a clone of it. */
export function makeRepo(): { remote: string; repo: string; root: string } {
  const root = tmpDir('yellow-agy-');
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main', seed);
  fs.writeFileSync(path.join(seed, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(seed, '.gitignore'), 'build/\n*.log\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, '-c', 'push.negotiate=false', 'push', '-q', remote, 'main');
  const repo = path.join(root, 'repo');
  git(root, 'clone', '-q', remote, repo);
  return { remote, repo, root };
}
