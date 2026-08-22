"use strict";
/**
 * Local agent index at <dataDir>/state/agents.json. Atomic same-dir
 * tmp+rename writes, 0600/0700 modes, symlink rejection, and corrupt-file
 * quarantine so a damaged local cache degrades to "reconcile from remote"
 * instead of crashing or silently overwriting something hostile.
 *
 * Keyed by idempotencyKey, not agentId: a delegate reservation is written
 * BEFORE Agent.create() resolves, i.e. before an agentId exists at all.
 * agentId is filled in once the create+send round-trip completes.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_ONLY_STATUSES = exports.TERMINAL_AGENT_STATUSES = exports.TERMINAL_RUN_STATUSES = void 0;
exports.digestPrompt = digestPrompt;
exports.readIndex = readIndex;
exports.throwIfQuarantined = throwIfQuarantined;
exports.writeIndex = writeIndex;
exports.withStateLock = withStateLock;
exports.upsertRecordUnderLock = upsertRecordUnderLock;
exports.upsertRecord = upsertRecord;
exports.findByIdempotencyKey = findByIdempotencyKey;
exports.findByAgentId = findByAgentId;
exports.isTerminalStatus = isTerminalStatus;
exports.countLocalActiveForRepo = countLocalActiveForRepo;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
function digestPrompt(prompt) {
    return crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
}
async function assertNotSymlink(target) {
    let stat;
    try {
        stat = await fs.promises.lstat(target);
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return;
        throw err;
    }
    if (stat.isSymbolicLink()) {
        throw new Error(`refusing to follow symlink at ${target}`);
    }
}
async function ensureStateDir(stateDir) {
    await assertNotSymlink(stateDir);
    await fs.promises.mkdir(stateDir, { recursive: true, mode: 0o700 });
    await assertNotSymlink(stateDir);
    await fs.promises.chmod(stateDir, 0o700);
}
async function quarantine(filePath) {
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    await fs.promises.rename(filePath, quarantinePath);
    return quarantinePath;
}
function isValidIndexShape(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    for (const [key, record] of Object.entries(value)) {
        if (record === null || typeof record !== 'object')
            return false;
        const r = record;
        if (r['agentId'] !== undefined && typeof r['agentId'] !== 'string')
            return false;
        if (typeof r['repository'] !== 'string')
            return false;
        if (typeof r['status'] !== 'string')
            return false;
        if (typeof r['createdAt'] !== 'string')
            return false;
        if (typeof r['updatedAt'] !== 'string')
            return false;
        if (typeof r['idempotencyKey'] !== 'string' || r['idempotencyKey'] !== key)
            return false;
    }
    return true;
}
async function readIndex(stateFilePath) {
    const stateDir = path.dirname(stateFilePath);
    await ensureStateDir(stateDir);
    await assertNotSymlink(stateFilePath);
    let raw;
    try {
        raw = await fs.promises.readFile(stateFilePath, 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return { index: {}, quarantined: false };
        }
        throw err;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        const quarantinePath = await quarantine(stateFilePath);
        return { index: {}, quarantined: true, quarantinePath };
    }
    if (!isValidIndexShape(parsed)) {
        const quarantinePath = await quarantine(stateFilePath);
        return { index: {}, quarantined: true, quarantinePath };
    }
    return { index: parsed, quarantined: false };
}
function throwIfQuarantined(result) {
    if (!result.quarantined)
        return;
    const detail = result.quarantinePath !== undefined
        ? `local state was quarantined to ${result.quarantinePath}`
        : 'local state was quarantined';
    (0, errors_js_1.throwAppError)('CURSOR_STATE_CORRUPT', detail);
}
async function writeIndex(stateFilePath, index) {
    (0, redact_js_1.assertNoSecretShapedValues)(index);
    const stateDir = path.dirname(stateFilePath);
    await ensureStateDir(stateDir);
    await assertNotSymlink(stateFilePath);
    const tmpPath = path.join(stateDir, `.agents.json.tmp-${process.pid}-${crypto.randomUUID()}`);
    const data = JSON.stringify(index, null, 2);
    await fs.promises.writeFile(tmpPath, data, { mode: 0o600 });
    await fs.promises.chmod(tmpPath, 0o600);
    await fs.promises.rename(tmpPath, stateFilePath);
    await fs.promises.chmod(stateFilePath, 0o600);
}
function lockFilePath(stateDir) {
    return path.join(stateDir, '.agents.json.lock');
}
const DEFAULT_LOCK_CONFIG = {
    staleMs: 10_000,
    timeoutMs: 15_000,
    pollMs: 50,
};
/**
 * `wx` (O_CREAT|O_EXCL) atomically fails if anything — including a symlink —
 * already occupies the path, so this is safe against symlink races without a
 * separate lstat check. The lock file's content is a random owner token so
 * release() only ever deletes a lock it still owns, never one a stale-lock
 * takeover has since replaced.
 */
