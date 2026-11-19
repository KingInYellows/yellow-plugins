/**
 * The Claude Code Review gate refuses a PR whose changed paths include a
 * symlink that leaves the checkout or enters .git (CLAUDE-365). The paths come
 * from `git diff` between the checked-out merge commit and its base parent,
 * and a Python block checks each path and the directories above it. This test
 * runs both, exactly as the workflow has them, on a real merge commit.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const WORKFLOW = readFileSync(
  join(ROOT, '.github/workflows/claude-code-review.yml'),
  'utf8'
);

const DIFF_CMD =
  'git diff --no-renames --name-only -z --diff-filter=d HEAD^1 HEAD';

function scanScript(): string {
  const m = WORKFLOW.match(
    /python3 -I - \.claude-code-review\/changed-paths\.bin <<'PY'\n([\s\S]*?)\n {10}PY\n/
  );
  if (!m) throw new Error('symlink scan block not found in the workflow');
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^ {10}/, ''))
    .join('\n');
}

const tmp = mkdtempSync(join(tmpdir(), 'ccr-scan-'));
const script = join(tmp, 'scan.py');
writeFileSync(script, scanScript());
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/**
 * Builds base and PR commits, then checks out a --no-ff merge of the PR into
 * the base, the shape of GitHub's refs/pull/N/merge. Returns the scan result.
 */
function scan(
  onBase: (dir: string) => void,
  onPr: (dir: string) => void
): { status: number | null; out: string } {
  n += 1;
  const dir = join(tmp, `repo${n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README'), 'x');
  onBase(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'pr');
  onPr(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'pr');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'pr');
  const list = spawnSync('sh', ['-c', `${DIFF_CMD} > ../list${n}.bin`], {
    cwd: dir,
  });
  expect(list.status).toBe(0);
  const r = spawnSync('python3', ['-I', script, `../list${n}.bin`], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe('claude-code-review symlink scan', () => {
  it('uses the git diff command this test runs', () => {
    expect(WORKFLOW).toContain(`${DIFF_CMD} \\`);
  });

  it('fails on a changed symlink that leaves the checkout', () => {
    const r = scan(
      () => {},
      (d) => symlinkSync('/etc/passwd', join(d, 'out'))
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("symlink leaves the checkout: 'out'");
  });

  it('fails on a changed symlink into .git', () => {
    const r = scan(
      () => {},
      (d) => symlinkSync('.git/config', join(d, 'cfg'))
    );
    expect(r.status).toBe(1);
  });

  it('fails on an outward symlink in a new subdirectory', () => {
    const r = scan(
      () => {},
      (d) => {
        mkdirSync(join(d, 'a'));
        symlinkSync('/tmp', join(d, 'a', 'b'));
      }
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("'a/b'");
  });

  it('passes a changed symlink that stays inside the checkout', () => {
    const r = scan(
      () => {},
      (d) => symlinkSync('README', join(d, 'link'))
    );
    expect(r.status).toBe(0);
  });

  it('ignores an outward symlink that only the base branch has', () => {
    const r = scan(
      (d) => symlinkSync('/etc/passwd', join(d, 'old')),
      (d) => writeFileSync(join(d, 'new.txt'), 'y')
    );
    expect(r.status).toBe(0);
  });

  it('keeps a filename with a newline as one path', () => {
    const r = scan(
      () => {},
      (d) => symlinkSync('/etc/passwd', join(d, 'odd\nname'))
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("'odd\\nname'");
  });
});
