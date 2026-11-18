/**
 * Deterministic fixture tests for the GitHub stacked-PR runtime adapter
 * (plugins/github-workflow/lib/github-stack-runtime.js).
 *
 * Fake `gh`/`git` executables live in
 * `../../plugins/github-workflow/tests/fixtures/bin/{gh,git}` and are
 * entirely env-var-driven, so this suite never depends on a real `gh`
 * install, real auth, or this repository's real git remotes.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runtime = require('../../plugins/github-workflow/lib/github-stack-runtime.js');

const {
  view,
  init,
  add,
  checkout,
  rebase,
  sync,
  push,
  submit,
  merge,
  mergeSingle,
  previewTokenOf,
  unstack,
  validateBranchName,
  validateRepoRelativePath,
  resolveRemote,
  redact,
} = runtime;

const FIXTURE_BIN = join(__dirname, '..', '..', 'plugins', 'github-workflow', 'tests', 'fixtures', 'bin');
const LIB = join(__dirname, '..', '..', 'plugins', 'github-workflow', 'lib', 'github-stack-runtime.js');

const ENV_KEYS = [
  'GH_HOST',
  'FAKE_GH_EXIT',
  'FAKE_GH_STDOUT',
  'FAKE_GH_STDERR',
  'FAKE_GH_SLEEP',
  'FAKE_GIT_REMOTES',
  'FAKE_GIT_PUSH_DEFAULT',
  'FAKE_GIT_BRANCHES',
  'FAKE_GIT_NOT_ANCESTOR',
  'FAKE_GIT_ANCESTRY_EXIT',
  'FAKE_GIT_REMOTE_URLS',
  'FAKE_GIT_GH_RESOLVED',
  'FAKE_GIT_GH_RESOLVED_EXIT',
  'FAKE_GIT_REMOTE_LIST_EXIT',
  'FAKE_GIT_REVPARSE_EXIT',
  'FAKE_GH_REPORT_NO_ATOMIC',
  'GH_STACK_NO_ATOMIC',
  'GH_REPO',
  'FAKE_GH_LOG',
  'FAKE_GH_GET_STDOUT',
  'FAKE_GH_GET_EXIT',
  'FAKE_GH_PUT_STDOUT',
  'FAKE_GH_PUT_EXIT',
];
let originalPath: string | undefined;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalPath = process.env.PATH;
  process.env.PATH = `${FIXTURE_BIN}:${originalPath}`;
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  process.env.PATH = originalPath;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('validateBranchName', () => {
  it('accepts a well-formed branch name', () => {
    expect(validateBranchName('feat/valid-name')).toEqual({ ok: true, value: 'feat/valid-name' });
  });

  it('rejects a flag-like, traversal, or empty branch name', () => {
    expect(validateBranchName('-evil-flag').ok).toBe(false);
    expect(validateBranchName('feat/../evil').ok).toBe(false);
    expect(validateBranchName('').ok).toBe(false);
  });
});

describe('validateRepoRelativePath', () => {
  it('accepts a relative path', () => {
    expect(validateRepoRelativePath('src/index.ts')).toEqual({ ok: true, value: 'src/index.ts' });
  });

  it('rejects absolute paths and traversal segments', () => {
    expect(validateRepoRelativePath('/etc/passwd').ok).toBe(false);
    expect(validateRepoRelativePath('../../etc/passwd').ok).toBe(false);
    expect(validateRepoRelativePath('a/b/../../c').ok).toBe(false);
  });
});

describe('resolveRemote — explicit remote when multiple exist unless pushDefault is verified', () => {
  it('zero/one remote resolves to null (no --remote flag needed)', () => {
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    expect(resolveRemote(undefined)).toEqual({ ok: true, remote: null });
  });

  it('multiple remotes with no explicit remote and no valid pushDefault refuses', () => {
    process.env.FAKE_GIT_REMOTES = 'origin\nupstream\n';
    const result = resolveRemote(undefined);
    expect(result.ok).toBe(false);
  });

  it('multiple remotes with a verified remote.pushDefault resolves silently', () => {
    process.env.FAKE_GIT_REMOTES = 'origin\nupstream\n';
    process.env.FAKE_GIT_PUSH_DEFAULT = 'upstream';
    expect(resolveRemote(undefined)).toEqual({ ok: true, remote: 'upstream' });
  });

  it('an explicit remote is validated against the known list, not trusted blindly', () => {
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    expect(resolveRemote('origin')).toEqual({ ok: true, remote: 'origin' });
    expect(resolveRemote('nonexistent').ok).toBe(false);
  });
});

describe('view — always --json, never bare view', () => {
  it('builds the exact argument array', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDOUT = '{"trunk":"main","branches":[]}';
    const result = view();
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'view', '--json'] });
    expect(result.status).toBe('SUCCESS');
    expect(result.mayHaveMutated).toBe(false);
  });

  it('does not crash on malformed or missing JSON in stdout (schema drift tolerance)', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDOUT = 'not json at all {{{';
    const result = view();
    expect(result.status).toBe('SUCCESS');
    expect(result.stdout).toContain('not json at all');
  });

  it('bounds oversized stdout before it reaches the caller', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDOUT = 'x'.repeat(20000);
    const result = view();
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdoutTotalChars).toBe(20000);
    expect(result.stdout.length).toBeLessThan(9000);
  });
});

describe('init / add / checkout — explicit target always required', () => {
  it('init requires an explicit base and branch, both validated', () => {
    process.env.FAKE_GH_EXIT = '0';
    const ok = init({ base: 'main', branch: 'feat/one' });
    expect(ok.command).toEqual({ bin: 'gh', args: ['stack', 'init', '-b', 'main', 'feat/one'] });
    expect(ok.mayHaveMutated).toBe(true);

    const badBase = init({ base: '-flag', branch: 'feat/one' });
    expect(badBase.status).toBe('INVALID_ARGS');
    expect(badBase.command).toBeNull();
  });

  it('add rejects a missing commit message before building any command', () => {
    const result = add({ branch: 'feat/one', message: '' });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
  });

  it('add builds the exact argument array with an explicit branch', () => {
    process.env.FAKE_GH_EXIT = '0';
    const result = add({ branch: 'feat/two', message: 'feat: add layer two' });
    expect(result.command).toEqual({
      bin: 'gh',
      args: ['stack', 'add', '-m', 'feat: add layer two', 'feat/two'],
    });
  });

  it('checkout accepts a PR number, a github.com URL, or a validated branch name — never falls through to the interactive picker', () => {
    process.env.FAKE_GH_EXIT = '0';
    expect(checkout({ target: '42' }).command?.args).toEqual(['stack', 'checkout', '42']);
    expect(checkout({ target: 'https://github.com/org/repo/pull/42' }).command?.args).toEqual([
      'stack',
      'checkout',
      'https://github.com/org/repo/pull/42',
    ]);
    expect(checkout({ target: 'feat/valid' }).command?.args).toEqual(['stack', 'checkout', 'feat/valid']);
    expect(checkout({ target: '-flag' }).status).toBe('INVALID_ARGS');
    expect(checkout({ target: '' }).status).toBe('INVALID_ARGS');
  });
});

describe('rebase — upstack/downstack/continue/abort; modify and switch are never invoked (no such op exists)', () => {
  it('modify and switch have no adapter functions at all', () => {
    expect(runtime.modify).toBeUndefined();
    expect(runtime.switch).toBeUndefined();
    expect(Object.keys(runtime.OPERATIONS)).not.toContain('modify');
    expect(Object.keys(runtime.OPERATIONS)).not.toContain('switch');
  });

  it('builds --upstack with remote resolution', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = rebase({ mode: 'upstack' });
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'rebase', '--upstack'] });
  });

  it('continue and abort never attempt remote resolution', () => {
    process.env.FAKE_GH_EXIT = '3';
    const cont = rebase({ mode: 'continue' });
    expect(cont.command).toEqual({ bin: 'gh', args: ['stack', 'rebase', '--continue'] });
    expect(cont.status).toBe('CONFLICT');
    expect(cont.recoveryAction).toContain('conflict');

    const abort = rebase({ mode: 'abort' });
    expect(abort.command).toEqual({ bin: 'gh', args: ['stack', 'rebase', '--abort'] });
  });

  it('rejects an unknown mode', () => {
    expect(rebase({ mode: 'sideways' }).status).toBe('INVALID_ARGS');
  });
});

describe('exit-code -> status mapping (1-10, verified against gh-stack source)', () => {
  const cases: Array<[string, string]> = [
    ['1', 'ERROR'],
    ['2', 'NOT_IN_STACK'],
    ['3', 'CONFLICT'],
    ['4', 'API_FAILURE'],
    ['5', 'INVALID_ARGS'],
    ['6', 'AMBIGUOUS_STACK'],
    ['7', 'REBASE_ACTIVE'],
    ['8', 'LOCK_FAILED'],
    ['9', 'STACKS_UNAVAILABLE'],
    ['10', 'MODIFY_RECOVERY'],
  ];

  it.each(cases)('exit %s -> %s', (exitCode, status) => {
    process.env.FAKE_GH_EXIT = exitCode;
    const result = view();
    expect(result.status).toBe(status);
    expect(result.recoveryAction).not.toBeNull();
  });

  it('exit 10 (MODIFY_RECOVERY) recovery action explicitly says this runtime never invokes modify', () => {
    process.env.FAKE_GH_EXIT = '10';
    const result = view();
    expect(result.recoveryAction).toContain('never invokes');
  });
});

describe('sync — exit-0 "Sync aborted" is SYNC_ABORTED, not SUCCESS', () => {
  it('detects the sync-abort text even though the exit code is 0', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDOUT = 'Sync aborted — no changes were made\\n';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = sync({});
    expect(result.status).toBe('SYNC_ABORTED');
    expect(result.mayHaveMutated).toBe(true);
  });

  it('a genuinely successful sync (exit 0, no abort text) is SUCCESS', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDOUT = 'Synced 3 branches.\\n';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = sync({});
    expect(result.status).toBe('SUCCESS');
  });

  it('--prune requires confirm: true and runs nothing without it', () => {
    const result = sync({ prune: true });
    expect(result.status).toBe('REQUIRES_CONFIRMATION');
    expect(result.command).toBeNull();
    expect(result.mayHaveMutated).toBe(false);
  });

  it('--prune runs once confirm: true is passed', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = sync({ prune: true, confirm: true });
    expect(result.command?.args).toContain('--prune');
  });
});

describe('submit — --auto always present, --open only when explicit (draft by default)', () => {
  it('defaults to draft (no --open)', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = submit({});
    expect(result.command?.args).toEqual(['stack', 'submit', '--auto']);
  });

  it('adds --open only when explicitly requested', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = submit({ open: true });
    expect(result.command?.args).toEqual(['stack', 'submit', '--auto', '--open']);
  });

  it('a failed submit still reports mayHaveMutated: true (partial push/submit)', () => {
    process.env.FAKE_GH_EXIT = '4';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = submit({});
    expect(result.status).toBe('API_FAILURE');
    expect(result.mayHaveMutated).toBe(true);
  });
});

describe('merge — explicit target and confirm required; never gh pr merge', () => {
  beforeEach(() => {
    process.env.FAKE_GIT_REMOTE_URLS = 'origin=https://github.com/o/r.git';
  });

  it('refuses without an explicit target', () => {
    expect(merge({ confirm: true }).status).toBe('INVALID_ARGS');
  });

  it('requires confirm: true and runs nothing without it, naming the repository it would merge in', () => {
    const result = merge({ target: '42' });
    expect(result.status).toBe('REQUIRES_CONFIRMATION');
    expect(result.command).toBeNull();
    expect(result.repository).toBe('o/r');
    expect(result.safeSummary).toContain('in o/r');
  });

  it('builds gh stack merge <target> --yes once confirmed', () => {
    process.env.FAKE_GH_EXIT = '0';
    const result = merge({ target: '42', confirm: true });
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'merge', '42', '--yes'] });
    expect(result.repository).toBe('o/r');
  });

  it('reduces a github.com pull request URL to its number — gh stack merge exits 5 on a URL', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTE_URLS = 'origin=https://github.com/O/r.git';
    const result = merge({ target: 'https://github.com/o/r/pull/42', confirm: true });
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'merge', '42', '--yes'] });
  });

  it('accepts ssh and credential-bearing remote URL forms for the same repository', () => {
    process.env.FAKE_GH_EXIT = '0';
    for (const url of [
      'git@github.com:o/r.git',
      'github.com:o/r',
      'ssh://git@github.com/o/r',
      'ssh://git@github.com:22/o/r.git',
      'ssh://git@ssh.github.com:443/o/r.git',
      'https://x-access-token:abc@github.com/o/r',
      'https://github.com:443/O/r.git/',
    ]) {
      process.env.FAKE_GIT_REMOTE_URLS = `origin=${url}`;
      expect(merge({ target: 'https://github.com/o/r/pull/42', confirm: true }).status).toBe('SUCCESS');
    }
  });

  it('refuses a pull request URL from another repository — its number would merge a different PR here', () => {
    for (const confirm of [true, false]) {
      const result = merge({ target: 'https://github.com/other/project/pull/42', confirm });
      expect(result.status).toBe('INVALID_ARGS');
      expect(result.command).toBeNull();
      expect(result.refusalReason).toContain('other/project');
    }
  });

  it('refuses a pull request URL when GH_REPO points gh at another repository', () => {
    process.env.GH_REPO = 'x/y';
    const result = merge({ target: 'https://github.com/o/r/pull/42', confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
    expect(result.refusalReason).toContain('x/y');
    expect(result.refusalReason).toContain('GH_REPO');
  });

  it('accepts a pull request URL when GH_REPO names the same repository, and names it when asking', () => {
    process.env.FAKE_GH_EXIT = '0';
    for (const override of ['o/r', 'github.com/O/R', 'https://github.com/o/r']) {
      process.env.GH_REPO = override;
      const result = merge({ target: 'https://github.com/o/r/pull/42', confirm: true });
      expect(result.command?.args).toEqual(['stack', 'merge', '42', '--yes']);
    }
    expect(merge({ target: 'https://github.com/o/r/pull/42' }).safeSummary).toContain('in o/r');
  });

  it('a numeric target lands where GH_REPO points, and says so before confirming', () => {
    process.env.GH_REPO = 'x/y';
    const result = merge({ target: '42' });
    expect(result.status).toBe('REQUIRES_CONFIRMATION');
    expect(result.repository).toBe('x/y');
    expect(result.safeSummary).toContain('in x/y (from GH_REPO)');
  });

  it('reads GH_REPO OWNER/REPO literally, as gh does, and only drops .git from a URL', () => {
    process.env.GH_REPO = 'o/r.git';
    expect(merge({ target: '42' }).repository).toBe('o/r.git');
    expect(merge({ target: 'https://github.com/o/r/pull/42', confirm: true }).status).toBe('INVALID_ARGS');
    process.env.GH_REPO = 'https://github.com/o/r.git';
    expect(merge({ target: '42' }).repository).toBe('o/r');
  });

  it('refuses a GH_REPO on another host — the runtime cannot tell which pull request that is', () => {
    process.env.GH_REPO = 'ghe.example.com/o/r';
    const result = merge({ target: '42', confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.refusalReason).toContain('GH_REPO');
  });

  it('reads a hostless GH_REPO on GH_HOST, as gh does', () => {
    process.env.GH_REPO = 'o/r';
    process.env.GH_HOST = 'ghe.example.com';
    const result = merge({ target: 'https://github.com/o/r/pull/42', confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.refusalReason).toContain('GH_REPO');
    process.env.GH_HOST = 'github.com';
    expect(merge({ target: '42' }).repository).toBe('o/r');
  });

  it('with a fork and its upstream, a URL must name the repository gh resolves (upstream ranks first)', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTE_URLS = 'origin=https://github.com/me/r.git upstream=https://github.com/o/r.git';
    const fork = merge({ target: 'https://github.com/me/r/pull/42', confirm: true });
    expect(fork.status).toBe('INVALID_ARGS');
    expect(fork.refusalReason).toContain('o/r');
    expect(merge({ target: 'https://github.com/o/r/pull/42', confirm: true }).status).toBe('SUCCESS');
    expect(merge({ target: '42' }).repository).toBe('o/r');
  });

  it('follows a gh repo set-default mark that agrees with the ranking, refuses one that does not', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTE_URLS = 'origin=https://github.com/me/r.git upstream=https://github.com/o/r.git';
    process.env.FAKE_GIT_GH_RESOLVED = 'upstream=base';
    expect(merge({ target: '42' }).repository).toBe('o/r');
    process.env.FAKE_GIT_GH_RESOLVED = 'origin=base';
    const disputed = merge({ target: '42', confirm: true });
    expect(disputed.status).toBe('INVALID_ARGS');
    expect(disputed.refusalReason).toContain('more than one repository');
    process.env.FAKE_GIT_GH_RESOLVED = 'upstream=o/r';
    expect(merge({ target: '42' }).repository).toBe('o/r');
  });

  it('refuses when two equally ranked remotes name different repositories', () => {
    process.env.FAKE_GIT_REMOTE_URLS = 'a=https://github.com/o/r.git b=https://github.com/me/r.git';
    const result = merge({ target: '42', confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
  });

  it('refuses when the confirmed repository is not the one gh stack would merge in now', () => {
    process.env.FAKE_GH_EXIT = '0';
    const moved = merge({ target: '42', repository: 'x/y', confirm: true });
    expect(moved.status).toBe('INVALID_ARGS');
    expect(moved.command).toBeNull();
    expect(merge({ target: '42', repository: 'O/R', confirm: true }).status).toBe('SUCCESS');
    expect(merge({ target: '42', repository: 'o/r --squash', confirm: true }).status).toBe('INVALID_ARGS');
  });

  it('fails closed when the remotes or the set-default marks cannot be read', () => {
    process.env.FAKE_GIT_REMOTE_LIST_EXIT = '128';
    expect(merge({ target: '42', confirm: true }).status).toBe('INVALID_ARGS');
    delete process.env.FAKE_GIT_REMOTE_LIST_EXIT;
    process.env.FAKE_GIT_GH_RESOLVED_EXIT = '3';
    expect(merge({ target: '42', confirm: true }).status).toBe('INVALID_ARGS');
  });

  it('does not read a look-alike host or a deeper path as a github.com repository', () => {
    for (const url of ['https://github.com.evil.example/o/r', 'git@notgithub.com:o/r.git', 'https://github.com/o/r/extra', 'file:///github.com/o/r']) {
      process.env.FAKE_GIT_REMOTE_URLS = `origin=${url}`;
      expect(merge({ target: '42', confirm: true }).status).toBe('INVALID_ARGS');
    }
  });

  it('refuses any target when no github.com remote can be read', () => {
    delete process.env.FAKE_GIT_REMOTE_URLS;
    for (const target of ['42', 'https://github.com/o/r/pull/42']) {
      const result = merge({ target, confirm: true });
      expect(result.status).toBe('INVALID_ARGS');
      expect(result.command).toBeNull();
    }
  });

  it('refuses a github.com URL that is not a pull request', () => {
    for (const target of [
      'https://github.com/o/r/issues/42',
      'https://github.com/o/r/pull/42/files',
      'https://github.com/o/r/pull/0',
      'https://github.com/o/r',
    ]) {
      const result = merge({ target, confirm: true });
      expect(result.status).toBe('INVALID_ARGS');
      expect(result.command).toBeNull();
    }
  });

  it('the confirmation request says the pull requests below the target merge too', () => {
    const result = merge({ target: '42' });
    expect(result.status).toBe('REQUIRES_CONFIRMATION');
    expect(result.safeSummary).toContain('every unmerged pull request below it');
  });

  it('refuses a flag-shaped target instead of letting it reach argv (argv-smuggling guard)', () => {
    const result = merge({ target: '--squash', confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
  });

  it('refuses a bare branch name as target — gh stack merge does not accept one', () => {
    const result = merge({ target: 'my-feature-branch', confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
  });

  it('validates mergeMethod against the fixed enum', () => {
    const result = merge({ target: '42', confirm: true, mergeMethod: 'octopus' });
    expect(result.status).toBe('INVALID_ARGS');
  });

  it('this runtime has no function that calls `gh pr merge` for a stack', () => {
    const source = readFileSync(LIB, 'utf8');
    expect(source).not.toMatch(/['"]pr['"],\s*['"]merge['"]/);
  });
});

describe('merge-single — one ordinary pull request, never a stacked one', () => {
  const HEAD = 'a'.repeat(40);
  const OTHER = 'b'.repeat(40);
  let logDir: string;
  let logFile: string;

  function pullRequest(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      number: 42,
      state: 'open',
      draft: false,
      merged: false,
      mergeable_state: 'clean',
      head: { sha: HEAD, ref: 'feat/x', repo: { full_name: 'O/r' } },
      base: { ref: 'main', repo: { full_name: 'o/r', default_branch: 'main' } },
      ...overrides,
    });
  }

  function token(method = 'squash', overrides: Record<string, unknown> = {}): string {
    return previewTokenOf({ number: 42, repository: 'o/r', baseRef: 'main', headSha: HEAD, ...overrides }, method);
  }

  function calls(): string[] {
    try {
      return readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'merge-single-'));
    logFile = join(logDir, 'gh.log');
    process.env.FAKE_GH_LOG = logFile;
    process.env.FAKE_GH_GET_STDOUT = pullRequest();
    process.env.FAKE_GH_PUT_STDOUT = JSON.stringify({ merged: true, sha: OTHER, message: 'Pull Request successfully merged' });
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  it('refuses anything but a pull request number, before any call', () => {
    for (const target of [undefined, '', '0', '--squash', 'my-branch', 'https://github.com/o/r/pull/42']) {
      const result = mergeSingle({ target, mergeMethod: 'squash', previewToken: token(), confirm: true });
      expect(result.status).toBe('INVALID_ARGS');
    }
    expect(calls()).toEqual([]);
  });

  it('requires an explicit, valid merge method', () => {
    expect(mergeSingle({ target: '42', previewToken: token(), confirm: true }).refusalReason).toContain('mergeMethod is required');
    expect(mergeSingle({ target: '42', mergeMethod: 'octopus', previewToken: token(), confirm: true }).status).toBe('INVALID_ARGS');
    expect(calls()).toEqual([]);
  });

  it('refuses confirm without the preview token, and a malformed token', () => {
    expect(mergeSingle({ target: '42', mergeMethod: 'squash', confirm: true }).status).toBe('INVALID_ARGS');
    for (const previewToken of ['abc123', '$(printf${IFS}INJECTED)', `${token()}0`]) {
      expect(mergeSingle({ target: '42', mergeMethod: 'squash', previewToken, confirm: true }).status).toBe('INVALID_ARGS');
    }
    expect(calls()).toEqual([]);
  });

  it('without confirm it only reads the pull request and reports what would land', () => {
    const result = mergeSingle({ target: '42', mergeMethod: 'squash' });
    expect(result.status).toBe('REQUIRES_CONFIRMATION');
    expect(result.mayHaveMutated).toBe(false);
    expect(result.pullRequest).toEqual({
      number: 42,
      repository: 'o/r',
      baseRef: 'main',
      headRef: 'feat/x',
      headRepository: 'O/r',
      headInRepository: true,
      headSha: HEAD,
    });
    expect(result.safeSummary).toContain(HEAD);
    expect(result.previewToken).toBe(token());
    expect(calls()).toEqual(['api repos/{owner}/{repo}/pulls/42']);
  });

  it('reports a head branch that lives in a fork, or in a deleted fork, as outside the repository', () => {
    process.env.FAKE_GH_GET_STDOUT = pullRequest({ head: { sha: HEAD, ref: 'feat/x', repo: { full_name: 'me/r' } } });
    const fork = mergeSingle({ target: '42', mergeMethod: 'squash' }).pullRequest;
    expect(fork.headRepository).toBe('me/r');
    expect(fork.headInRepository).toBe(false);
    process.env.FAKE_GH_GET_STDOUT = pullRequest({ head: { sha: HEAD, ref: 'feat/x', repo: null } });
    const deleted = mergeSingle({ target: '42', mergeMethod: 'squash' }).pullRequest;
    expect(deleted.headRepository).toBe('');
    expect(deleted.headInRepository).toBe(false);
  });

  it('refuses a pull request that GitHub reports as part of a stack, confirmed or not', () => {
    process.env.FAKE_GH_GET_STDOUT = pullRequest({ stack: { id: 1, number: 1825, position: 2, size: 3 } });
    for (const confirm of [false, true]) {
      const result = mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm });
      expect(result.status).toBe('INVALID_ARGS');
      expect(result.refusalReason).toContain('belongs to a stack (stack #1825)');
    }
    expect(calls().some((line) => line.includes('PUT'))).toBe(false);
  });

  it('accepts a pull request whose stack field is null', () => {
    process.env.FAKE_GH_GET_STDOUT = pullRequest({ stack: null });
    expect(mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm: true }).status).toBe('SUCCESS');
  });

  it('refuses a draft, a closed or merged pull request, and an unreadable answer', () => {
    const cases: Array<[string, string]> = [
      [pullRequest({ draft: true }), 'is a draft'],
      [pullRequest({ state: 'closed' }), 'not open'],
      [pullRequest({ state: 'closed', merged: true }), 'already merged'],
      [pullRequest({ number: 43 }), 'could not be read'],
      [pullRequest({ head: { sha: 'short', ref: 'feat/x' } }), 'could not be read'],
      [pullRequest({ base: { ref: 'main', repo: { full_name: 'o/r' } } }), 'could not be read'],
      [pullRequest({ draft: undefined }), 'could not be read'],
      ['not json', 'could not be read'],
    ];
    for (const [body, reason] of cases) {
      process.env.FAKE_GH_GET_STDOUT = body;
      const result = mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm: true });
      expect(result.status).toBe('INVALID_ARGS');
      expect(result.refusalReason).toContain(reason);
    }
    expect(calls().some((line) => line.includes('PUT'))).toBe(false);
  });

  it('a failed lookup is API_FAILURE and nothing is merged', () => {
    process.env.FAKE_GH_GET_EXIT = '1';
    process.env.FAKE_GH_GET_STDOUT = '{"message":"Not Found"}';
    const result = mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm: true });
    expect(result.status).toBe('API_FAILURE');
    expect(result.mayHaveMutated).toBe(false);
    expect(calls().some((line) => line.includes('PUT'))).toBe(false);
  });

  it('refuses when the head moved, or the method differs, after the preview', () => {
    const stale = [
      mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token('squash', { headSha: OTHER }), confirm: true }),
      mergeSingle({ target: '42', mergeMethod: 'merge', previewToken: token('squash'), confirm: true }),
    ];
    for (const result of stale) {
      expect(result.status).toBe('INVALID_ARGS');
      expect(result.refusalReason).toContain('Nothing was merged');
    }
    expect(calls().some((line) => line.includes('PUT'))).toBe(false);
  });

  it('refuses a pull request based on a branch other than the default branch', () => {
    process.env.FAKE_GH_GET_STDOUT = pullRequest({ base: { ref: 'feat/lower-layer', repo: { full_name: 'o/r', default_branch: 'main' } } });
    for (const confirm of [false, true]) {
      const result = mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token('squash', { baseRef: 'feat/lower-layer' }), confirm });
      expect(result.status).toBe('INVALID_ARGS');
      expect(result.refusalReason).toContain('not an independent pull request');
    }
    expect(calls().some((line) => line.includes('PUT'))).toBe(false);
  });

  it('refuses a pull request GitHub does not report as mergeable, so an admin token cannot bypass protection', () => {
    for (const state of ['blocked', 'behind', 'dirty', 'unknown', undefined]) {
      process.env.FAKE_GH_GET_STDOUT = pullRequest({ mergeable_state: state });
      for (const confirm of [false, true]) {
        const result = mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm });
        expect(result.status).toBe('INVALID_ARGS');
      }
    }
    expect(calls().some((line) => line.includes('PUT'))).toBe(false);
    process.env.FAKE_GH_GET_STDOUT = pullRequest({ mergeable_state: 'unstable' });
    expect(mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm: true }).status).toBe('SUCCESS');
  });

  it('refuses when the base branch changed after the preview, with the same head', () => {
    const previewed = token();
    process.env.FAKE_GH_GET_STDOUT = pullRequest({ base: { ref: 'release', repo: { full_name: 'o/r', default_branch: 'release' } } });
    const result = mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: previewed, confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.refusalReason).toContain('Nothing was merged');
    expect(calls().some((line) => line.includes('PUT'))).toBe(false);
  });

  it('confirmed with the shown head, it merges through the REST endpoint with that head pinned', () => {
    const result = mergeSingle({ target: '42', mergeMethod: 'rebase', previewToken: token('rebase'), confirm: true });
    expect(result.status).toBe('SUCCESS');
    expect(result.mayHaveMutated).toBe(true);
    expect(result.command).toEqual({
      bin: 'gh',
      args: ['api', '-X', 'PUT', 'repos/{owner}/{repo}/pulls/42/merge', '-f', 'merge_method=rebase', '-f', `sha=${HEAD}`],
    });
    expect(calls()).toEqual([
      'api repos/{owner}/{repo}/pulls/42',
      `api -X PUT repos/{owner}/{repo}/pulls/42/merge -f merge_method=rebase -f sha=${HEAD}`,
    ]);
  });

  it('a refused merge call is API_FAILURE, and exit 0 without merged: true is not SUCCESS', () => {
    process.env.FAKE_GH_PUT_EXIT = '1';
    process.env.FAKE_GH_PUT_STDOUT = '{"message":"Required status check is expected."}';
    const refused = mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm: true });
    expect(refused.status).toBe('API_FAILURE');
    expect(refused.recoveryAction).toContain('do not retry unchanged');
    process.env.FAKE_GH_PUT_EXIT = '0';
    process.env.FAKE_GH_PUT_STDOUT = '{"merged":false}';
    expect(mergeSingle({ target: '42', mergeMethod: 'squash', previewToken: token(), confirm: true }).status).toBe('ERROR');
  });

  it('is reachable from the CLI as merge-single with --preview-token', () => {
    const out = execFileSync(
      'node',
      [LIB, 'merge-single', '--target', '42', '--merge-method', 'squash', '--preview-token', token(), '--confirm'],
      { encoding: 'utf8', env: process.env }
    );
    expect(JSON.parse(out).status).toBe('SUCCESS');
  });
});

describe('unstack — destructive, always requires confirm: true', () => {
  it('refuses without confirmation', () => {
    const result = unstack({});
    expect(result.status).toBe('REQUIRES_CONFIRMATION');
  });

  it('refusal message for the default (no --local) call names the remote GitHub API unstack', () => {
    const result = unstack({});
    expect(result.safeSummary).toContain('remote-unstacks every PR');
    expect(result.safeSummary).toContain('GitHub API');
    expect(result.safeSummary).toContain('no branch deletion');
  });

  it('refusal message for --local names the local-only scope', () => {
    const result = unstack({ local: true });
    expect(result.safeSummary).toContain('local stack tracking only');
    expect(result.safeSummary).toContain('no remote call');
  });

  it('runs once confirmed', () => {
    process.env.FAKE_GH_EXIT = '0';
    const result = unstack({ confirm: true, local: true });
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'unstack', '--local'] });
  });
});

describe('CLI end to end', () => {
  it('produces the same shaped JSON as the direct function call', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDOUT = '{"trunk":"main"}';
    const cliResult = JSON.parse(
      execFileSync(process.execPath, [LIB, 'view'], { encoding: 'utf8', env: process.env })
    );
    expect(cliResult.status).toBe('SUCCESS');
    expect(cliResult.command).toEqual({ bin: 'gh', args: ['stack', 'view', '--json'] });
  });

  it('exits 1 on an unknown operation, printing nothing that looks like a result JSON', () => {
    expect(() =>
      execFileSync(process.execPath, [LIB, 'teleport'], { encoding: 'utf8', env: process.env })
    ).toThrow();
  });

  it('accepts --timeout-ms without changing the shaped result', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDOUT = '{"trunk":"main"}';
    const cliResult = JSON.parse(
      execFileSync(process.execPath, [LIB, '--timeout-ms', '600000', 'view'], {
        encoding: 'utf8',
        env: process.env,
      })
    );
    expect(cliResult.status).toBe('SUCCESS');
    expect(cliResult.command).toEqual({ bin: 'gh', args: ['stack', 'view', '--json'] });
  });

  it('applies --timeout-ms to the gh subprocess: a slow gh is killed and reported as SPAWN_FAILURE', () => {
    process.env.FAKE_GH_SLEEP = '5';
    const started = Date.now();
    const cliResult = JSON.parse(
      execFileSync(process.execPath, [LIB, '--timeout-ms', '200', 'view'], {
        encoding: 'utf8',
        env: process.env,
      })
    );
    expect(cliResult.status).toBe('SPAWN_FAILURE');
    expect(Date.now() - started).toBeLessThan(4500);
  });

  it('rejects a malformed --timeout-ms before running anything', () => {
    process.env.FAKE_GH_EXIT = '0';
    for (const bad of ['1foo', '0', '-5', '1e3', '2.5', '9007199254740993', 'view']) {
      let error: { status?: number; stdout?: string; stderr?: string } | undefined;
      try {
        execFileSync(process.execPath, [LIB, '--timeout-ms', bad, 'view'], {
          encoding: 'utf8',
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (caught) {
        error = caught as typeof error;
      }
      expect(error, `--timeout-ms ${bad} must fail`).toBeDefined();
      expect(error?.status).toBe(1);
      expect(error?.stdout).toBe('');
      expect(error?.stderr).toContain('--timeout-ms must be a positive integer');
    }
  });
});

// Token-shaped strings are BUILT at runtime, never written as literals:
// a literal `ghp_` + 36 chars in the source is indistinguishable from a real
// leaked credential to a secret scanner (GitGuardian flagged exactly that on
// the first version of this suite), and a test for redaction must not itself
// look like the thing it redacts.
const fakeToken = (prefix: string, fill: string, len = 36) => `${prefix}${fill.repeat(len)}`;

describe('credential redaction — subprocess output never carries secrets into the result', () => {
  it('redacts a credential-bearing remote URL (the realistic git-error vector)', () => {
    const secret = fakeToken('ghp_', 'A');
    const out = redact(`fatal: could not read from https://user:${secret}@github.com/o/r.git`);
    expect(out).toContain('[REDACTED:basic-auth]');
    expect(out).not.toContain(secret);
  });

  it('redacts bare GitHub tokens in every documented prefix form', () => {
    const token = 'A'.repeat(36);
    for (const prefix of ['ghp_', 'ghs_', 'gho_']) {
      expect(redact(`token ${prefix}${token} leaked`)).toContain('[REDACTED:github-token]');
      expect(redact(`token ${prefix}${token} leaked`)).not.toContain(token);
    }
    expect(redact(`github_pat_${'B'.repeat(30)}`)).toContain('[REDACTED:github-pat]');
  });

  it('redacts Authorization headers, JWTs, and URL credential params', () => {
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('Bearer [REDACTED]');
    expect(redact(`eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`)).toBe('[REDACTED:jwt]');
    expect(redact('https://h/x?token=deadbeef&z=1')).toContain('token=[REDACTED:url-param]');
  });

  it('leaves ordinary output untouched', () => {
    const plain = 'Merging #1, #2 into main via merge...\n✓ Merged #1, #2 into main (f661738)';
    expect(redact(plain)).toBe(plain);
  });

  it('redacts secrets that reach the result through real subprocess stderr, not just the helper', () => {
    const secret = fakeToken('ghp_', 'C');
    process.env.FAKE_GH_EXIT = '1';
    process.env.FAKE_GH_STDERR = `fatal: https://u:${secret}@github.com/o/r.git rejected`;
    const result = submit({});
    expect(result.stderr).toContain('[REDACTED:basic-auth]');
    expect(result.stderr).not.toContain(secret);
  });

  it('redacts credentials carried in ARGUMENTS, not just subprocess output', () => {
    // A validated argument can still carry credential material — e.g. a
    // commit message quoting a token. command.args and safeSummary are
    // serialized into model context verbatim, so redacting only
    // stdout/stderr would leave the guarantee half-true.
    const secret = fakeToken('ghp_', 'E');
    process.env.FAKE_GH_EXIT = '0';
    const result = add({ branch: 'feat/x', message: `paste accident ${secret}` });
    expect(JSON.stringify(result.command)).not.toContain(secret);
    expect(result.safeSummary).not.toContain(secret);
    expect(JSON.stringify(result.command)).toContain('[REDACTED:github-token]');
  });

  it('redacts credentials echoed back in a refusal reason', () => {
    const secret = fakeToken('ghp_', 'F');
    const result = merge({ target: secret, confirm: true });
    expect(result.status).toBe('INVALID_ARGS');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('redacts BEFORE truncation, so a secret cannot survive past the output cap', () => {
    const secret = fakeToken('ghp_', 'D');
    const padded = `${'x'.repeat(9000)}${secret}`;
    const out = redact(padded);
    expect(out).not.toContain(secret);
  });
});

describe('add — a local operation that never takes a remote', () => {
  it('passes no --remote even when several remotes exist and pushDefault is set (gh stack add has no such flag)', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\nupstream\n';
    process.env.FAKE_GIT_PUSH_DEFAULT = 'origin';
    const result = add({ branch: 'feat/two', message: 'feat: add layer two' });
    expect(result.command?.args).toEqual(['stack', 'add', '-m', 'feat: add layer two', 'feat/two']);
  });

  it('is not refused for an ambiguous remote', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\nupstream\n';
    expect(add({ branch: 'feat/two', message: 'feat: add layer two' }).status).toBe('SUCCESS');
  });
});

describe('init — adopting existing branches, bottom to top', () => {
  it('passes every branch in order when each contains the one below', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_BRANCHES = 'a b c';
    const result = init({ base: 'main', branches: ['a', 'b', 'c'] });
    expect(result.command?.args).toEqual(['stack', 'init', '-b', 'main', 'a', 'b', 'c']);
    expect(result.status).toBe('SUCCESS');
  });

  it('refuses an order in which a branch does not contain the one below, and runs nothing', () => {
    process.env.FAKE_GIT_BRANCHES = 'a b';
    process.env.FAKE_GIT_NOT_ANCESTOR = 'b:a';
    const result = init({ base: 'main', branches: ['b', 'a'] });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
    expect(result.mayHaveMutated).toBe(false);
    expect(result.refusalReason).toContain('does not contain');
  });

  it('checks ancestry across a branch that does not exist yet', () => {
    process.env.FAKE_GIT_BRANCHES = 'a c';
    process.env.FAKE_GIT_NOT_ANCESTOR = 'a:c';
    expect(init({ base: 'main', branches: ['a', 'new', 'c'] }).status).toBe('INVALID_ARGS');
  });

  it('refuses when the ancestry check itself fails, rather than assuming the order is right', () => {
    process.env.FAKE_GIT_BRANCHES = 'a b';
    process.env.FAKE_GIT_ANCESTRY_EXIT = '128';
    const result = init({ base: 'main', branches: ['a', 'b'] });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
  });

  it('refuses when the branch lookup itself fails, rather than treating the branch as new', () => {
    process.env.FAKE_GIT_REVPARSE_EXIT = '128';
    const result = init({ base: 'main', branches: ['a', 'b'] });
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
    expect(result.refusalReason).toContain('could not check whether branch');
  });

  it('refuses a duplicate branch, the base as a layer, and an invalid name', () => {
    expect(init({ base: 'main', branches: ['a', 'a'] }).status).toBe('INVALID_ARGS');
    expect(init({ base: 'main', branches: ['main', 'a'] }).status).toBe('INVALID_ARGS');
    expect(init({ base: 'main', branches: ['a', '--force'] }).status).toBe('INVALID_ARGS');
  });

  it('the CLI collects repeated --branch flags in order', () => {
    const raw = execFileSync(
      'node',
      [LIB, 'init', '--base', 'main', '--branch', 'a', '--branch', 'b'],
      { encoding: 'utf8', env: { ...process.env, FAKE_GH_EXIT: '0', FAKE_GIT_BRANCHES: 'a b' } }
    );
    expect(JSON.parse(raw).command.args).toEqual(['stack', 'init', '-b', 'main', 'a', 'b']);
  });
});

describe('push — pushes rebased branches without touching pull requests', () => {
  it('builds gh stack push and never passes --no-atomic', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = push({});
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'push'] });
    expect(result.mayHaveMutated).toBe(true);
  });

  it('never lets an inherited GH_STACK_NO_ATOMIC reach gh, on push, sync or submit', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    process.env.FAKE_GH_REPORT_NO_ATOMIC = '1';
    process.env.GH_STACK_NO_ATOMIC = '1';
    for (const result of [push({}), sync({}), submit({})]) {
      expect(result.stderr).toContain('no-atomic: absent');
      expect(result.stderr).not.toContain('no-atomic: inherited');
    }
  });

  it('refuses an ambiguous remote instead of letting gh-stack pick one', () => {
    process.env.FAKE_GIT_REMOTES = 'origin\nupstream\n';
    const result = push({});
    expect(result.status).toBe('INVALID_ARGS');
    expect(result.command).toBeNull();
  });

  it('uses a verified remote.pushDefault', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\nupstream\n';
    process.env.FAKE_GIT_PUSH_DEFAULT = 'origin';
    expect(push({}).command?.args).toEqual(['stack', 'push', '--remote', 'origin']);
  });

  it('a failed push still reports mayHaveMutated: true', () => {
    process.env.FAKE_GH_EXIT = '1';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = push({});
    expect(result.status).toBe('ERROR');
    expect(result.mayHaveMutated).toBe(true);
  });
});

describe('a retargeted base is never reported as a finished sync or rebase', () => {
  const NOTICE = 'stack not rebased; rerun with --accept-base-change to rebase onto main\\n';

  it('sync: the notice on stderr with exit 0 is BASE_CHANGE_UNCONFIRMED', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDERR = NOTICE;
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = sync({});
    expect(result.status).toBe('BASE_CHANGE_UNCONFIRMED');
    expect(result.recoveryAction).toContain('acceptBaseChange');
  });

  it('rebase: the notice with a failing exit code is BASE_CHANGE_UNCONFIRMED, not a generic error', () => {
    process.env.FAKE_GH_EXIT = '1';
    process.env.FAKE_GH_STDERR = NOTICE;
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    expect(rebase({ mode: 'upstack' }).status).toBe('BASE_CHANGE_UNCONFIRMED');
  });

  it('--accept-base-change requires confirm: true on sync and rebase', () => {
    expect(sync({ acceptBaseChange: true }).status).toBe('REQUIRES_CONFIRMATION');
    expect(rebase({ mode: 'upstack', acceptBaseChange: true }).status).toBe('REQUIRES_CONFIRMATION');
  });

  it('passes --accept-base-change once confirmed', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    expect(sync({ acceptBaseChange: true, confirm: true }).command?.args).toEqual([
      'stack',
      'sync',
      '--accept-base-change',
    ]);
    expect(rebase({ mode: 'upstack', acceptBaseChange: true, confirm: true }).command?.args).toEqual([
      'stack',
      'rebase',
      '--upstack',
      '--accept-base-change',
    ]);
  });

  it('refuses --accept-base-change on continue and abort', () => {
    expect(rebase({ mode: 'continue', acceptBaseChange: true, confirm: true }).status).toBe('INVALID_ARGS');
    expect(rebase({ mode: 'abort', acceptBaseChange: true, confirm: true }).status).toBe('INVALID_ARGS');
  });
});

describe('sync — "Sync aborted" on stderr (where gh-stack 0.3.0 writes progress) is SYNC_ABORTED', () => {
  it('detects the abort text on stderr with exit 0', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDERR = 'Sync aborted\\n';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    expect(sync({}).status).toBe('SYNC_ABORTED');
  });
});

describe('exit 0 with a failed step is INCOMPLETE, never SUCCESS', () => {
  const WARNING =
    'Pushing to origin...\\n\u26a0 failed to check PR for feat/one: querying PRs: non-200 OK status code: 403 Forbidden\\n\u2713 Pushed and synced 1 branches\\n';

  it('submit: a pull request lookup that failed is not a successful submit', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDERR = WARNING;
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    const result = submit({});
    expect(result.status).toBe('INCOMPLETE');
    expect(result.exitCode).toBe(0);
    expect(result.mayHaveMutated).toBe(true);
    expect(result.recoveryAction).toContain('do not report the stack as submitted');
  });

  it('sync: the same warning is INCOMPLETE', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDERR = WARNING;
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    expect(sync({}).status).toBe('INCOMPLETE');
  });

  it('an ordinary warning that is not a failed step stays SUCCESS', () => {
    process.env.FAKE_GH_EXIT = '0';
    process.env.FAKE_GH_STDERR = '\u26a0 branch feat/one has no commits\\n\u2713 done\\n';
    process.env.FAKE_GIT_REMOTES = 'origin\n';
    expect(submit({}).status).toBe('SUCCESS');
  });
});
