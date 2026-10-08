"use strict";
/**
 * Credential presence and host-neutral data-dir resolution, plus the
 * owner-only checks every state-reading or SDK-resolving invocation runs.
 * Never reads auth from argv, and never returns or prints the credential
 * value itself — only whether it is present.
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
exports.hasEnvApiKey = hasEnvApiKey;
exports.resolveDataDir = resolveDataDir;
exports.resolveRuntimeDir = resolveRuntimeDir;
exports.resolveStateDir = resolveStateDir;
exports.resolveJournalPath = resolveJournalPath;
exports.resolveLockPath = resolveLockPath;
exports.resolveGrantsPath = resolveGrantsPath;
exports.resolveArtifactsDir = resolveArtifactsDir;
exports.resolveSdkScratchDir = resolveSdkScratchDir;
exports.resolvePluginRoot = resolvePluginRoot;
exports.findGitWorkTree = findGitWorkTree;
exports.canonicalPath = canonicalPath;
exports.assertDataDirLocation = assertDataDirLocation;
exports.assertOwnerOnlyDir = assertOwnerOnlyDir;
exports.assertOwnerOnlyFile = assertOwnerOnlyFile;
exports.ensureOwnerOnlyDir = ensureOwnerOnlyDir;
exports.prepareDataDir = prepareDataDir;
exports.resolveControllerDir = resolveControllerDir;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const errors_js_1 = require("./errors.js");
function hasEnvApiKey(env = process.env) {
    const value = env['JULES_API_KEY'];
    return typeof value === 'string' && value.length > 0;
}
const DEFAULT_DATA_DIR_ENV = {
    env: process.env,
    platform: process.platform,
    homedir: os.homedir,
};
/**
 * `node:path`'s default export is bound to the OS actually running the
 * process, not to a logical `platform` argument — so a win32 stub run on a
 * Linux CI box would silently produce POSIX-separated paths without this.
 * Selecting `path.win32` explicitly makes the platform argument authoritative
 * regardless of the host OS, which is what makes this testable at all.
 */
function pathFor(platform) {
    return platform === 'win32' ? path.win32 : path.posix;
}
// replica:resolveDataDir:start
function resolveDataDir(overrides = {}) {
    const { env, platform, homedir } = { ...DEFAULT_DATA_DIR_ENV, ...overrides };
    const p = pathFor(platform);
    const explicit = env['YELLOW_JULES_DATA_DIR'];
    if (explicit && explicit.length > 0) {
        return explicit;
    }
    const xdgDataHome = env['XDG_DATA_HOME'];
    if (xdgDataHome && xdgDataHome.length > 0) {
        return p.join(xdgDataHome, 'yellow-jules');
    }
    if (platform === 'darwin') {
        return p.join(homedir(), 'Library', 'Application Support', 'yellow-jules');
    }
    if (platform === 'win32') {
        const appData = env['APPDATA'];
        if (appData && appData.length > 0) {
            return p.join(appData, 'yellow-jules');
        }
        return p.join(homedir(), 'AppData', 'Roaming', 'yellow-jules');
    }
    return p.join(homedir(), '.local', 'share', 'yellow-jules');
}
// replica:resolveDataDir:end
function resolveRuntimeDir(dataDir) {
    return path.join(dataDir, 'runtime');
}
function resolveStateDir(dataDir) {
    return path.join(dataDir, 'state');
}
function resolveJournalPath(dataDir) {
    return path.join(resolveStateDir(dataDir), 'journal.json');
}
function resolveLockPath(dataDir) {
    return path.join(resolveStateDir(dataDir), '.lock');
}
/** `state/grants.json`: written only by the TTY-confirmed `authorize` path and the counters it guards. */
function resolveGrantsPath(dataDir) {
    return path.join(resolveStateDir(dataDir), 'grants.json');
}
function resolveArtifactsDir(dataDir) {
    return path.join(dataDir, 'artifacts');
}
function resolveSdkScratchDir(dataDir) {
    return path.join(dataDir, 'sdk-scratch');
}
/** The installed plugin root (`dist/..` at runtime, `src/..` under tests). */
function resolvePluginRoot() {
    return path.resolve(__dirname, '..');
}
function isInside(parent, child) {
    const rel = path.relative(parent, child);
    return (rel === '' ||
        (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)));
}
/** Resolve symlinks on the longest existing prefix so containment checks compare real paths. */
function realpathOfExistingPrefix(target) {
    const absolute = path.resolve(target);
    const pending = [];
    let current = absolute;
    for (;;) {
        try {
            return path.join(fs.realpathSync(current), ...pending.reverse());
        }
        catch {
            const parent = path.dirname(current);
            if (parent === current)
                return absolute;
            pending.push(path.basename(current));
            current = parent;
        }
    }
}
/** Nearest ancestor of `start` holding a `.git` entry (a directory, or a worktree's `.git` file). */
function findGitWorkTree(start) {
    let current = realpathOfExistingPrefix(start);
    for (;;) {
        if (fs.existsSync(path.join(current, '.git')))
            return current;
        const parent = path.dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
/** Canonical absolute path: symlinks resolved on the longest existing prefix. */
function canonicalPath(target) {
    return realpathOfExistingPrefix(target);
}
/**
 * R15/R35: provider state never lives under a source clone or the plugin
 * install cache, including when `YELLOW_JULES_DATA_DIR` points there.
 */
function assertDataDirLocation(dataDir, context) {
    if (!path.isAbsolute(dataDir)) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', 'the data directory must be an absolute path');
    }
    const real = realpathOfExistingPrefix(dataDir);
    if (isInside(realpathOfExistingPrefix(context.pluginRoot), real)) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', 'the data directory must not be inside the plugin install directory');
    }
    const workTree = findGitWorkTree(context.cwd);
    if (workTree !== undefined && isInside(workTree, real)) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', 'the data directory must not be inside the git work tree containing the current directory');
    }
    // The data dir's own ancestry: a different checkout than cwd's, or cwd
    // outside any checkout, must not let state land in a source clone.
    const dataWorkTree = findGitWorkTree(real);
    if (dataWorkTree !== undefined) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', 'the data directory must not be inside any git work tree');
    }
}
function currentUid() {
    return typeof process.getuid === 'function' ? process.getuid() : undefined;
}
/**
 * Refuses a symlink, a non-directory, a directory owned by another user, or
 * one writable by group or others — `runtime/node_modules/` under the data
 * dir is executable code loaded into this process, so a directory anyone
 * else could have written is never trusted. A directory that is merely
 * readable by others is tightened to 0700 (we own it, nothing was planted).
 */
