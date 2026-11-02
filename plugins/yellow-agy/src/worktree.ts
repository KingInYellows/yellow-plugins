/**
 * Git work on a delegate's worktree (contract-v0 "Run lifecycle" and
 * "Reservations, retries and recovery"): create it, snapshot it before each
 * turn, reset partial edits, and collect patches. Every git call goes through
 * HostExec, so on the WSL bridge it runs inside the distro with hooks off.
 */

import { AgyError } from './errors';
import type { ExecResult, HostExec } from './host-exec';

const BRANCH_RE =
  /^(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const LOCAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export function snapshotRefs(localId: string): {
  readonly preTurn: string;
  readonly preTurnIndex: string;
} {
  checkLocalId(localId);
  return {
    preTurn: `refs/yellow-agy/${localId}/pre-turn`,
    preTurnIndex: `refs/yellow-agy/${localId}/pre-turn-index`,
  };
}

function checkLocalId(localId: string): void {
  if (!LOCAL_ID_RE.test(localId)) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `invalid local id ${JSON.stringify(localId)}`
    );
  }
}

export function validateBranchName(branch: string): string {
  if (
    !BRANCH_RE.test(branch) ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.split('/').some((part) => part.endsWith('.lock')) ||
    branch.includes('/.')
  ) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `invalid branch name ${JSON.stringify(branch)}`
    );
  }
  return branch;
}

async function git(
  exec: HostExec,
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>
): Promise<string> {
  const res = await exec.git(args, env === undefined ? { cwd } : { cwd, env });
  if (res.code !== 0) throw gitError(args, res);
  return res.stdout;
}

async function gitBytes(
  exec: HostExec,
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>
): Promise<Buffer> {
  const res = await exec.git(args, env === undefined ? { cwd } : { cwd, env });
  if (res.code !== 0) throw gitError(args, res);
  return res.stdoutBytes;
}

function gitError(args: readonly string[], res: ExecResult): AgyError {
  const detail = res.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
  return new AgyError(
    'AGY_WORKTREE',
    `git ${args.slice(0, 2).join(' ')} failed: ${detail || `exit ${res.code}`}`
  );
}

function sha(out: string): string {
  const value = out.trim();
  if (!SHA_RE.test(value)) {
    throw new AgyError('AGY_INTERNAL', `git printed no object id: ${value}`);
  }
  return value;
}

export interface CreateWorktreeOptions {
  /** The owner's repository (a host path, or a WSL path on the bridge). */
  readonly repo: string;
  readonly worktree: string;
  readonly branch: string;
  /** Remote and branch to fetch the base from, e.g. origin / main. */
  readonly remote: string;
  readonly baseBranch: string;
}

/** Fetches the base and adds a worktree on a new branch; returns the base commit. */
export async function createWorktree(
  exec: HostExec,
  options: CreateWorktreeOptions
): Promise<string> {
  validateBranchName(options.branch);
  validateBranchName(options.baseBranch);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.remote)) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `invalid remote ${JSON.stringify(options.remote)}`
    );
  }
  const exists = await exec.git(
    ['show-ref', '--verify', '--quiet', `refs/heads/${options.branch}`],
    { cwd: options.repo }
  );
  if (exists.code === 0) {
    throw new AgyError(
      'AGY_WORKTREE',
      `branch ${options.branch} already exists; delegate needs a new branch`
    );
  }
  await git(exec, options.repo, [
    'fetch',
    '--no-tags',
    '--',
    options.remote,
    `refs/heads/${options.baseBranch}`,
  ]);
  const base = sha(
    await git(exec, options.repo, [
      'rev-parse',
      '--verify',
      'FETCH_HEAD^{commit}',
    ])
  );
  await git(exec, options.repo, [
    'worktree',
    'add',
    '-b',
    options.branch,
    '--',
    options.worktree,
    base,
  ]);
  return base;
}

export interface Snapshot {
  readonly head: string;
  readonly tree: string;
  readonly indexTree: string;
  readonly commit: string;
}

/** The temporary index path for `localId`, inside the worktree's git dir. */
async function tempIndexPath(
  exec: HostExec,
  worktree: string,
  localId: string,
  purpose: string
): Promise<string> {
  const out = await git(exec, worktree, [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    `yellow-agy-${purpose}-${localId}`,
  ]);
  return out.trim();
}

/**
 * Saves the pre-turn state: the real index as a tree, and a commit of every
 * tracked and untracked (not ignored) file, without touching the branch or
 * the real index.
 */
export async function snapshotWorktree(
  exec: HostExec,
  worktree: string,
  localId: string
): Promise<Snapshot> {
  const refs = snapshotRefs(localId);
  const head = sha(
    await git(exec, worktree, ['rev-parse', '--verify', 'HEAD'])
  );
  const indexTree = sha(await git(exec, worktree, ['write-tree']));
  const indexFile = await tempIndexPath(exec, worktree, localId, 'snapshot');
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    await git(exec, worktree, ['read-tree', indexTree], env);
    await git(exec, worktree, ['add', '--all'], env);
    const tree = sha(await git(exec, worktree, ['write-tree'], env));
    const commit = sha(
      await git(
        exec,
        worktree,
        [
          'commit-tree',
          tree,
          '-p',
          head,
          '-m',
          `yellow-agy pre-turn ${localId}`,
        ],
        {
          ...env,
          GIT_AUTHOR_NAME: 'yellow-agy',
          GIT_AUTHOR_EMAIL: 'yellow-agy@localhost',
          GIT_COMMITTER_NAME: 'yellow-agy',
          GIT_COMMITTER_EMAIL: 'yellow-agy@localhost',
        }
      )
    );
    await git(exec, worktree, ['update-ref', refs.preTurn, commit]);
    await git(exec, worktree, ['update-ref', refs.preTurnIndex, indexTree]);
    return { head, tree, indexTree, commit };
  } finally {
    await exec.removeFile(indexFile);
  }
}

