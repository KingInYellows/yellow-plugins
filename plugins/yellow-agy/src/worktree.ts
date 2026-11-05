/**
 * Git work on a delegate's worktree (contract-v0 "Run lifecycle" and
 * "Reservations, retries and recovery"): create it, snapshot it before each
 * turn, reset partial edits, and collect patches. Every git call goes through
 * HostExec, so on the WSL bridge it runs inside the distro with hooks off.
 */

import { randomBytes } from 'node:crypto';

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

async function runGit(
  exec: HostExec,
  cwd: string,
  args: readonly string[],
  stdin: string,
  env?: Readonly<Record<string, string>>
): Promise<string> {
  const res = await exec.git(
    args,
    env === undefined ? { cwd, stdin } : { cwd, env, stdin }
  );
  if (res.code !== 0) throw gitError(args, res);
  return res.stdout;
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
  // A private ref, not the shared FETCH_HEAD, which another fetch in the
  // same repo could overwrite between the fetch and the rev-parse. It is kept
  // until `worktree add` has made the commit reachable, so a concurrent gc
  // can't prune it. Only one run holds the claim, so any older fetch ref is a
  // leftover from a failed cleanup and is swept first.
  await dropFetchRefs(exec, options.repo);
  const fetched = `${FETCH_REF_PREFIX}${randomBytes(8).toString('hex')}`;
  let base: string;
  try {
    await git(exec, options.repo, [
      'fetch',
      '--no-tags',
      '--',
      options.remote,
      `+refs/heads/${options.baseBranch}:${fetched}`,
    ]);
    base = sha(
      await git(exec, options.repo, [
        'rev-parse',
        '--verify',
        `${fetched}^{commit}`,
      ])
    );
    // Create the branch atomically (`create` fails if the ref exists), so a
    // failed `worktree add` below only ever rolls back a branch this call made.
    const created = await exec.git(['update-ref', '--stdin'], {
      cwd: options.repo,
      stdin: `create refs/heads/${options.branch} ${base}\n`,
    });
    if (created.code !== 0) {
      throw new AgyError(
        'AGY_WORKTREE',
        `branch ${options.branch} already exists; delegate needs a new branch`
      );
    }
    try {
      await git(exec, options.repo, [
        'worktree',
        'add',
        '--',
        options.worktree,
        options.branch,
      ]);
    } catch (err) {
      // Without the rollback, the branch would block every retry with no
      // task left to abandon. The turn will not run, so its reserved time
      // goes to the rollback.
      exec.releaseTurnReserve?.();
      await dropUnusedBranch(exec, options.repo, options.branch, base);
      throw err;
    }
  } finally {
    // A failure here only pins objects until the next creation sweeps it;
    // it must not fail a worktree that now exists.
    await exec
      .git(['update-ref', '-d', fetched], { cwd: options.repo })
      .catch(() => undefined);
  }
  return base;
}

const FETCH_REF_PREFIX = 'refs/yellow-agy/fetch/';

/**
 * Deletes `branch`, which this run just created, after a failed
 * `worktree add`; best effort, and only while no worktree has it checked out
 * and it still points at `base`.
 */
async function dropUnusedBranch(
  exec: HostExec,
  repo: string,
  branch: string,
  base: string
): Promise<void> {
  const ref = `refs/heads/${branch}`;
  const list = await exec
    .git(['worktree', 'list', '--porcelain'], { cwd: repo })
    .catch(() => undefined);
  if (list === undefined || list.code !== 0) return;
  if (list.stdout.split('\n').some((l) => l === `branch ${ref}`)) return;
  await exec
    .git(['update-ref', '-d', ref, base], { cwd: repo })
    .catch(() => undefined);
}

/** Deletes every leftover private fetch ref in `repo`, best effort. */
async function dropFetchRefs(exec: HostExec, repo: string): Promise<void> {
  const res = await exec
    .git(['for-each-ref', '--format=%(refname)', FETCH_REF_PREFIX], {
      cwd: repo,
    })
    .catch(() => undefined);
  if (res === undefined || res.code !== 0) return;
  for (const ref of res.stdout.split('\n').filter((r) => r !== '')) {
    await exec
      .git(['update-ref', '-d', ref], { cwd: repo })
      .catch(() => undefined);
  }
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
  return collisionsWith(
    exec,
    worktree,
    snapshot,
    await ignoredPaths(exec, worktree)
  );
}

