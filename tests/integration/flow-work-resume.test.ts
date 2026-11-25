/**
 * Resume evidence for /flow:work (CLAUDE-384, CLAUDE-385).
 *
 * The command is markdown, so the decisions it takes on resume live in
 * plugins/yellow-core/lib/flow-work-resume.js and are exercised here against
 * real temporary git repositories and a stub `gh`. A stub `gt` records any
 * call, so every case also proves the check never needs Graphite.
 */

import { execFileSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const resume = require('../../plugins/yellow-core/lib/flow-work-resume.js');

const LIB = resolve(
  __dirname,
  '../../plugins/yellow-core/lib/flow-work-resume.js'
);
const PLAN = 'plans/feature.md';

let tmp: string;
let repo: string;
let bin: string;

function sh(cmd: string, args: string[], cwd = repo): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });
}

function commit(message: string, file: string): void {
  writeFileSync(join(repo, file), `${file}\n${Math.random()}\n`);
  sh('git', ['add', '--', file]);
  const msgFile = join(tmp, 'msg.txt');
  writeFileSync(msgFile, message);
  sh('git', ['commit', '-q', '-F', msgFile]);
}

function amend(message: string, file: string): void {
  writeFileSync(join(repo, file), `${file}\n${Math.random()}\n`);
  sh('git', ['add', '--', file]);
  const msgFile = join(tmp, 'msg.txt');
  writeFileSync(msgFile, message);
  sh('git', ['commit', '-q', '--amend', '-F', msgFile]);
}

// Run the CLI with PATH limited to `bin` (stubs plus a real git link).
function cli(args: string[]): Record<string, unknown> {
  const out = execFileSync(process.execPath, [LIB, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      PATH: bin,
      HOME: tmp,
      GH_FIXTURE: join(tmp, 'gh.json'),
      GH_LOG: join(tmp, 'gh.log'),
      GT_LOG: join(tmp, 'gt.log'),
    },
  });
  return JSON.parse(out);
}

