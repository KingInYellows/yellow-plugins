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
exports.own = own;
exports.dropRequest = dropRequest;
exports.getTask = getTask;
exports.recentUsage = recentUsage;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
const grants_1 = require("./grants");
const EMPTY = { version: 1, tasks: {}, requests: {}, usage: [] };
const JOURNAL = 'journal.json';
const LOCK = 'journal.lock';
const USAGE_KEEP_MS = 24 * 60 * 60 * 1000;
/** The data dir: YELLOW_AGY_DATA_DIR, or the XDG state dir. */
function dataDir(env = process.env) {
    // An empty value counts as unset, as the XDG spec says.
    const set = (name) => {
        const v = env[name];
        return v === undefined || v === '' ? undefined : v;
    };
    const explicit = set('YELLOW_AGY_DATA_DIR');
    if (explicit !== undefined)
        return path.resolve(explicit);
    if (process.platform === 'win32') {
        const base = set('LOCALAPPDATA') ?? path.join(os.homedir(), 'AppData', 'Local');
        return path.join(base, 'yellow-agy');
    }
    const base = set('XDG_STATE_HOME') ?? path.join(os.homedir(), '.local', 'state');
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
    const token = `${process.pid}\n${new Date().toISOString()}\n${Math.random().toString(36).slice(2)}\n`;
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, 'wx', 0o600);
            fs.writeSync(fd, token);
            fs.closeSync(fd);
            break;
        }
        catch (err) {
            if (err.code !== 'EEXIST')
                throw err;
            if (removeStaleLock(lockPath, staleMs))
                continue;
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
        // Remove only our own lock: a peer may have taken over a lock it judged
        // stale. Best effort, so a failed delete never replaces fn's result or
        // error; a lock left behind names this pid and goes stale once it exits.
        try {
            if (readText(lockPath) === token)
                fs.rmSync(lockPath, { force: true });
        }
        catch {
            // ignored, see above
        }
    }
}
function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    }
    catch {
        return undefined;
    }
}
const TAKEOVER_STALE_MS = 5_000;
/**
 * Removes the lock at `lockPath` if it is stale, and says whether it did.
 * Removal happens only while holding `<lock>.takeover` (created with `wx`),
 * and only if the lock still holds the exact text judged stale, so two
 * waiters can't both remove it and one of them can't remove a fresh lock a
 * third process just took.
 */
function removeStaleLock(lockPath, staleMs) {
    const seen = readText(lockPath);
    if (seen === undefined) {
        // Gone: retry the create. Present but unreadable: wait for the timeout.
        try {
            fs.lstatSync(lockPath);
            return false;
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return true;
            throw err;
        }
    }
    if (!lockIsStale(lockPath, seen, staleMs))
        return false;
    const takeover = `${lockPath}.takeover`;
    let fd;
    try {
        fd = fs.openSync(takeover, 'wx', 0o600);
    }
    catch (err) {
        if (err.code !== 'EEXIST')
            throw err;
        // The takeover window is a few syscalls; one left by a crash expires.
        try {
            if (Date.now() - fs.statSync(takeover).mtimeMs > TAKEOVER_STALE_MS) {
                fs.rmSync(takeover, { force: true });
            }
        }
        catch {
            // gone already
        }
        return false;
    }
    fs.closeSync(fd);
    try {
        if (readText(lockPath) !== seen)
            return false;
        fs.rmSync(lockPath, { force: true });
        return true;
    }
    finally {
        fs.rmSync(takeover, { force: true });
    }
}
function lockIsStale(lockPath, text, staleMs) {
    let mtime;
    try {
        mtime = fs.statSync(lockPath).mtimeMs;
    }
    catch {
        return false; // vanished between read and stat: just retry
    }
    const pid = Number.parseInt(text.split('\n')[0] ?? '', 10);
    if (Number.isInteger(pid) && pid > 0)
        return !pidAlive(pid);
    return Date.now() - mtime > staleMs;
}
function isRecord(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function badJournal(part) {
    return new errors_1.AgyError('AGY_INTERNAL', `the journal has an unknown format (${part})`, 'Move the damaged journal aside; yellow-agy starts a new one.');
}
function readJournal(dir) {
    // The same owner-only check as the locked paths, so status and collect
    // never read a directory another user can write.
    ensureDataDir(dir);
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
    if (!isRecord(value))
        throw badJournal('not an object');
    const j = value;
    if (j.version !== 1)
        throw badJournal('unknown version');
    if (!isRecord(j.tasks) || !Object.values(j.tasks).every(isRecord)) {
        throw badJournal('tasks');
    }
    if (!isRecord(j.requests) || !Object.values(j.requests).every(isRecord)) {
        throw badJournal('requests');
    }
    if (j.usage !== undefined && !Array.isArray(j.usage)) {
        throw badJournal('usage');
    }
    if (j.grants !== undefined &&
        !(isRecord(j.grants) &&
            Object.entries(j.grants).every(([k, g]) => (0, grants_1.isGrant)(k, g)))) {
        throw badJournal('grants');
    }
    const claim = j.activeRun;
    if (claim !== undefined &&
        !(isRecord(claim) &&
            typeof claim['requestId'] === 'string' &&
            typeof claim['localId'] === 'string' &&
            typeof claim['op'] === 'string' &&
            Number.isInteger(claim['ownerPid']) &&
            (claim['childPid'] === undefined || Number.isInteger(claim['childPid'])))) {
        throw badJournal('activeRun');
    }
    return {
        version: 1,
        tasks: j.tasks,
        requests: j.requests,
        usage: (j.usage ?? []).filter(isRecord),
        ...(j.activeRun === undefined ? {} : { activeRun: j.activeRun }),
        ...(j.grants === undefined ? {} : { grants: j.grants }),
    };
}
/** Atomic, durable write: a 0600 temp file fsynced, renamed, dir fsynced. */
function writeJournal(dir, journal) {
    const cutoff = Date.now() - USAGE_KEEP_MS;
    const trimmed = {
        ...journal,
        usage: journal.usage.filter((u) => Date.parse(u.at) >= cutoff),
    };
    const tmp = path.join(dir, `${JOURNAL}.${process.pid}.tmp`);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
        fs.writeSync(fd, `${JSON.stringify(trimmed, null, 2)}\n`);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, path.join(dir, JOURNAL));
    // Make the rename itself durable; Windows can't open a directory.
    if (process.platform !== 'win32') {
        const dfd = fs.openSync(dir, 'r');
        try {
            fs.fsyncSync(dfd);
        }
        finally {
            fs.closeSync(dfd);
        }
    }
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
/** `rec[key]` only when it is an own property (`toString` is not a task). */
function own(rec, key) {
    return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}
/** The journal without request `requestId`. */
function dropRequest(j, requestId) {
    const { [requestId]: _gone, ...requests } = j.requests;
    void _gone;
    return { ...j, requests };
}
function getTask(j, localId) {
    const task = own(j.tasks, localId);
    if (task === undefined) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `no task ${JSON.stringify(localId)}`);
    }
    return task;
}
/** Usage entries from the last `windowMs`. */
function recentUsage(j, windowMs, now = Date.now()) {
    // A future-dated entry (clock skew) is not recent usage.
    return j.usage.filter((u) => {
        const age = now - Date.parse(u.at);
        return age >= 0 && age <= windowMs;
    });
}
