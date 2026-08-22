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
exports.writeIndex = writeIndex;
exports.upsertRecord = upsertRecord;
exports.findByIdempotencyKey = findByIdempotencyKey;
exports.findByAgentId = findByAgentId;
exports.isTerminalStatus = isTerminalStatus;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
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
async function upsertRecord(stateFilePath, record) {
    const { index } = await readIndex(stateFilePath);
    const next = { ...index, [record.idempotencyKey]: record };
    await writeIndex(stateFilePath, next);
    return next;
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
