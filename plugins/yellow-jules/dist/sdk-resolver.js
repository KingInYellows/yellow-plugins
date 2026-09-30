"use strict";
/**
 * Locates, verifies, and loads the ESM-only `@google/jules-sdk` from this
 * CJS build (contract "Module-strategy verdict", R4, R6).
 *
 * Two install locations, checked in order:
 * - workspace: `<pluginRoot>/node_modules/@google/jules-sdk` (a monorepo
 *   checkout; the workspace lockfile owns integrity there);
 * - data dir: `<dataDir>/runtime/node_modules/@google/jules-sdk`, installed
 *   only by `setup --install-sdk` with `npm ci --ignore-scripts` from the
 *   lockfile shipped in `<pluginRoot>/runtime/`, and re-verified on every
 *   load against `runtime/pin.json` (entry sha256 plus the installed tree).
 *
 * Both paths are read directly rather than through `createRequire`, whose
 * node_modules walk would also accept an unverified install in any ancestor
 * directory. Loading is `await import(pathToFileURL(entry).href)`:
 * `require.resolve` throws ERR_PACKAGE_PATH_NOT_EXPORTED on this package and
 * a bare specifier fails from the plugin cache.
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
exports.defaultNpmRunner = exports.INSTALL_TIMEOUT_MS = exports.PINNED_SDK_VERSION = exports.SDK_PACKAGE = void 0;
exports.computeTreeDigest = computeTreeDigest;
exports.probeSdkResolution = probeSdkResolution;
exports.resetSdkCache = resetSdkCache;
exports.resolveSdk = resolveSdk;
exports.npmSpawnConfig = npmSpawnConfig;
exports.scrubInstallEnv = scrubInstallEnv;
exports.installSdk = installSdk;
const node_child_process_1 = require("node:child_process");
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const config_js_1 = require("./config.js");
const errors_js_1 = require("./errors.js");
exports.SDK_PACKAGE = '@google/jules-sdk';
exports.PINNED_SDK_VERSION = '0.2.0';
exports.INSTALL_TIMEOUT_MS = 300_000;
function sha256File(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function integrityFailure(message) {
    return (0, errors_js_1.throwAppError)('JULES_SDK_INTEGRITY', message);
}
function packageDir(nodeModules, name) {
    return path.join(nodeModules, ...name.split('/'));
}
/** Reads `exports["."].import` and returns the entry file, refusing anything outside the package. */
function entryFileOf(pkgDir) {
    let manifest;
    try {
        manifest = readJson(path.join(pkgDir, 'package.json'));
    }
    catch {
        return integrityFailure(`${exports.SDK_PACKAGE} package.json is unreadable`);
    }
    const m = manifest;
    if (m.version !== exports.PINNED_SDK_VERSION) {
        return integrityFailure(`${exports.SDK_PACKAGE} is version ${String(m.version)}, expected the pinned ${exports.PINNED_SDK_VERSION}`);
    }
    const importPath = m.exports?.['.']?.import;
    if (typeof importPath !== 'string') {
        return integrityFailure(`${exports.SDK_PACKAGE} has no exports["."].import entry`);
    }
    const entry = path.resolve(pkgDir, importPath);
    const rel = path.relative(pkgDir, entry);
    if (rel === '..' ||
        rel.startsWith(`..${path.sep}`) ||
        path.isAbsolute(rel) ||
        !fs.existsSync(entry)) {
        return integrityFailure(`${exports.SDK_PACKAGE} entry ${importPath} is missing or escapes the package`);
    }
    return { version: m.version, entry };
}
/** Installed top-level packages under node_modules (scoped ones as `@scope/name`), dot-entries skipped. */
function listInstalledPackages(nodeModules) {
    const names = [];
    for (const entry of fs.readdirSync(nodeModules)) {
        if (entry.startsWith('.'))
            continue;
        if (entry.startsWith('@')) {
            for (const scoped of fs.readdirSync(path.join(nodeModules, entry))) {
                names.push(`${entry}/${scoped}`);
            }
        }
        else {
            names.push(entry);
        }
    }
    return names.sort();
}
/**
 * One digest over every regular file under `node_modules`: sha256 of sorted
 * `<posix relative path>\0<file sha256>\n` lines. Symlinks, other non-regular
 * entries, and any nested `node_modules` fail closed. Top-level dot-entries
 * (npm's `.bin`, `.package-lock.json`) are not importable code and are skipped,
 * matching listInstalledPackages. Synchronous; cost is one read of the whole
 * tree (a few MB for the pinned SDK) on every data-dir verification.
 */
