"use strict";
/**
 * Credential-source labeling and host-neutral data-dir resolution. Never
 * reads auth from argv, and never returns/prints the credential value
 * itself — only which source it came from.
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
exports.resolveStateFilePath = resolveStateFilePath;
exports.resolveStateDir = resolveStateDir;
exports.resolveArtifactDownloadDir = resolveArtifactDownloadDir;
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
/**
 * The CLI only knows about the env-var branch of the precedence order
 * (CURSOR_API_KEY env -> SDK stored login -> none); whether a stored login
 * exists is only knowable by asking the SDK (SdkAdapter.probeSetup), so
 * runtime.ts combines this with the adapter probe result.
 */
function hasEnvApiKey(env = process.env) {
    const value = env['CURSOR_API_KEY'];
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
function resolveDataDir(overrides = {}) {
    const { env, platform, homedir } = { ...DEFAULT_DATA_DIR_ENV, ...overrides };
    const p = pathFor(platform);
    const explicit = env['YELLOW_CURSOR_DATA_DIR'];
    if (explicit && explicit.length > 0) {
        return explicit;
    }
    const xdgDataHome = env['XDG_DATA_HOME'];
    if (xdgDataHome && xdgDataHome.length > 0) {
        return p.join(xdgDataHome, 'yellow-cursor');
    }
    if (platform === 'darwin') {
        return p.join(homedir(), 'Library', 'Application Support', 'yellow-cursor');
    }
    if (platform === 'win32') {
        const appData = env['APPDATA'];
        if (appData && appData.length > 0) {
            return p.join(appData, 'yellow-cursor');
        }
        return p.join(homedir(), 'AppData', 'Roaming', 'yellow-cursor');
    }
    return p.join(homedir(), '.local', 'share', 'yellow-cursor');
}
function resolveRuntimeDir(dataDir) {
    return path.join(dataDir, 'runtime');
}
function resolveStateFilePath(dataDir) {
    return path.join(dataDir, 'state', 'agents.json');
}
function resolveStateDir(dataDir) {
    return path.join(dataDir, 'state');
}
/** Approved root for `artifacts --download --out` writes (contained under dataDir). */
function resolveArtifactDownloadDir(dataDir) {
    return path.join(dataDir, 'artifact-downloads');
}
