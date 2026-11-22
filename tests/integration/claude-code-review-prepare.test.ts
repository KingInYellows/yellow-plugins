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
import YAML from 'yaml';

const ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(ROOT, '.github/claude-code-review/prepare-review.sh');
const WORKFLOW = readFileSync(
  join(ROOT, '.github/workflows/claude-code-review.yml'),
  'utf8'
);

const GATE = YAML.parse(WORKFLOW).jobs['claude-review'].steps.find(
  (step: { id?: string }) => step.id === 'gate'
);

const tmp = mkdtempSync(join(tmpdir(), 'ccr-prep-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const binDir = join(tmp, 'bin');
mkdirSync(binDir);

function command(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`, {
    mode: 0o755,
  });
}

function lines(path: string): string[] {
  return existsSync(path)
    ? readFileSync(path, 'utf8').trimEnd().split('\n')
    : [];
}

command(binDir, 'sleep', `echo "sleep $1" >> "$FAKE_GH/calls"`);
command(
  binDir,
  'gh',
  `
case "$*" in
  *'application/vnd.github.diff'*) route=diff ;;
  *'/files'*) route=files ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
echo "$route" >> "$FAKE_GH/calls"
if [[ -f "$FAKE_GH/$route-errors" ]]; then
  attempt=$(grep -cx "$route" "$FAKE_GH/calls")
  error=$(sed -n "\${attempt}p" "$FAKE_GH/$route-errors")
  if [[ -n "$error" ]]; then echo "gh: fixture (HTTP $error)" >&2; exit 1; fi
fi
if [[ $route == files ]]; then cat "$FAKE_GH/files.jsonl"; exit; fi
if [[ -f "$FAKE_GH/full.diff" ]]; then cat "$FAKE_GH/full.diff"; exit; fi
echo 'gh: diff too large (HTTP 406)' >&2; exit 1
`
);

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
  errors?: Partial<Record<'diff' | 'files', number[]>>;
  failFetch?: boolean;
}

/**
 * Builds main, an optional parent branch and the PR branch, checks out a
 * --no-ff merge of the PR into its base, and runs the script there.
 */
function prepare(s: Setup): {
  status: number | null;
  out: string;
  dir: string;
  calls: string[];
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
  for (const [route, errors] of Object.entries(s.errors ?? {})) {
    writeFileSync(join(fake, `${route}-errors`), errors.join('\n') + '\n');
  }
  if (s.failFetch) {
    command(
      fake,
      'git',
      `
if [[ $1 == fetch ]]; then echo fetch >> "$FAKE_GH/calls"; exit 1; fi
PATH="$ORIGINAL_PATH" exec git "$@"
`
    );
  }
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
      PATH: `${fake}:${binDir}:${process.env.PATH}`,
      ORIGINAL_PATH: process.env.PATH,
      FAKE_GH: fake,
      GH_TOKEN: 'test-token',
      REPO: 'o/r',
      PR_NUMBER: '7',
      DEFAULT_BRANCH: 'main',
      BASE_REF: base,
      CHANGED_COUNT: String(s.changedCount ?? 1),
    },
  });
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    dir,
    calls: lines(join(fake, 'calls')),
  };
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

describe('prepare-review retry policy', () => {
  it('retries a transient API error and uses the successful response', () => {
    const r = prepare({ ...ok, errors: { diff: [503] } });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['diff', 'sleep 5', 'diff']);
    expect(
      readFileSync(join(r.dir, '.claude-code-review/pr.diff'), 'utf8')
    ).toBe(ok.fullDiff);
  });

  it.each([404, 406])('tries a permanent HTTP %i error once', (status) => {
    const r = prepare({ errors: { diff: [status], files: [status] } });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual(['diff', 'files']);
    expect(r.out).toContain(`HTTP ${status}`);
  });

  it('fails after all three attempts to retrieve the file list', () => {
    const r = prepare({ errors: { files: [503, 503, 503] } });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([
      'diff',
      'files',
      'sleep 5',
      'files',
      'sleep 10',
      'files',
    ]);
    expect(r.out).toContain('HTTP 503');
  });

  it('fails a stacked review after the third default-branch fetch', () => {
    const r = prepare({ ...ok, parent: () => {}, failFetch: true });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual(['fetch', 'sleep 5', 'fetch', 'sleep 10', 'fetch']);
    expect(r.out).toContain('::error::could not fetch main');
  });
});

interface GateOptions {
  count?: string | null;
  missingFile?: string;
  httpStatus?: number;
}

// Run the shipped gate body with a private HOME, runner directory, and local commands.
function runGate({
  count = '0',
  missingFile = '',
  httpStatus = 404,
}: GateOptions = {}) {
  const dir = mkdtempSync(join(tmp, 'gate-'));
  const output = join(dir, 'output');
  const home = join(dir, 'home');
  mkdirSync(home);
  writeFileSync(output, '');
  command(dir, 'sleep', 'exit 0');
  command(dir, 'git', `[[ "$*" == 'rev-parse HEAD^2' ]] && echo "$HEAD_SHA"`);
  command(
    dir,
    'gh',
    `
if [[ -n $FAILED_FILE && $* == *"/$FAILED_FILE?ref=main"* ]]; then
  echo attempt >> attempts
  echo "gh: fixture (HTTP $HTTP_STATUS)" >&2
  exit 1
fi
case "$*" in
  *'/prepare-review.sh?ref=main'*) if [[ $COUNT_MISSING == true ]]; then echo ':'; exit 0; fi; echo 'printf "%s\\n" "$COUNT" > .claude-code-review/not-reviewed-count' ;;
  *'/bash-guard.sh?ref=main'*|*'/code-review.md?ref=main'*) echo '# fixture' ;;
  *'/comments'*) : ;;
  *'changed_files'*) echo "$HEAD_SHA 7" ;;
  *'.head.sha'*) echo "$HEAD_SHA" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`
  );
  const r = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', GATE.run], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: home,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: output,
      GH_TOKEN: 'test-token',
      REPO: 'o/r',
      PR_NUMBER: '7',
      HEAD_SHA: 'abc123',
      DEFAULT_BRANCH: 'main',
      BASE_REF: 'main',
      COUNT: count ?? '',
      COUNT_MISSING: String(count === null),
      FAILED_FILE: missingFile,
      HTTP_STATUS: String(httpStatus),
    },
  });
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    output: readFileSync(output, 'utf8'),
    target: join(home, '.claude/hooks/claude-code-review-target'),
    attempts: lines(join(dir, 'attempts')).length,
  };
}

describe('workflow review gate', () => {
  it('passes the PR context to the gate', () => {
    expect(GATE.env).toMatchObject({
      GH_TOKEN: '${{ github.token }}',
      REPO: '${{ github.repository }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      PR_NUMBER: '${{ github.event.pull_request.number }}',
      BASE_REF: '${{ github.event.pull_request.base.ref }}',
      DEFAULT_BRANCH: '${{ github.event.repository.default_branch }}',
    });
  });
  it.each(['0', '12'])(
    'writes all four target fields for count %s',
    (count) => {
      const r = runGate({ count });
      expect(r.status).toBe(0);
      expect(r.output).toBe('run=true\n');
      expect(readFileSync(r.target, 'utf8')).toBe(`o/r 7 abc123 ${count}\n`);
    }
  );
  it.each(['', 'abc'])('rejects invalid count %j', (count) => {
    const r = runGate({ count });
    expect(r.status).toBe(1);
    expect(r.out).toContain('::error::bad not-reviewed count');
    expect(r.output).toBe('');
  });
  it('fails if the prepare script did not write the count file', () => {
    const r = runGate({ count: null });
    expect(r.status).toBe(1);
    expect(r.output).toBe('');
  });
  describe.each(['bash-guard.sh', 'prepare-review.sh'])(
    'fetching %s',
    (file) => {
      it.each([
        { httpStatus: 404, attempts: 1, status: 0, output: 'run=false\n' },
        { httpStatus: 406, attempts: 1, status: 1, output: '' },
        { httpStatus: 503, attempts: 3, status: 1, output: '' },
      ])(
        'handles HTTP $httpStatus',
        ({ httpStatus, attempts, status, output }) => {
          const r = runGate({ missingFile: file, httpStatus });
          expect(r.status).toBe(status);
          expect(r.attempts).toBe(attempts);
          expect(r.output).toBe(output);
        }
      );
    }
  );
});