/**
 * Untracked ignored paths under the worktree's current rules. With `collapse`,
 * a wholly ignored dir is one entry ending in `/`; without it, every file.
 */
async function ignoredPaths(
  exec: HostExec,
  worktree: string,
  collapse = true
): Promise<string[]> {
  const raw = await gitBytes(exec, worktree, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    ...(collapse ? ['--directory'] : []),
    '-z',
  ]);
  const paths: string[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== 0) continue;
    if (i > start) {
      const bytes = raw.subarray(start, i);
      const text = bytes.toString('utf8');
      // A name that is not valid UTF-8 would come back as a different path,
      // and an entry for that path would not protect the real file.
      if (!Buffer.from(text, 'utf8').equals(bytes)) {
        throw new AgyError(
          'AGY_WORKTREE',
          `an ignored path is not valid UTF-8: ${JSON.stringify(text)}`,
          'Move or rename that file, then retry --reset-partial.'
        );
      }
      paths.push(text);
    }
    start = i + 1;
  }
  return paths;
}

async function collisionsWith(
  exec: HostExec,
  worktree: string,
  snapshot: Pick<Snapshot, 'head' | 'commit'>,
  ignored: readonly string[]
): Promise<string[]> {
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
  // Read once, under the rules in force now: the reset below swaps in other
  // .gitignore files, which could make these paths look like delegate files.
  const ignored = await ignoredPaths(exec, worktree);
  const collisions = await collisionsWith(exec, worktree, snapshot, ignored);
  if (collisions.length > 0) {
    throw new AgyError(
      'AGY_WORKTREE',
      `ignored files would be overwritten by the reset: ${collisions.slice(0, 10).join(', ')}`,
      'Move the named ignored files out of the worktree, then retry --reset-partial.'
    );
  }
  // Every ignored file, listed now, is protected through the clean below by
  // putting it in a scratch index: clean never touches an indexed path,
  // whatever the restored .gitignore files say (negations included).
  const keep = await ignoredPaths(exec, worktree, false);
  await git(exec, worktree, ['reset', '--hard', snapshot.head]);
  await git(exec, worktree, ['read-tree', '--reset', '-u', snapshot.commit]);
  const scratch = await tempIndexPath(exec, worktree, localId, 'clean');
  const env = { GIT_INDEX_FILE: scratch };
  try {
    await git(exec, worktree, ['read-tree', snapshot.commit], env);
    if (keep.length > 0) {
      const empty = sha(
        await runGit(exec, worktree, ['hash-object', '-w', '--stdin'], '')
      );
      await runGit(
        exec,
        worktree,
        ['update-index', '-z', '--index-info'],
        keep.map((p) => `100644 ${empty}\t${p}\0`).join(''),
        env
      );
    }
    // Clean against the snapshot's tree and ignore rules.
    await git(exec, worktree, ['clean', '-fd'], env);
  } finally {
    await exec.removeFile(scratch);
  }
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
    // A nested repository shows up only as a gitlink: its files reach
    // neither patch, so removing the worktree would destroy them.
    const nested = await newGitlinks(exec, worktree, env);
    if (nested.length > 0) {
      throw new AgyError(
        'AGY_WORKTREE',
        `the worktree holds nested git repositories that can't be collected: ${nested.slice(0, 10).join(', ')}`,
        'Move or commit their contents elsewhere, then retry.'
      );
    }
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

/** Gitlink paths in the index at `env` that HEAD does not already have. */
async function newGitlinks(
  exec: HostExec,
  worktree: string,
  env: Readonly<Record<string, string>>
): Promise<string[]> {
  const gitlinks = (
    entries: string[],
    pathAt: (e: string) => string
  ): string[] => entries.filter((e) => e.startsWith('160000 ')).map(pathAt);
  const tab = (e: string): string => e.slice(e.indexOf('\t') + 1);
  const known = new Set(
    gitlinks(
      nulList(await git(exec, worktree, ['ls-tree', '-r', '-z', 'HEAD'])),
      tab
    )
  );
  return gitlinks(
    nulList(await git(exec, worktree, ['ls-files', '-s', '-z'], env)),
    tab
  ).filter((p) => !known.has(p));
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
