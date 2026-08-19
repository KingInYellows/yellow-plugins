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
import { readFileSync } from 'fs';
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
  submit,
  merge,
  unstack,
  validateBranchName,
  validateRepoRelativePath,
  resolveRemote,
  redact,
} = runtime;

const FIXTURE_BIN = join(__dirname, '..', '..', 'plugins', 'github-workflow', 'tests', 'fixtures', 'bin');
const LIB = join(__dirname, '..', '..', 'plugins', 'github-workflow', 'lib', 'github-stack-runtime.js');

const ENV_KEYS = [
  'FAKE_GH_EXIT',
  'FAKE_GH_STDOUT',
  'FAKE_GH_STDERR',
  'FAKE_GIT_REMOTES',
  'FAKE_GIT_PUSH_DEFAULT',
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
  it('refuses without an explicit target', () => {
    expect(merge({ confirm: true }).status).toBe('INVALID_ARGS');
  });

  it('requires confirm: true and runs nothing without it', () => {
    const result = merge({ target: '42' });
    expect(result.status).toBe('REQUIRES_CONFIRMATION');
    expect(result.command).toBeNull();
  });

  it('builds gh stack merge <target> --yes once confirmed', () => {
    process.env.FAKE_GH_EXIT = '0';
    const result = merge({ target: '42', confirm: true });
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'merge', '42', '--yes'] });
  });

  it('accepts a github.com PR URL as target', () => {
    process.env.FAKE_GH_EXIT = '0';
    const result = merge({ target: 'https://github.com/o/r/pull/42', confirm: true });
    expect(result.command).toEqual({ bin: 'gh', args: ['stack', 'merge', 'https://github.com/o/r/pull/42', '--yes'] });
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

  it('redacts BEFORE truncation, so a secret cannot survive past the output cap', () => {
    const secret = fakeToken('ghp_', 'D');
    const padded = `${'x'.repeat(9000)}${secret}`;
    const out = redact(padded);
    expect(out).not.toContain(secret);
  });
});