function computeTreeDigest(nodeModules) {
    const lines = [];
    const walk = (dir, rel) => {
        const entries = fs
            .readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            if (rel === '' && entry.name.startsWith('.'))
                continue;
            const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
            const abs = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) {
                return integrityFailure(`runtime/node_modules contains a symlink at ${relPath}`);
            }
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') {
                    return integrityFailure(`runtime/node_modules contains a nested node_modules at ${relPath}`);
                }
                walk(abs, relPath);
            }
            else if (entry.isFile()) {
                lines.push(`${relPath}\0${sha256File(abs)}\n`);
            }
            else {
                return integrityFailure(`runtime/node_modules contains a non-regular file at ${relPath}`);
            }
        }
    };
    walk(nodeModules, '');
    return crypto.createHash('sha256').update(lines.join('')).digest('hex');
}
function isPinFile(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const v = value;
    return (typeof v['sdkVersion'] === 'string' &&
        typeof v['sdkIntegrity'] === 'string' &&
        typeof v['sdkEntrySha256'] === 'string' &&
        typeof v['treeSha256'] === 'string' &&
        Array.isArray(v['tree']) &&
        v['tree'].every((p) => p !== null &&
            typeof p === 'object' &&
            typeof p['name'] === 'string' &&
            typeof p['version'] === 'string'));
}
function pinPath(dataDir) {
    return path.join((0, config_js_1.resolveRuntimeDir)(dataDir), 'pin.json');
}
/** Data-dir branch: entry sha256 and the full installed tree must match what setup recorded. */
function verifyDataDirInstall(dataDir, entry) {
    const file = pinPath(dataDir);
    (0, config_js_1.assertOwnerOnlyFile)(file);
    if (!fs.existsSync(file)) {
        return integrityFailure('runtime/pin.json is missing; the data-dir SDK install is unverified');
    }
    let pin;
    try {
        pin = readJson(file);
    }
    catch {
        return integrityFailure('runtime/pin.json is unreadable');
    }
    if (pin !== null &&
        typeof pin === 'object' &&
        typeof pin['treeSha256'] !== 'string') {
        return integrityFailure('runtime/pin.json has no treeSha256 (written by an older setup); rerun /jules:setup to reinstall and re-pin the SDK');
    }
    if (!isPinFile(pin) || pin.sdkVersion !== exports.PINNED_SDK_VERSION) {
        return integrityFailure('runtime/pin.json does not record the pinned SDK');
    }
    if (sha256File(entry) !== pin.sdkEntrySha256) {
        return integrityFailure(`${exports.SDK_PACKAGE} entry file sha256 does not match runtime/pin.json`);
    }
    const nodeModules = path.join((0, config_js_1.resolveRuntimeDir)(dataDir), 'node_modules');
    const installed = listInstalledPackages(nodeModules);
    const pinned = pin.tree.map((p) => p.name).sort();
    if (installed.join('\n') !== pinned.join('\n')) {
        return integrityFailure('installed packages under runtime/node_modules differ from runtime/pin.json');
    }
    for (const p of pin.tree) {
        let version;
        try {
            version = readJson(path.join(packageDir(nodeModules, p.name), 'package.json')).version;
        }
        catch {
            return integrityFailure(`${p.name} package.json is unreadable`);
        }
        if (version !== p.version) {
            return integrityFailure(`${p.name} is ${String(version)}, runtime/pin.json records ${p.version}`);
        }
    }
    if (computeTreeDigest(nodeModules) !== pin.treeSha256) {
        return integrityFailure('runtime/node_modules contents do not match the treeSha256 in runtime/pin.json');
    }
    return pin;
}
/**
 * Locates and verifies the SDK without importing it. Throws
 * JULES_SDK_INTEGRITY on any verification failure (a present-but-wrong
 * install is never reported as `missing`); returns `missing` when neither
 * location holds the package. Runs the data-dir owner checks first, because
 * `runtime/node_modules` is executable code.
 */