function nulList(out: string): string[] {
  return out.split('\0').filter((p) => p !== '');
}

/** Ignored untracked paths that a reset to the snapshot could delete. */
export async function ignoredCollisions(
  exec: HostExec,
  worktree: string,
  snapshot: Pick<Snapshot, 'head' | 'commit'>
): Promise<string[]> {
  const ignored = nulList(
    await git(exec, worktree, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
    ])
  );
  if (ignored.length === 0) return [];
  const tracked = new Set<string>();
  for (const rev of [snapshot.head, snapshot.commit]) {
    for (const p of nulList(
      await git(exec, worktree, ['ls-tree', '-r', '--name-only', '-z', rev])
    )) {
      tracked.add(p);
    }
  }
  const hits = new Set<string>();
  for (const raw of ignored) {
    const dir = raw.endsWith('/');
    const p = dir ? raw.slice(0, -1) : raw;
    for (const t of tracked) {
      // Same path, a tracked file inside an ignored dir, or an ignored file
      // where a tracked dir needs to be.
      if (t === p || t.startsWith(`${p}/`) || p.startsWith(`${t}/`)) {
        hits.add(p);
      }
    }
  }
  return [...hits].sort();
}

/** Puts the worktree back to the snapshot, staged and unstaged parts as they were. */
export async function resetToSnapshot(
  exec: HostExec,
  worktree: string,
  localId: string,
  snapshot: Pick<Snapshot, 'head' | 'commit' | 'indexTree'>
): Promise<void> {
  const collisions = await ignoredCollisions(exec, worktree, snapshot);
  if (collisions.length > 0) {
    throw new AgyError(
      'AGY_WORKTREE',
      `ignored files would be overwritten by the reset: ${collisions.slice(0, 10).join(', ')}`,
      'Move the named ignored files out of the worktree, then retry --reset-partial.'
    );
  }
  await git(exec, worktree, ['reset', '--hard', snapshot.head]);
  await git(exec, worktree, ['clean', '-fd']);
  await git(exec, worktree, ['read-tree', '--reset', '-u', snapshot.commit]);
  await git(exec, worktree, ['read-tree', snapshot.indexTree]);
  await dropSnapshotRefs(exec, worktree, localId);
}

export async function dropSnapshotRefs(
  exec: HostExec,
  worktree: string,
  localId: string
): Promise<void> {
  const refs = snapshotRefs(localId);
  for (const ref of [refs.preTurn, refs.preTurnIndex]) {
    // A missing ref is fine (the turn may have settled already); any other
    // failure must surface, or a reset reports success with refs left over.
    const present = await exec.git(
      ['show-ref', '--verify', '--quiet', '--', ref],
      { cwd: worktree }
    );
    if (present.code === 1) continue;
    if (present.code !== 0) throw gitError(['show-ref', ref], present);
    await git(exec, worktree, ['update-ref', '-d', ref]);
  }
}

/** Patch options that ignore user config which would break `git apply`. */
const PATCH_FORMAT = [
  '--binary',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--src-prefix=a/',
  '--dst-prefix=b/',
] as const;

export interface Collected {
  /** format-patch output for commits since the base; empty when none. */
  readonly commits: Buffer;
  /** Binary diff of staged, unstaged and untracked changes against HEAD. */
  readonly uncommitted: Buffer;
  readonly commitCount: number;
}

/** Reads the delegate's work without touching the real index. */
export async function collectWorktree(
  exec: HostExec,
  worktree: string,
  localId: string,
  base: string
): Promise<Collected> {
  checkLocalId(localId);
  sha(base);
  const count = Number.parseInt(
    (
      await git(exec, worktree, ['rev-list', '--count', `${base}..HEAD`])
    ).trim(),
    10
  );
  // The repo's external diff and textconv helpers would run outside agy's
  // sandbox and replace the patch with their output, so both are off. Color
  // and custom prefixes from the user's config would make the patch unusable
  // by `git apply`, so the plain format is forced.
  const commits =
    count > 0
      ? await gitBytes(exec, worktree, [
          'format-patch',
          '--stdout',
          ...PATCH_FORMAT,
          `${base}..HEAD`,
        ])
      : Buffer.alloc(0);
  const realIndex = await git(exec, worktree, ['write-tree']);
  const indexFile = await tempIndexPath(exec, worktree, localId, 'collect');
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    await git(exec, worktree, ['read-tree', sha(realIndex)], env);
    await git(exec, worktree, ['add', '--intent-to-add', '--all'], env);
    const uncommitted = await gitBytes(
      exec,
      worktree,
      ['diff', ...PATCH_FORMAT, 'HEAD'],
      env
    );
    return { commits, uncommitted, commitCount: count };
  } finally {
    await exec.removeFile(indexFile);
  }
}

/** Removes the worktree and keeps the branch. */
export async function removeWorktree(
  exec: HostExec,
  repo: string,
  worktree: string
): Promise<void> {
  await git(exec, repo, ['worktree', 'remove', '--force', '--', worktree]);
}

/** Deletes `branch` only when it has no commits beyond `base`. */
export async function deleteBranchIfEmpty(
  exec: HostExec,
  repo: string,
  branch: string,
  base: string
): Promise<boolean> {
  validateBranchName(branch);
  const tip = await exec.git(
    ['rev-parse', '--verify', `refs/heads/${branch}`],
    {
      cwd: repo,
    }
  );
  if (tip.code !== 0) return false;
  if (sha(tip.stdout) !== sha(base)) return false;
  await git(exec, repo, ['branch', '-D', '--', branch]);
  return true;
}
