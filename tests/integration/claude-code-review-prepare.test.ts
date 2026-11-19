/**
 * .github/claude-code-review/prepare-review.sh builds the Claude Code Review
 * inputs (CLAUDE-371): it refuses a PR whose changed paths include a symlink
 * that leaves the checkout or enters .git (CLAUDE-365), counts stacked parent
 * PRs' paths as changed (CLAUDE-373), and writes pr.diff plus the number of
 * files the agent cannot review. This test runs the real script on real merge
 * commits, the shape of GitHub's refs/pull/N/merge, with a fake `gh`.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
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
const SCRIPT = join(ROOT, '.github/claude-code-review/prepare-review.sh');
const WORKFLOW = readFileSync(
  join(ROOT, '.github/workflows/claude-code-review.yml'),
  'utf8'
);

const tmp = mkdtempSync(join(tmpdir(), 'ccr-prep-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Fake gh: the full diff comes from $FAKE_GH/full.diff (a 406 when absent),
// the per-file list from $FAKE_GH/files.jsonl.
const binDir = join(tmp, 'bin');
mkdirSync(binDir);
writeFileSync(
  join(binDir, 'gh'),
  `#!/usr/bin/env bash
case "$*" in
  *'application/vnd.github.diff'*)
    if [ -f "$FAKE_GH/full.diff" ]; then cat "$FAKE_GH/full.diff"; exit 0; fi
    echo 'gh: Sorry, the diff exceeded the maximum number of files (HTTP 406)' >&2; exit 1 ;;
  *'/files'*) cat "$FAKE_GH/files.jsonl" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`
);
chmodSync(join(binDir, 'gh'), 0o755);

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

function commit(dir: string, change: (d: string) => void, msg: string): void {
  change(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
}

interface Setup {
  /** Commits on main. */
  main?: (d: string) => void;
  /** A parent PR in the stack; when set, the PR under review targets it. */
  parent?: (d: string) => void;
  /** The PR under review. */
  pr?: (d: string) => void;
  fullDiff?: string;
  files?: object[];
  changedCount?: number;
}

/**
 * Builds main, an optional parent branch and the PR branch, checks out a
 * --no-ff merge of the PR into its base, and runs the script there.
 */
function prepare(s: Setup): {
  status: number | null;
  out: string;
  dir: string;
} {
  n += 1;
  const dir = join(tmp, `repo${n}`);
  const fake = join(tmp, `gh${n}`);
  mkdirSync(dir);
  mkdirSync(fake);
  if (s.fullDiff !== undefined)
    writeFileSync(join(fake, 'full.diff'), s.fullDiff);
  writeFileSync(
    join(fake, 'files.jsonl'),
    (s.files || []).map((f) => JSON.stringify(f)).join('\n')
  );
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, (d) => writeFileSync(join(d, 'README'), 'x'), 'init');
  commit(dir, s.main || (() => {}), 'main');
  let base = 'main';
  if (s.parent) {
    git(dir, 'checkout', '-q', '-b', 'parent');
    commit(dir, s.parent, 'parent');
    base = 'parent';
  }
  git(dir, 'checkout', '-q', '-b', 'pr');
  commit(dir, s.pr || (() => {}), 'pr');
  git(dir, 'checkout', '-q', base);
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'pr');
  git(dir, 'remote', 'add', 'origin', `file://${dir}`);
  mkdirSync(join(dir, '.claude-code-review'));
  const r = spawnSync('bash', [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_GH: fake,
      GH_TOKEN: 'test-token',
      REPO: 'o/r',
      PR_NUMBER: '7',
      DEFAULT_BRANCH: 'main',
      BASE_REF: base,
      CHANGED_COUNT: String(s.changedCount ?? 1),
    },
  });
  return { status: r.status, out: r.stdout + r.stderr, dir };
}

