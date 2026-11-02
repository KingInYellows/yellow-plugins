"use strict";
/**
 * The local journal (contract-v0 "Reservations, retries and recovery"): one
 * JSON file in an owner-only data dir, changed only under an exclusive lock
 * file and written atomically. It holds the tasks, every request id's
 * outcome, the single active-run claim and the usage log the quota gate reads.
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
exports.dataDir = dataDir;
exports.ensureDataDir = ensureDataDir;
exports.isPidAlive = isPidAlive;
exports.withLock = withLock;
exports.readJournal = readJournal;
exports.writeJournal = writeJournal;
exports.updateJournal = updateJournal;
exports.nowIso = nowIso;
exports.putTask = putTask;
exports.putRequest = putRequest;
exports.withoutClaim = withoutClaim;
exports.getTask = getTask;
exports.recentUsage = recentUsage;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
const EMPTY = { version: 1, tasks: {}, requests: {}, usage: [] };
const JOURNAL = 'journal.json';
const LOCK = 'journal.lock';
const USAGE_KEEP_MS = 24 * 60 * 60 * 1000;
/** The data dir: YELLOW_AGY_DATA_DIR, or the XDG state dir. */
function dataDir(env = process.env) {
    const explicit = env['YELLOW_AGY_DATA_DIR'];
    if (explicit !== undefined && explicit !== '')
        return path.resolve(explicit);
    if (process.platform === 'win32') {
        const base = env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
        return path.join(base, 'yellow-agy');
    }
    const base = env['XDG_STATE_HOME'] ?? path.join(os.homedir(), '.local', 'state');
    return path.join(base, 'yellow-agy');
}
/** Creates `dir` 0700 and refuses one another user owns or can write. */
function ensureDataDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32')
        return;
    const st = fs.lstatSync(dir);
    const uid = process.getuid?.();
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) {
        throw new errors_1.AgyError('AGY_INTERNAL', `${dir} is not a directory owned by this user`, 'Point YELLOW_AGY_DATA_DIR at a directory you own.');
    }
    if ((st.mode & 0o077) !== 0)
        fs.chmodSync(dir, 0o700);
}
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        return err.code === 'EPERM';
    }
}
function isPidAlive(pid) {
    return pid !== undefined && Number.isInteger(pid) && pid > 0 && pidAlive(pid);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/** Runs `fn` while holding the journal lock. */
async function withLock(dir, fn, options = {}) {
    ensureDataDir(dir);
    const lockPath = path.join(dir, LOCK);
    const timeoutMs = options.timeoutMs ?? 10_000;
    const staleMs = options.staleMs ?? 60_000;
    const started = Date.now();
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, 'wx', 0o600);
            fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
            fs.closeSync(fd);
            break;
        }
        catch (err) {
            if (err.code !== 'EEXIST')
                throw err;
            if (lockIsStale(lockPath, staleMs)) {
                fs.rmSync(lockPath, { force: true });
                continue;
            }
            if (Date.now() - started > timeoutMs) {
                throw new errors_1.AgyError('AGY_BUSY', 'another yellow-agy command holds the journal lock');
            }
            await sleep(50);
        }
    }
    try {
        return await fn();
    }
    finally {
        fs.rmSync(lockPath, { force: true });
    }
}
function lockIsStale(lockPath, staleMs) {
    let text;
    let mtime;
    try {
        text = fs.readFileSync(lockPath, 'utf8');
        mtime = fs.statSync(lockPath).mtimeMs;
    }
    catch {
        return false; // vanished between open and read: just retry
    }
    const pid = Number.parseInt(text.split('\n')[0] ?? '', 10);
    if (Number.isInteger(pid) && pid > 0)
        return !pidAlive(pid);
    return Date.now() - mtime > staleMs;
}
function readJournal(dir) {
    let text;
    try {
        text = fs.readFileSync(path.join(dir, JOURNAL), 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return EMPTY;
        throw err;
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new errors_1.AgyError('AGY_INTERNAL', `${path.join(dir, JOURNAL)} is not valid JSON`, 'Move the damaged journal aside; yellow-agy starts a new one.');
    }
    const j = value;
    if (j.version !== 1 ||
        typeof j.tasks !== 'object' ||
        typeof j.requests !== 'object') {
        throw new errors_1.AgyError('AGY_INTERNAL', 'the journal has an unknown format');
    }
    return {
        version: 1,
        tasks: j.tasks ?? {},
        requests: j.requests ?? {},
        usage: Array.isArray(j.usage) ? j.usage : [],
        ...(j.activeRun === undefined ? {} : { activeRun: j.activeRun }),
    };
}
/** Atomic write: a 0600 temp file in the same dir, then rename. */
function writeJournal(dir, journal) {
    const cutoff = Date.now() - USAGE_KEEP_MS;
    const trimmed = {
        ...journal,
        usage: journal.usage.filter((u) => Date.parse(u.at) >= cutoff),
    };
    const tmp = path.join(dir, `${JOURNAL}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(trimmed, null, 2)}\n`, {
        mode: 0o600,
    });
    fs.renameSync(tmp, path.join(dir, JOURNAL));
}
/** Read, change and write the journal under the lock. */
function updateJournal(dir, fn, options) {
    return withLock(dir, async () => {
        const { journal, result } = await fn(readJournal(dir));
        writeJournal(dir, journal);
        return result;
    }, options);
}
function nowIso() {
    return new Date().toISOString();
}
function putTask(j, task) {
    return { ...j, tasks: { ...j.tasks, [task.localId]: task } };
}
function putRequest(j, rec) {
    return { ...j, requests: { ...j.requests, [rec.requestId]: rec } };
}
function withoutClaim(j) {
    const { activeRun: _drop, ...rest } = j;
    void _drop;
    return rest;
}
function getTask(j, localId) {
    const task = j.tasks[localId];
    if (task === undefined) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `no task ${JSON.stringify(localId)}`);
    }
    return task;
}
/** Usage entries from the last `windowMs`. */
function recentUsage(j, windowMs, now = Date.now()) {
    return j.usage.filter((u) => now - Date.parse(u.at) <= windowMs);
}