function stubGh(rows: unknown, exitCode = 0): void {
  writeFileSync(join(tmp, 'gh.json'), JSON.stringify(rows));
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_LOG"
if [ "$1" = repo ]; then printf 'owner/repo\\n'; exit 0; fi
if [ ${exitCode} -ne 0 ]; then echo 'HTTP 401: Bad credentials' >&2; exit ${exitCode}; fi
cat "$GH_FIXTURE"
`;
  writeFileSync(join(bin, 'gh'), script);
  chmodSync(join(bin, 'gh'), 0o755);
}

function stubGt(): void {
  writeFileSync(
    join(bin, 'gt'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GT_LOG"\nexit 1\n'
  );
  chmodSync(join(bin, 'gt'), 0o755);
}

function head(ref: string): string {
  return sh('git', ['rev-parse', ref]).trim();
}

function pr(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 41,
    url: 'https://github.com/owner/repo/pull/41',
    state: 'OPEN',
    headRefName: 'feat/one',
    baseRefName: 'main',
    headRefOid: head('feat/one'),
    isCrossRepository: false,
    ...over,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'flow-work-resume-'));
  repo = join(tmp, 'repo');
  bin = join(tmp, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  const gitPath = execFileSync('sh', ['-c', 'command -v git'], {
    encoding: 'utf8',
  }).trim();
  symlinkSync(gitPath, join(bin, 'git'));
  // The gh stub is a /bin/sh script that needs cat; nothing else is on PATH.
  const catPath = execFileSync('sh', ['-c', 'command -v cat'], {
    encoding: 'utf8',
  }).trim();
  symlinkSync(catPath, join(bin, 'cat'));
  sh('git', ['init', '-q', '-b', 'main']);
  mkdirSync(join(repo, 'plans'));
  writeFileSync(join(repo, PLAN), '# Plan\n\n- [ ] one\n- [ ] two\n');
  commit('chore: initial', 'README.md');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('committed-steps (CLAUDE-384)', () => {
  it('finds the first committed task of a two-task plan with both boxes empty', () => {
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    commit(`feat: task one\n\n- body\n\nFlow-Work-Step: ${PLAN}#1\n`, 'a.txt');
    const result = cli(['committed-steps', '--plan', PLAN, '--base', 'main']);
    expect(result).toMatchObject({ status: 'OK', plan: PLAN, steps: [1] });
  });

  it('one-task plan: the only step is found, so the run goes straight to quality checks', () => {
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    commit(`feat: only task\n\nFlow-Work-Step: ${PLAN}#1\n`, 'a.txt');
    expect(
      cli(['committed-steps', '--plan', PLAN, '--base', 'main']).steps
    ).toEqual([1]);
  });

  it('a fresh plan has no evidence, on trunk or on a new branch', () => {
    expect(
      cli(['committed-steps', '--plan', PLAN, '--base', 'main'])
    ).toMatchObject({ status: 'OK', steps: [] });
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    expect(
      cli(['committed-steps', '--plan', PLAN, '--base', 'main']).steps
    ).toEqual([]);
  });

  it('ignores an unrelated commit with a similar subject, body text, or another plan', () => {
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    commit(
      'feat: task one\n\nSee Flow-Work-Step: plans/feature.md#1 in the notes, and\nthis line keeps the paragraph from being a trailer block.\n',
      'a.txt'
    );
    commit('feat: task one\n\nFlow-Work-Step: plans/other.md#1\n', 'b.txt');
    commit(`feat: task one\n\nFlow-Work-Step: ${PLAN}#x1\n`, 'c.txt');
    expect(
      cli(['committed-steps', '--plan', PLAN, '--base', 'main']).steps
    ).toEqual([]);
  });

  it('ignores commits already on trunk', () => {
    commit(`feat: old run\n\nFlow-Work-Step: ${PLAN}#1\n`, 'a.txt');
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    expect(
      cli(['committed-steps', '--plan', PLAN, '--base', 'main']).steps
    ).toEqual([]);
  });

  it('reads accumulated trailers after Graphite-style amends with a Linear line', () => {
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    commit(
      `feat: task one\n\nPart of CLAUDE-1\n\nFlow-Work-Step: ${PLAN}#1\n`,
      'a.txt'
    );
    amend(
      `feat: task two\n\nPart of CLAUDE-1\n\nFlow-Work-Step: ${PLAN}#1\nFlow-Work-Step: ${PLAN}#2\n`,
      'b.txt'
    );
    expect(
      cli(['committed-steps', '--plan', PLAN, '--base', 'main']).steps
    ).toEqual([1, 2]);
  });

  it('finds the default base', () => {
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    commit(`feat: task\n\nFlow-Work-Step: ${PLAN}#2\n`, 'a.txt');
    expect(cli(['committed-steps', '--plan', PLAN])).toMatchObject({
      status: 'OK',
      base: 'main',
      steps: [2],
    });
  });

  it('rejects absolute and traversal forms before normalising them', () => {
    for (const plan of [
      join(repo, PLAN),
      'plans/../plans/feature.md',
      './plans/feature.md',
      'plans//feature.md',
    ]) {
      expect(
        cli(['committed-steps', '--plan', plan, '--base', 'main']).status,
        plan
      ).toBe('ERROR');
    }
  });

  it('reads the plan path from --plan-file', () => {
    sh('git', ['checkout', '-q', '-b', 'feat/x']);
    commit(`feat: task one\n\nFlow-Work-Step: ${PLAN}#1\n`, 'a.txt');
    const planFile = join(tmp, 'plan-arg.txt');
    writeFileSync(planFile, `${PLAN}\r\n`);
    expect(
      cli(['committed-steps', '--plan-file', planFile, '--base', 'main'])
    ).toMatchObject({ status: 'OK', plan: PLAN, steps: [1] });
  });

  it('rejects unsafe or missing plan paths with ERROR', () => {
    const bad = [
      'plans/$(touch PWNED).md',
      'plans/a b.md',
      'plans/-x.md',
      '../outside.md',
      'plans/feature.txt',
      'plans/missing.md',
    ];
    for (const plan of bad) {
      const planFile = join(tmp, 'plan-arg.txt');
      writeFileSync(planFile, `${plan}\n`);
      const result = cli([
        'committed-steps',
        '--plan-file',
        planFile,
        '--base',
        'main',
      ]);
      expect(result.status, plan).toBe('ERROR');
    }
    expect(existsSync(join(repo, 'PWNED'))).toBe(false);
  });

  it('reports ERROR, not an empty list, when the base cannot be read', () => {
    const result = cli(['committed-steps', '--plan', PLAN, '--base', 'nope']);
    expect(result.status).toBe('ERROR');
    expect(result.steps).toBeUndefined();
  });
});