const ok = { fullDiff: 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n' };

function notReviewed(dir: string): string {
  return readFileSync(
    join(dir, '.claude-code-review/not-reviewed-count'),
    'utf8'
  ).trim();
}

describe('claude-code-review prepare-review.sh: symlink scan', () => {
  it('fails on a changed symlink that leaves the checkout', () => {
    const r = prepare({
      ...ok,
      pr: (d) => symlinkSync('/etc/passwd', join(d, 'out')),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("symlink leaves the checkout: 'out'");
    expect(existsSync(join(r.dir, '.claude-code-review/pr.diff'))).toBe(false);
  });

  it('fails on a changed symlink into .git', () => {
    const r = prepare({
      ...ok,
      pr: (d) => symlinkSync('.git/config', join(d, 'cfg')),
    });
    expect(r.status).toBe(1);
  });

  it('fails on an outward symlink in a new subdirectory', () => {
    const r = prepare({
      ...ok,
      pr: (d) => {
        mkdirSync(join(d, 'a'));
        symlinkSync('/tmp', join(d, 'a', 'b'));
      },
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("'a/b'");
  });

  it('passes a changed symlink that stays inside the checkout', () => {
    const r = prepare({
      ...ok,
      pr: (d) => symlinkSync('README', join(d, 'link')),
    });
    expect(r.status).toBe(0);
  });

  it('ignores an outward symlink that only the base branch has', () => {
    const r = prepare({
      ...ok,
      main: (d) => symlinkSync('/etc/passwd', join(d, 'old')),
      pr: (d) => writeFileSync(join(d, 'new.txt'), 'y'),
    });
    expect(r.status).toBe(0);
  });

  it('keeps a filename with a newline as one path', () => {
    const r = prepare({
      ...ok,
      pr: (d) => symlinkSync('/etc/passwd', join(d, 'odd\nname')),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("'odd\\nname'");
  });

  it('fails on an outward symlink a stacked parent PR added', () => {
    const r = prepare({
      ...ok,
      parent: (d) => symlinkSync('/etc/passwd', join(d, 'from-parent')),
      pr: (d) => writeFileSync(join(d, 'child.txt'), 'y'),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("symlink leaves the checkout: 'from-parent'");
  });

  it('still ignores a default-branch symlink in a stacked PR', () => {
    const r = prepare({
      ...ok,
      main: (d) => symlinkSync('/etc/passwd', join(d, 'old')),
      parent: (d) => writeFileSync(join(d, 'p.txt'), 'p'),
      pr: (d) => writeFileSync(join(d, 'child.txt'), 'y'),
    });
    expect(r.status).toBe(0);
  });
});

describe('claude-code-review prepare-review.sh: diff file', () => {
  it('keeps the full diff and counts nothing unreviewed', () => {
    const r = prepare(ok);
    expect(r.status).toBe(0);
    expect(
      readFileSync(join(r.dir, '.claude-code-review/pr.diff'), 'utf8')
    ).toBe(ok.fullDiff);
    expect(notReviewed(r.dir)).toBe('0');
    expect(r.out).not.toContain('::warning::');
  });

  it('counts and names binary files in the full diff', () => {
    const r = prepare({
      fullDiff:
        'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n' +
        'diff --git a/img.png b/img.png\nnew file mode 100644\nBinary files /dev/null and b/img.png differ\n' +
        'diff --git "a/odd\\tname.bin" "b/odd\\tname.bin"\nBinary files a/odd and b/odd differ\n',
    });
    expect(r.status).toBe(0);
    expect(notReviewed(r.dir)).toBe('2');
    expect(r.out).toContain(
      "::warning::2 changed file(s) not reviewed (binary or no patch from GitHub): 'img.png', 'odd\\\\tname.bin'"
    );
  });

  it('builds the diff per file when GitHub refuses the full diff', () => {
    const r = prepare({
      files: [
        { filename: 'a.txt', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' },
        {
          filename: 'new.md',
          previous_filename: 'old.md',
          status: 'renamed',
          patch: '@@ -0,0 +1 @@\n+z',
        },
        { filename: 'big.bin', status: 'added' },
        {
          filename: 'moved.txt',
          previous_filename: 'was.txt',
          status: 'renamed',
          changes: 0,
        },
        { filename: 'run.sh', status: 'changed', changes: 0 },
      ],
      changedCount: 3002,
    });
    expect(r.status).toBe(0);
    const diff = readFileSync(
      join(r.dir, '.claude-code-review/pr.diff'),
      'utf8'
    );
    expect(diff).toContain(
      'diff --git a/a.txt b/a.txt\nstatus: modified\n@@ -1 +1 @@\n-a\n+b\n'
    );
    expect(diff).toContain('diff --git a/old.md b/new.md\n');
    expect(diff).toContain(
      'diff --git a/big.bin b/big.bin\nstatus: added\n(no patch from GitHub: binary or too large; not reviewed)\n'
    );
    expect(diff).toContain(
      '(2 more changed files: GitHub lists only 3000; not reviewed)'
    );
    expect(diff).toContain(
      'diff --git a/was.txt b/moved.txt\nstatus: renamed\n(no content change)\n'
    );
    expect(notReviewed(r.dir)).toBe('3');
    expect(r.out).toContain(
      "'big.bin' and 2 more past GitHub's 3000-file list"
    );
  });
});

describe('claude-code-review workflow wiring', () => {
  it('installs the script from the default branch and runs it', () => {
    expect(WORKFLOW).toContain(
      'contents/.github/claude-code-review/prepare-review.sh?ref=$DEFAULT_BRANCH'
    );
    expect(WORKFLOW).toContain(
      'bash "$RUNNER_TEMP/claude-code-review-prepare.sh"'
    );
    for (const v of [
      'BASE_REF:',
      'export CHANGED_COUNT',
      'GH_TOKEN:',
      'read -r not_reviewed < .claude-code-review/not-reviewed-count',
    ]) {
      expect(WORKFLOW).toContain(v);
    }
  });
});