function assertOwnerOnlyDir(dirPath) {
    let stat;
    try {
        stat = fs.lstatSync(dirPath);
    }
    catch (err) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `cannot inspect ${dirPath}: ${err.code ?? 'error'}`);
    }
    if (stat.isSymbolicLink()) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `refusing symlinked directory ${dirPath}`);
    }
    if (!stat.isDirectory()) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `${dirPath} is not a directory`);
    }
    const uid = currentUid();
    if (uid !== undefined && stat.uid !== uid) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `${dirPath} is not owned by the current user`);
    }
    if (process.platform === 'win32')
        return;
    if ((stat.mode & 0o022) !== 0) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `${dirPath} is writable by group or others (mode ${(stat.mode & 0o777).toString(8)})`);
    }
    if ((stat.mode & 0o077) !== 0) {
        fs.chmodSync(dirPath, 0o700);
    }
}
/** Same checks for a regular file (journal, lock, pin.json): owned, not a symlink, 0600. */
function assertOwnerOnlyFile(filePath) {
    let stat;
    try {
        stat = fs.lstatSync(filePath);
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return;
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `cannot inspect ${filePath}: ${err.code ?? 'error'}`);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `${filePath} is not a regular file`);
    }
    const uid = currentUid();
    if (uid !== undefined && stat.uid !== uid) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `${filePath} is not owned by the current user`);
    }
    if (process.platform === 'win32')
        return;
    if ((stat.mode & 0o022) !== 0) {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', `${filePath} is writable by group or others (mode ${(stat.mode & 0o777).toString(8)})`);
    }
    if ((stat.mode & 0o077) !== 0) {
        fs.chmodSync(filePath, 0o600);
    }
}
/** Create `dirPath` 0700 when absent (parents with default mode), then assert it is owner-only. */
function ensureOwnerOnlyDir(dirPath) {
    try {
        fs.lstatSync(dirPath);
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
        fs.mkdirSync(path.dirname(dirPath), { recursive: true });
        try {
            fs.mkdirSync(dirPath, { mode: 0o700 });
        }
        catch (mkdirErr) {
            if (mkdirErr.code !== 'EEXIST')
                throw mkdirErr;
        }
    }
    assertOwnerOnlyDir(dirPath);
}
/**
 * Every invocation that reads state or resolves the SDK calls this first:
 * location rules, then owner-only checks on the data dir and each of its
 * existing sensitive subdirectories (contract "Local state").
 */
function prepareDataDir(dataDir, context) {
    assertDataDirLocation(dataDir, context);
    ensureOwnerOnlyDir(dataDir);
    ensureOwnerOnlyDir(resolveStateDir(dataDir));
    for (const sub of [
        resolveSdkScratchDir(dataDir),
        resolveRuntimeDir(dataDir),
    ]) {
        if (fs.existsSync(sub) || isSymlink(sub))
            assertOwnerOnlyDir(sub);
    }
}
function isSymlink(target) {
    try {
        return fs.lstatSync(target).isSymbolicLink();
    }
    catch {
        return false;
    }
}
/**
 * R38: the controller authority file lives outside `<dataDir>`, so a copied
 * or restored data directory cannot carry it along. Precedence:
 * `YELLOW_JULES_CONTROLLER_DIR` > `$XDG_STATE_HOME/yellow-jules-controller` >
 * `~/.local/state/yellow-jules-controller`. Created 0700.
 *
 * The directory and `dataDir` must not contain each other by canonical path:
 * otherwise copying the data directory (or its parent) would also copy the
 * file that is meant to detect the copy.
 */
function resolveControllerDir(dataDir, env = process.env, homedir = os.homedir) {
    const explicit = env['YELLOW_JULES_CONTROLLER_DIR'];
    const xdgStateHome = env['XDG_STATE_HOME'];
    let dir;
    if (explicit && explicit.length > 0) {
        dir = explicit;
    }
    else if (xdgStateHome && xdgStateHome.length > 0) {
        dir = path.join(xdgStateHome, 'yellow-jules-controller');
    }
    else {
        dir = path.join(homedir(), '.local', 'state', 'yellow-jules-controller');
    }
    if (!path.isAbsolute(dir)) {
        return (0, errors_js_1.throwAppError)('JULES_DATA_DIR', 'the controller directory must be an absolute path');
    }
    const realController = realpathOfExistingPrefix(dir);
    const realData = realpathOfExistingPrefix(dataDir);
    if (isInside(realData, realController) ||
        isInside(realController, realData)) {
        return (0, errors_js_1.throwAppError)('JULES_DATA_DIR', 'the controller directory and the data directory must not contain each other');
    }
    ensureOwnerOnlyDir(dir);
    return dir;
}