describe('stack-item (CLAUDE-385)', () => {
  beforeEach(() => {
    sh('git', ['checkout', '-q', '-b', 'feat/one']);
    commit('feat: item one', 'one.txt');
  });

  for (const provider of ['github-native (no gt)', 'graphite (gt present)']) {
    it(`confirms a submitted item without calling gt: ${provider}`, () => {
      if (provider.startsWith('graphite')) stubGt();
      stubGh([pr()]);
      const result = cli([
        'stack-item',
        '--branch',
        'feat/one',
        '--base',
        'main',
      ]);
      expect(result).toMatchObject({
        status: 'SUBMITTED',
        repo: 'owner/repo',
        pr: { number: 41 },
      });
      expect(existsSync(join(tmp, 'gt.log'))).toBe(false);
    });
  }

  it('negative control: a branch with no pull request stays NOT_SUBMITTED', () => {
    stubGt();
    stubGh([]);
    expect(
      cli(['stack-item', '--branch', 'feat/one', '--base', 'main']).status
    ).toBe('NOT_SUBMITTED');
    expect(existsSync(join(tmp, 'gt.log'))).toBe(false);
  });

  it('a PR on the wrong base is MISMATCH', () => {
    stubGh([pr({ baseRefName: 'feat/zero' })]);
    expect(
      cli(['stack-item', '--branch', 'feat/one', '--base', 'main']).status
    ).toBe('MISMATCH');
  });

  it('a local tip that differs from the PR head is MISMATCH', () => {
    stubGh([pr({ headRefOid: '0'.repeat(40) })]);
    expect(
      cli(['stack-item', '--branch', 'feat/one', '--base', 'main']).status
    ).toBe('MISMATCH');
  });

  it('passes the intended repository to gh', () => {
    stubGh([pr()]);
    cli([
      'stack-item',
      '--branch',
      'feat/one',
      '--base',
      'main',
      '--repo',
      'me/proj',
    ]);
    const log = execFileSync('cat', [join(tmp, 'gh.log')], {
      encoding: 'utf8',
    });
    expect(log).toContain('pr list --repo me/proj --head feat/one');
  });

  it('gh failing is UNAVAILABLE, never NOT_SUBMITTED', () => {
    stubGh([], 4);
    expect(
      cli(['stack-item', '--branch', 'feat/one', '--base', 'main']).status
    ).toBe('UNAVAILABLE');
  });

  it('gh missing is UNAVAILABLE', () => {
    expect(
      cli(['stack-item', '--branch', 'feat/one', '--base', 'main']).status
    ).toBe('UNAVAILABLE');
  });

  it('rejects a branch name with shell metacharacters before any lookup', () => {
    stubGh([pr()]);
    const result = cli([
      'stack-item',
      '--branch',
      'feat/$(id)',
      '--base',
      'main',
    ]);
    expect(result.status).toBe('UNAVAILABLE');
    expect(existsSync(join(tmp, 'gh.log'))).toBe(false);
  });
});

describe('classifyStackItem', () => {
  const base = { branch: 'feat/one', base: 'main', localHead: 'abc' };
  const row = {
    number: 1,
    url: 'u',
    state: 'OPEN',
    headRefName: 'feat/one',
    baseRefName: 'main',
    headRefOid: 'abc',
    isCrossRepository: false,
  };

  it('ignores fork PRs and closed PRs', () => {
    expect(
      resume.classifyStackItem({
        ...base,
        rows: [
          { ...row, isCrossRepository: true },
          { ...row, state: 'CLOSED' },
        ],
      }).status
    ).toBe('NOT_SUBMITTED');
  });

  it('two live PRs for one head are MISMATCH', () => {
    expect(
      resume.classifyStackItem({ ...base, rows: [row, { ...row, number: 2 }] })
        .status
    ).toBe('MISMATCH');
  });

  it('a merged PR counts even after the local tip moved', () => {
    expect(
      resume.classifyStackItem({
        ...base,
        rows: [{ ...row, state: 'MERGED', headRefOid: 'old' }],
      }).status
    ).toBe('SUBMITTED');
  });

  it('no local branch is MISMATCH', () => {
    expect(
      resume.classifyStackItem({ ...base, localHead: null, rows: [row] }).status
    ).toBe('MISMATCH');
  });
});

describe('stepsFromTrailerValues', () => {
  it('keeps only this plan and well-formed numbers', () => {
    expect(
      resume.stepsFromTrailerValues(
        [
          'plans/a.md#2',
          'plans/a.md#1',
          'plans/b.md#3',
          'plans/a.md#0',
          'plans/a.md#',
          '#4',
        ],
        'plans/a.md'
      )
    ).toEqual([1, 2]);
  });
});