async function acquireLock(stateDir, config) {
    const lockPath = lockFilePath(stateDir);
    const owner = crypto.randomUUID();
    const deadline = Date.now() + config.timeoutMs;
    for (;;) {
        try {
            const handle = await fs.promises.open(lockPath, 'wx');
            try {
                await handle.writeFile(owner);
            }
            finally {
                await handle.close();
            }
            return owner;
        }
        catch (err) {
            if (err.code !== 'EEXIST')
                throw err;
        }
        try {
            const stat = await fs.promises.stat(lockPath);
            if (Date.now() - stat.mtimeMs > config.staleMs) {
                await fs.promises.unlink(lockPath).catch((unlinkErr) => {
                    if (unlinkErr.code !== 'ENOENT') {
                        throw unlinkErr;
                    }
                });
                continue; // retry acquisition immediately after a stale-lock takeover
            }
        }
        catch (statErr) {
            if (statErr.code !== 'ENOENT')
                throw statErr;
            continue; // lock disappeared between our EEXIST and this stat — retry immediately
        }
        if (Date.now() > deadline) {
            throw new Error(`timed out acquiring state lock at ${lockPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, config.pollMs));
    }
}
async function releaseLock(stateDir, owner) {
    const lockPath = lockFilePath(stateDir);
    try {
        const content = await fs.promises.readFile(lockPath, 'utf8');
        if (content === owner) {
            await fs.promises.unlink(lockPath);
        }
        // A different owner means a stale-lock takeover already replaced ours —
        // nothing to release, and deleting it would clobber the new owner.
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
}
/**
 * Serializes a read-modify-write cycle against the state file across
 * processes on the same machine/dataDir. tmp+rename alone only makes a
 * single write atomic — without this, two concurrent read-modify-write
 * cycles can both read the same starting index and the second write
 * silently drops the first writer's update (lost-update race).
 */
async function withStateLock(stateFilePath, fn, config = DEFAULT_LOCK_CONFIG) {
    const stateDir = path.dirname(stateFilePath);
    await ensureStateDir(stateDir);
    const owner = await acquireLock(stateDir, config);
    try {
        return await fn();
    }
    finally {
        await releaseLock(stateDir, owner);
    }
}
/**
 * Read-modify-write without acquiring the lock — caller must already hold it
 * via `withStateLock`.
 */
async function upsertRecordUnderLock(stateFilePath, record) {
    const readResult = await readIndex(stateFilePath);
    throwIfQuarantined(readResult);
    const next = {
        ...readResult.index,
        [record.idempotencyKey]: record,
    };
    await writeIndex(stateFilePath, next);
    return next;
}
async function upsertRecord(stateFilePath, record) {
    return withStateLock(stateFilePath, async () => upsertRecordUnderLock(stateFilePath, record));
}
function findByIdempotencyKey(index, idempotencyKey) {
    return index[idempotencyKey];
}
function findByAgentId(index, agentId) {
    return Object.values(index).find((record) => record.agentId === agentId);
}
exports.TERMINAL_RUN_STATUSES = new Set([
    'finished',
    'error',
    'cancelled',
]);
exports.TERMINAL_AGENT_STATUSES = new Set([
    'finished',
    'error',
    'cancelled',
    'archived',
]);
/** Local-only bookkeeping statuses that are neither a live SDK status nor terminal. */
exports.LOCAL_ONLY_STATUSES = new Set(['pending-launch', 'unknown']);
function isTerminalStatus(status) {
    return exports.TERMINAL_AGENT_STATUSES.has(status);
}
/** Non-terminal local records that occupy a concurrency slot for a repository. */
function countLocalActiveForRepo(index, repoUrl) {
    return Object.values(index).filter((record) => record.repository === repoUrl &&
        !isTerminalStatus(record.status) &&
        record.status !== 'unknown').length;
}
