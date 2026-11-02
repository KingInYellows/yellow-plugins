"use strict";
/**
 * Git work on a delegate's worktree (contract-v0 "Run lifecycle" and
 * "Reservations, retries and recovery"): create it, snapshot it before each
 * turn, reset partial edits, and collect patches. Every git call goes through
 * HostExec, so on the WSL bridge it runs inside the distro with hooks off.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotRefs = snapshotRefs;
exports.validateBranchName = validateBranchName;
exports.createWorktree = createWorktree;
exports.snapshotWorktree = snapshotWorktree;
exports.ignoredCollisions = ignoredCollisions;
exports.resetToSnapshot = resetToSnapshot;
exports.dropSnapshotRefs = dropSnapshotRefs;
exports.collectWorktree = collectWorktree;
exports.removeWorktree = removeWorktree;
exports.deleteBranchIfEmpty = deleteBranchIfEmpty;
const node_crypto_1 = require("node:crypto");
const errors_1 = require("./errors");
const BRANCH_RE = /^(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const LOCAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
function snapshotRefs(localId) {
    checkLocalId(localId);
    return {
        preTurn: `refs/yellow-agy/${localId}/pre-turn`,
        preTurnIndex: `refs/yellow-agy/${localId}/pre-turn-index`,
    };
}
function checkLocalId(localId) {
    if (!LOCAL_ID_RE.test(localId)) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `invalid local id ${JSON.stringify(localId)}`);
    }
}
function validateBranchName(branch) {
    if (!BRANCH_RE.test(branch) ||
        branch.endsWith('/') ||
        branch.endsWith('.') ||
        branch.split('/').some((part) => part.endsWith('.lock')) ||
        branch.includes('/.')) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `invalid branch name ${JSON.stringify(branch)}`);
    }
    return branch;
}
async function git(exec, cwd, args, env) {
    const res = await exec.git(args, env === undefined ? { cwd } : { cwd, env });
    if (res.code !== 0)
        throw gitError(args, res);
    return res.stdout;
}
async function gitBytes(exec, cwd, args, env) {
    const res = await exec.git(args, env === undefined ? { cwd } : { cwd, env });
    if (res.code !== 0)
        throw gitError(args, res);
    return res.stdoutBytes;
}
function gitError(args, res) {
    const detail = res.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
    return new errors_1.AgyError('AGY_WORKTREE', `git ${args.slice(0, 2).join(' ')} failed: ${detail || `exit ${res.code}`}`);
}
function sha(out) {
    const value = out.trim();
    if (!SHA_RE.test(value)) {
        throw new errors_1.AgyError('AGY_INTERNAL', `git printed no object id: ${value}`);
    }
    return value;
}
/** Fetches the base and adds a worktree on a new branch; returns the base commit. */
async function createWorktree(exec, options) {
    validateBranchName(options.branch);
    validateBranchName(options.baseBranch);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.remote)) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `invalid remote ${JSON.stringify(options.remote)}`);
    }
    const exists = await exec.git(['show-ref', '--verify', '--quiet', `refs/heads/${options.branch}`], { cwd: options.repo });
    if (exists.code === 0) {
        throw new errors_1.AgyError('AGY_WORKTREE', `branch ${options.branch} already exists; delegate needs a new branch`);
    }
    // A private ref, not the shared FETCH_HEAD, which another fetch in the
    // same repo could overwrite between the fetch and the rev-parse. It is kept
    // until `worktree add` has made the commit reachable, so a concurrent gc
    // can't prune it. Only one run holds the claim, so any older fetch ref is a
    // leftover from a failed cleanup and is swept first.
    await dropFetchRefs(exec, options.repo);
    const fetched = `${FETCH_REF_PREFIX}${(0, node_crypto_1.randomBytes)(8).toString('hex')}`;
    let base;
    try {
        await git(exec, options.repo, [
            'fetch',
            '--no-tags',
            '--',
            options.remote,
            `+refs/heads/${options.baseBranch}:${fetched}`,
        ]);
        base = sha(await git(exec, options.repo, [
            'rev-parse',
            '--verify',
            `${fetched}^{commit}`,
        ]));
        // Create the branch atomically (`create` fails if the ref exists), so a
        // failed `worktree add` below only ever rolls back a branch this call made.
        const created = await exec.git(['update-ref', '--stdin'], {
            cwd: options.repo,
            stdin: `create refs/heads/${options.branch} ${base}\n`,
        });
        if (created.code !== 0) {
            throw new errors_1.AgyError('AGY_WORKTREE', `branch ${options.branch} already exists; delegate needs a new branch`);
        }
        try {
            await git(exec, options.repo, [
                'worktree',
                'add',
                '--',
                options.worktree,
                options.branch,
            ]);
        }
        catch (err) {
            // Without the rollback, the branch would block every retry with no
            // task left to abandon.
            await dropUnusedBranch(exec, options.repo, options.branch, base);
            throw err;
        }
    }
    finally {
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
async function dropUnusedBranch(exec, repo, branch, base) {
    const ref = `refs/heads/${branch}`;
    const list = await exec
        .git(['worktree', 'list', '--porcelain'], { cwd: repo })
        .catch(() => undefined);
    if (list === undefined || list.code !== 0)
        return;
    if (list.stdout.split('\n').some((l) => l === `branch ${ref}`))
        return;
    await exec
        .git(['update-ref', '-d', ref, base], { cwd: repo })
        .catch(() => undefined);
}
/** Deletes every leftover private fetch ref in `repo`, best effort. */
async function dropFetchRefs(exec, repo) {
    const res = await exec
        .git(['for-each-ref', '--format=%(refname)', FETCH_REF_PREFIX], {
        cwd: repo,
    })
        .catch(() => undefined);
    if (res === undefined || res.code !== 0)
        return;
    for (const ref of res.stdout.split('\n').filter((r) => r !== '')) {
        await exec
            .git(['update-ref', '-d', ref], { cwd: repo })
            .catch(() => undefined);
    }
}
/** The temporary index path for `localId`, inside the worktree's git dir. */
async function tempIndexPath(exec, worktree, localId, purpose) {
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
async function snapshotWorktree(exec, worktree, localId) {
    const refs = snapshotRefs(localId);
    const head = sha(await git(exec, worktree, ['rev-parse', '--verify', 'HEAD']));
    const indexTree = sha(await git(exec, worktree, ['write-tree']));
    const indexFile = await tempIndexPath(exec, worktree, localId, 'snapshot');
    const env = { GIT_INDEX_FILE: indexFile };
    try {
        await git(exec, worktree, ['read-tree', indexTree], env);
        await git(exec, worktree, ['add', '--all'], env);
        const tree = sha(await git(exec, worktree, ['write-tree'], env));
        const commit = sha(await git(exec, worktree, [
            'commit-tree',
            tree,
            '-p',
            head,
            '-m',
            `yellow-agy pre-turn ${localId}`,
        ], {
            ...env,
            GIT_AUTHOR_NAME: 'yellow-agy',
            GIT_AUTHOR_EMAIL: 'yellow-agy@localhost',
            GIT_COMMITTER_NAME: 'yellow-agy',
            GIT_COMMITTER_EMAIL: 'yellow-agy@localhost',
        }));
        await git(exec, worktree, ['update-ref', refs.preTurn, commit]);
        await git(exec, worktree, ['update-ref', refs.preTurnIndex, indexTree]);
        return { head, tree, indexTree, commit };
    }
    finally {
        await exec.removeFile(indexFile);
    }
}
function nulList(out) {
    return out.split('\0').filter((p) => p !== '');
}
/** Ignored untracked paths that a reset to the snapshot could delete. */
async function ignoredCollisions(exec, worktree, snapshot) {
    const ignored = nulList(await git(exec, worktree, [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '-z',
    ]));
    if (ignored.length === 0)
        return [];
    const tracked = new Set();
    for (const rev of [snapshot.head, snapshot.commit]) {
        for (const p of nulList(await git(exec, worktree, ['ls-tree', '-r', '--name-only', '-z', rev]))) {
            tracked.add(p);
        }
    }
    const hits = new Set();
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
async function resetToSnapshot(exec, worktree, localId, snapshot) {
    const collisions = await ignoredCollisions(exec, worktree, snapshot);
    if (collisions.length > 0) {
        throw new errors_1.AgyError('AGY_WORKTREE', `ignored files would be overwritten by the reset: ${collisions.slice(0, 10).join(', ')}`, 'Move the named ignored files out of the worktree, then retry --reset-partial.');
    }
    await git(exec, worktree, ['reset', '--hard', snapshot.head]);
    await git(exec, worktree, ['clean', '-fd']);
    await git(exec, worktree, ['read-tree', '--reset', '-u', snapshot.commit]);
    await git(exec, worktree, ['read-tree', snapshot.indexTree]);
    await dropSnapshotRefs(exec, worktree, localId);
}
async function dropSnapshotRefs(exec, worktree, localId) {
    const refs = snapshotRefs(localId);
    for (const ref of [refs.preTurn, refs.preTurnIndex]) {
        // A missing ref is fine (the turn may have settled already); any other
        // failure must surface, or a reset reports success with refs left over.
        const present = await exec.git(['show-ref', '--verify', '--quiet', '--', ref], { cwd: worktree });
        if (present.code === 1)
            continue;
        if (present.code !== 0)
            throw gitError(['show-ref', ref], present);
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
];
/** Reads the delegate's work without touching the real index. */
async function collectWorktree(exec, worktree, localId, base) {
    checkLocalId(localId);
    sha(base);
    const count = Number.parseInt((await git(exec, worktree, ['rev-list', '--count', `${base}..HEAD`])).trim(), 10);
    // The repo's external diff and textconv helpers would run outside agy's
    // sandbox and replace the patch with their output, so both are off. Color
    // and custom prefixes from the user's config would make the patch unusable
    // by `git apply`, so the plain format is forced.
    const commits = count > 0
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
        const uncommitted = await gitBytes(exec, worktree, ['diff', ...PATCH_FORMAT, 'HEAD'], env);
        return { commits, uncommitted, commitCount: count };
    }
    finally {
        await exec.removeFile(indexFile);
    }
}
/** Removes the worktree and keeps the branch. */
async function removeWorktree(exec, repo, worktree) {
    await git(exec, repo, ['worktree', 'remove', '--force', '--', worktree]);
}
/** Deletes `branch` only when it has no commits beyond `base`. */
async function deleteBranchIfEmpty(exec, repo, branch, base) {
    validateBranchName(branch);
    const tip = await exec.git(['rev-parse', '--verify', `refs/heads/${branch}`], {
        cwd: repo,
    });
    if (tip.code !== 0)
        return false;
    if (sha(tip.stdout) !== sha(base))
        return false;
    await git(exec, repo, ['branch', '-D', '--', branch]);
    return true;
}
