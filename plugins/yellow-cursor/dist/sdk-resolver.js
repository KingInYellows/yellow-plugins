"use strict";
/**
 * Resolves `@cursor/sdk` lazily: only sdk-adapter.ts calls resolveSdk(), and
 * only when an operation actually needs it (so `delegate --dry-run` and
 * usage-error paths never touch the SDK at all). Falls back to a
 * data-dir-local install performed by `setup --install-sdk` when the
 * workspace dependency isn't resolvable (e.g. this CLI installed/run
 * standalone outside the monorepo).
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
exports.resetSdkCache = resetSdkCache;
exports.resolveSdk = resolveSdk;
exports.probeSdkResolutionState = probeSdkResolutionState;
exports.installSdk = installSdk;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_util_1 = require("node:util");
const config_js_1 = require("./config.js");
const errors_js_1 = require("./errors.js");
let cachedSdk;
/** Test-only: forces the next resolveSdk() call to re-resolve instead of using the cache. */
function resetSdkCache() {
    cachedSdk = undefined;
}
function tryRequire(specifier) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(specifier);
    }
    catch {
        return undefined;
    }
}
function resolveSdk(dataDir) {
    if (cachedSdk)
        return cachedSdk;
    const workspaceSdk = tryRequire('@cursor/sdk');
    if (workspaceSdk) {
        cachedSdk = workspaceSdk;
        return cachedSdk;
    }
    const runtimeModulePath = path.join((0, config_js_1.resolveRuntimeDir)(dataDir), 'node_modules', '@cursor', 'sdk');
    if (fs.existsSync(runtimeModulePath)) {
        const runtimeSdk = tryRequire(runtimeModulePath);
        if (runtimeSdk) {
            cachedSdk = runtimeSdk;
            return cachedSdk;
        }
    }
    return (0, errors_js_1.throwAppError)('CURSOR_SDK_MISSING', '@cursor/sdk is not installed and no data-dir runtime install was found.', {
        recoveryAction: 'Run /cursor:setup (or `cursor setup --install-sdk`) to install the Cursor SDK.',
    });
}
/** Non-throwing probe for `setup` reporting — resolveSdk() throws on total failure, this doesn't. */
function probeSdkResolutionState(dataDir) {
    if (cachedSdk)
        return 'workspace';
    if (tryRequire('@cursor/sdk'))
        return 'workspace';
    const runtimeModulePath = path.join((0, config_js_1.resolveRuntimeDir)(dataDir), 'node_modules', '@cursor', 'sdk');
    if (fs.existsSync(runtimeModulePath) && tryRequire(runtimeModulePath))
        return 'data-dir';
    return 'missing';
}
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function installSdk(dataDir) {
    const runtimeDir = (0, config_js_1.resolveRuntimeDir)(dataDir);
    await fs.promises.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    await execFileAsync('npm', [
        'install',
        '--prefix',
        runtimeDir,
        '@cursor/sdk@1.0.28',
        '--no-save',
        '--no-audit',
        '--no-fund',
    ], { shell: false });
    resetSdkCache();
    return { ok: true, runtimeDir };
}