function probeSdkResolution(dataDir, options = {}) {
    (0, config_js_1.assertOwnerOnlyDir)(dataDir);
    const pluginRoot = options.pluginRoot ?? (0, config_js_1.resolvePluginRoot)();
    const workspacePkg = packageDir(path.join(pluginRoot, 'node_modules'), exports.SDK_PACKAGE);
    if (options.dataDirOnly !== true &&
        fs.existsSync(path.join(workspacePkg, 'package.json'))) {
        const { version, entry } = entryFileOf(workspacePkg);
        return { resolution: 'workspace', sdkVersion: version, entryPath: entry };
    }
    const runtimeDir = (0, config_js_1.resolveRuntimeDir)(dataDir);
    if (!fs.existsSync(runtimeDir))
        return { resolution: 'missing' };
    (0, config_js_1.assertOwnerOnlyDir)(runtimeDir);
    const dataPkg = packageDir(path.join(runtimeDir, 'node_modules'), exports.SDK_PACKAGE);
    if (!fs.existsSync(path.join(dataPkg, 'package.json')))
        return { resolution: 'missing' };
    const { version, entry } = entryFileOf(dataPkg);
    const pin = verifyDataDirInstall(dataDir, entry);
    return {
        resolution: 'data-dir',
        sdkVersion: version,
        sdkIntegrity: pin.sdkIntegrity,
        sdkEntrySha256: pin.sdkEntrySha256,
        entryPath: entry,
    };
}
let cached;
/** Test-only: forces the next resolveSdk() call to re-resolve. */
function resetSdkCache() {
    cached = undefined;
}
async function resolveSdk(dataDir, options = {}) {
    if (cached !== undefined)
        return cached;
    const probe = probeSdkResolution(dataDir, options);
    if (probe.resolution === 'missing' || probe.entryPath === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_SDK_MISSING', `${exports.SDK_PACKAGE}@${exports.PINNED_SDK_VERSION} is not installed`);
    }
    const module = await import((0, node_url_1.pathToFileURL)(probe.entryPath).href);
    cached = {
        ...probe,
        resolution: probe.resolution,
        entryPath: probe.entryPath,
        module,
    };
    return cached;
}
const STDERR_CAP = 64 * 1024;
/**
 * On win32 npm is a `.cmd` shim, which Node refuses to spawn without a shell
 * (CVE-2024-27980). The shell is safe here only because every argument is a
 * code-controlled constant and the directory is passed via `cwd`, never argv.
 */
function npmSpawnConfig(platform) {
    const isWin = platform === 'win32';
    return { command: isWin ? 'npm.cmd' : 'npm', shell: isWin };
}
/**
 * SIGKILL reaches npm directly on POSIX. On win32 the child is the shell, and
 * killing it can orphan npm, so take down the whole tree with taskkill first.
 */
