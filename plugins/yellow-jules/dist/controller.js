"use strict";
/**
 * R38 single-controller authority. A small file OUTSIDE `<dataDir>` records
 * which data directory (by canonical path) and which epoch may write on this
 * host. Every grant carries an `epochRef` to it, and every write re-reads and
 * matches it, so a copied or restored data directory — different path, or an
 * epoch that was since advanced — fails loud instead of writing in parallel.
 *
 * Nothing here reads `process.env`: callers inject the controller directory and
 * id. Errors are never swallowed; a missing, unreadable, corrupt, or unsafe
 * authority file is `JULES_CONTROLLER_MISMATCH` (fail closed).
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
exports.controllerFilePath = controllerFilePath;
exports.readControllerAuthority = readControllerAuthority;
exports.initControllerAuthority = initControllerAuthority;
exports.assertControllerAuthority = assertControllerAuthority;
exports.takeOverController = takeOverController;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const config_js_1 = require("./config.js");
const errors_js_1 = require("./errors.js");
const shape_js_1 = require("./shape.js");
const validate_js_1 = require("./validate.js");
function nowIso(ctx) {
    return (ctx.now ?? (() => new Date()))().toISOString();
}
function controllerFilePath(controllerDir, controllerId) {
    (0, validate_js_1.validateControllerId)(controllerId);
    return path.join(controllerDir, `${controllerId}.json`);
}
function mismatch(message) {
    return (0, errors_js_1.throwAppError)('JULES_CONTROLLER_MISMATCH', message);
}
function currentUid() {
    return typeof process.getuid === 'function' ? process.getuid() : undefined;
}
/**
 * The authority file must be a regular, owner-owned file with no group or
 * world bits: it is the copy-detection anchor, so a file anyone else could
 * have written is not trusted.
 */
function assertAuthorityFileSafe(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        mismatch(`${file} is not a regular file`);
    }
    const uid = currentUid();
    if (uid !== undefined && stat.uid !== uid) {
        mismatch(`${file} is not owned by the current user`);
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
        mismatch(`${file} must be mode 0600 (found ${(stat.mode & 0o777).toString(8)})`);
    }
}
function parseAuthority(raw, file, controllerId) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return mismatch(`${file} does not parse as JSON`);
    }
    if (!(0, shape_js_1.isPlainObject)(parsed))
        return mismatch(`${file} has an unexpected shape`);
    const { epoch, dataDir, updatedAt } = parsed;
    if (parsed['controllerId'] !== controllerId ||
        typeof epoch !== 'number' ||
        !Number.isInteger(epoch) ||
        epoch < 1 ||
        typeof dataDir !== 'string' ||
        !path.isAbsolute(dataDir) ||
        typeof updatedAt !== 'string') {
        return mismatch(`${file} has an unexpected shape`);
    }
    return { controllerId, epoch, dataDir, updatedAt };
}
/**
 * Reads and shape-validates `<controllerDir>/<controllerId>.json`.
 * `undefined` means the file does not exist; every other problem throws.
 */
function readControllerAuthority(controllerDir, controllerId) {
    const file = controllerFilePath(controllerDir, controllerId);
    try {
        assertAuthorityFileSafe(file);
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return undefined;
        throw err;
    }
    return parseAuthority(fs.readFileSync(file, 'utf8'), file, controllerId);
}
function writeAuthority(ctx, authority) {
    const file = controllerFilePath(ctx.controllerDir, ctx.controllerId);
    (0, config_js_1.ensureOwnerOnlyDir)(ctx.controllerDir);
    (0, config_js_1.writeFileAtomicOwnerOnly)(file, `${JSON.stringify(authority, null, 2)}\n`);
}
/**
 * First `authorize` on this host: no controller file and no grants exist yet.
 * Writes epoch 1 bound to the canonical data directory. Refuses to overwrite.
 */
function initControllerAuthority(ctx, dataDir) {
    if (readControllerAuthority(ctx.controllerDir, ctx.controllerId) !== undefined) {
        return mismatch(`a controller authority for ${ctx.controllerId} already exists; use authorize --take-over to move it`);
    }
    const authority = {
        controllerId: ctx.controllerId,
        epoch: 1,
        dataDir: (0, config_js_1.canonicalPath)(dataDir),
        updatedAt: nowIso(ctx),
    };
    writeAuthority(ctx, authority);
    return authority;
}
/**
 * Called on every write path inside the critical section. Fails with
 * `JULES_CONTROLLER_MISMATCH` when the file is missing, the epoch differs from
 * the grant's reference, or the canonical data-directory path differs.
 */
function assertControllerAuthority(controllerDir, dataDir, epochRef, hostControllerId) {
    // A home directory copied or mounted onto another host carries the first
    // host's authority file at the same path; only this host's id tells them apart.
    if (hostControllerId !== undefined &&
        hostControllerId !== epochRef.controllerId) {
        return mismatch(`the grant belongs to controller ${epochRef.controllerId}, not this host (${hostControllerId})`);
    }
    const authority = readControllerAuthority(controllerDir, epochRef.controllerId);
    if (authority === undefined) {
        return mismatch(`no controller authority for ${epochRef.controllerId} on this host`);
    }
    if (authority.epoch !== epochRef.epoch) {
        return mismatch(`controller epoch ${authority.epoch} does not match the grant's epoch ${epochRef.epoch}`);
    }
    if (authority.dataDir !== (0, config_js_1.canonicalPath)(dataDir)) {
        return mismatch('this data directory is not the one the controller authority authorizes');
    }
    return authority;
}
/**
 * Handoff (R38): writes epoch+1 for this host and data-directory path, then
 * rewrites every grant's `controllerId` and `epochRef` to it. The new epoch is
 * above both any existing authority file and every epoch the copied grants
 * still reference. The controller file is written first: a crash before the
 * grants are rewritten leaves grants pointing at an old epoch, so writes fail
 * closed until `--take-over` is run again. Runs only inside a TTY-confirmed
 * `authorize --take-over`, under the journal lock.
 */
function takeOverController(ctx, dataDir, grants) {
    const existing = readControllerAuthority(ctx.controllerDir, ctx.controllerId);
    let highest = existing?.epoch ?? 0;
    for (const grant of Object.values(grants.grants)) {
        highest = Math.max(highest, grant.epochRef.epoch);
    }
    const authority = {
        controllerId: ctx.controllerId,
        epoch: highest + 1,
        dataDir: (0, config_js_1.canonicalPath)(dataDir),
        updatedAt: nowIso(ctx),
    };
    writeAuthority(ctx, authority);
    const rewritten = Object.create(null);
    for (const [id, grant] of Object.entries(grants.grants)) {
        rewritten[id] = {
            ...grant,
            controllerId: authority.controllerId,
            epochRef: {
                controllerId: authority.controllerId,
                epoch: authority.epoch,
            },
        };
    }
    return { authority, grants: { version: 1, grants: rewritten } };
}