function killInstallChild(child) {
    if (process.platform === 'win32' && child.pid !== undefined) {
        try {
            (0, node_child_process_1.spawn)('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true,
            }).on('error', () => undefined);
        }
        catch {
            // fall through to the direct kill
        }
    }
    child.kill('SIGKILL');
}
const defaultNpmRunner = (args, options) => new Promise((resolve) => {
    const { command, shell } = npmSpawnConfig(process.platform);
    const child = (0, node_child_process_1.spawn)(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell,
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        killInstallChild(child);
    }, options.timeoutMs);
    child.stderr?.on('data', (chunk) => {
        if (stderr.length < STDERR_CAP)
            stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ exitCode: null, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, stderr, timedOut });
    });
});
exports.defaultNpmRunner = defaultNpmRunner;
/** The install child never sees the credential or anything that injects code into node. */
function scrubInstallEnv(env) {
    const out = {};
    for (const [key, value] of Object.entries(env)) {
        if (key === 'JULES_API_KEY' ||
            key === 'NODE_OPTIONS' ||
            key === 'NODE_PATH')
            continue;
        if (key.toLowerCase() === 'npm_config_ignore_scripts')
            continue;
        out[key] = value;
    }
    return out;
}
function lockfileTree(lockfilePath) {
    const lock = readJson(lockfilePath);
    const tree = [];
    for (const [key, value] of Object.entries(lock.packages ?? {})) {
        if (key === '')
            continue;
        const name = key.replace(/^node_modules\//, '');
        if (name.includes('node_modules/')) {
            return integrityFailure(`lockfile entry ${key} is nested; the pinned tree must be flat`);
        }
        if (typeof value.version !== 'string' ||
            typeof value.integrity !== 'string') {
            return integrityFailure(`lockfile entry ${key} has no version or integrity`);
        }
        tree.push({ name, version: value.version, integrity: value.integrity });
    }
    return tree.sort((a, b) => a.name.localeCompare(b.name));
}
async function removeInstall(runtimeDir) {
    await fs.promises.rm(path.join(runtimeDir, 'node_modules'), {
        recursive: true,
        force: true,
    });
    await fs.promises.rm(path.join(runtimeDir, 'pin.json'), { force: true });
}
async function writePin(file, pin) {
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
    await fs.promises.writeFile(tmp, `${JSON.stringify(pin, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
    });
    await fs.promises.rename(tmp, file);
    await fs.promises.chmod(file, 0o600);
}
/**
 * `npm ci --ignore-scripts` from the lockfile shipped with the plugin, so
 * every package's integrity hash is checked and no lifecycle script runs
 * (R4). npm raises EINTEGRITY only after the tarball has streamed, so on any
 * failure `runtime/node_modules` and `pin.json` are removed before anything
 * under them can be loaded.
 */
async function installSdk(dataDir, options = {}) {
    const capMs = options.timeoutMs ?? exports.INSTALL_TIMEOUT_MS;
    const deadlineMs = options.deadlineMs;
    const deadlineExceeded = () => (0, errors_js_1.throwAppError)('JULES_DEADLINE_EXCEEDED', 'the operation deadline expired during the SDK install; the install was removed', { recoveryAction: 'Retry with a larger --deadline-ms.' });
    if (deadlineMs !== undefined && deadlineMs <= 0)
        return deadlineExceeded();
    const deadlineBinds = deadlineMs !== undefined && deadlineMs < capMs;
    const timeoutMs = deadlineBinds ? deadlineMs : capMs;
    const pluginRoot = options.pluginRoot ?? (0, config_js_1.resolvePluginRoot)();
    const shippedRuntime = path.join(pluginRoot, 'runtime');
    const runtimeDir = (0, config_js_1.resolveRuntimeDir)(dataDir);
    (0, config_js_1.assertOwnerOnlyDir)(dataDir);
    (0, config_js_1.ensureOwnerOnlyDir)(runtimeDir);
    await removeInstall(runtimeDir);
    for (const name of ['package.json', 'package-lock.json']) {
        const target = path.join(runtimeDir, name);
        await fs.promises.rm(target, { force: true });
        await fs.promises.copyFile(path.join(shippedRuntime, name), target, fs.constants.COPYFILE_EXCL);
        await fs.promises.chmod(target, 0o600);
    }
    const runNpm = options.runNpm ?? exports.defaultNpmRunner;
    try {
        const result = await runNpm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
            cwd: runtimeDir,
            env: scrubInstallEnv(options.env ?? process.env),
            timeoutMs,
        });
        if (result.exitCode !== 0) {
            if (result.timedOut && deadlineBinds)
                return deadlineExceeded();
            if (/EINTEGRITY/.test(result.stderr)) {
                return integrityFailure('npm ci reported EINTEGRITY; the install was removed');
            }
            return (0, errors_js_1.throwAppError)('JULES_SDK_MISSING', result.timedOut
                ? `npm ci timed out after ${timeoutMs} ms; the install was removed`
                : `npm ci exited ${String(result.exitCode)}; the install was removed`, {
                recoveryAction: 'Check network access to the npm registry, then rerun /jules:setup.',
            });
        }
        const tree = lockfileTree(path.join(runtimeDir, 'package-lock.json'));
        const sdk = tree.find((p) => p.name === exports.SDK_PACKAGE);
        if (sdk === undefined || sdk.version !== exports.PINNED_SDK_VERSION) {
            return integrityFailure(`the shipped lockfile does not pin ${exports.SDK_PACKAGE}@${exports.PINNED_SDK_VERSION}`);
        }
        const nodeModules = path.join(runtimeDir, 'node_modules');
        const { entry } = entryFileOf(packageDir(nodeModules, exports.SDK_PACKAGE));
        const pin = {
            sdkVersion: sdk.version,
            sdkIntegrity: sdk.integrity,
            sdkEntrySha256: sha256File(entry),
            treeSha256: computeTreeDigest(nodeModules),
            tree,
        };
        await writePin(pinPath(dataDir), pin);
        verifyDataDirInstall(dataDir, entry);
    }
    catch (err) {
        await removeInstall(runtimeDir);
        throw err;
    }
    resetSdkCache();
    return probeSdkResolution(dataDir, { pluginRoot, dataDirOnly: true });
}
