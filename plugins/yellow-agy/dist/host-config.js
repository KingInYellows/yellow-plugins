"use strict";
/**
 * The invocation `setup` resolves once and records in the data dir
 * (contract-v0 "Host bridge"): which host agy runs on, and where worktrees
 * and the plan schema go in that host's filesystem. On the bridge the
 * worktree root is resolved with realpath inside WSL, so a symlink into
 * /mnt is caught here rather than trusted.
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
exports.detectHost = detectHost;
exports.writeHostConfig = writeHostConfig;
exports.readHostConfig = readHostConfig;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
const invocation_1 = require("./invocation");
const FILE = 'host.json';
const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function defaultWhich(cmd) {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    try {
        (0, node_child_process_1.execFileSync)(probe, [cmd], { stdio: 'ignore', windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
function defaultWslRun(distro, args) {
    const argv = distro === undefined ? ['-e', ...args] : ['-d', distro, '-e', ...args];
    return (0, node_child_process_1.execFileSync)('wsl.exe', argv, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
    })
        .replace(/\r/g, '')
        .trim();
}
/** Works out the host and makes its worktree root (0700 where it can). */
function detectHost(options = {}) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const which = options.which ?? defaultWhich;
    const set = (name) => {
        const v = env[name];
        return v === undefined || v === '' ? undefined : v;
    };
    if (platform !== 'win32') {
        if (!which('agy')) {
            throw new errors_1.AgyError('AGY_NOT_INSTALLED', 'agy is not on PATH');
        }
        const base = set('XDG_DATA_HOME') ?? path.join(os.homedir(), '.local', 'share');
        const root = path.join(base, 'yellow-agy', 'worktrees');
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const real = fs.realpathSync(root);
        // mkdir's mode doesn't tighten a root that already existed.
        fs.chmodSync(real, 0o700);
        return {
            version: 1,
            host: { kind: 'posix' },
            worktreeRoot: real,
            schemaPath: path.join(path.dirname(real), 'plan.schema.json'),
            sandboxVerified: false,
        };
    }
    // buildInvocation spawns agy.exe on this host; a bare `agy` shim isn't it.
    if (which('agy.exe')) {
        const base = set('LOCALAPPDATA') ?? path.join(os.homedir(), 'AppData', 'Local');
        const root = path.join(base, 'yellow-agy', 'worktrees');
        fs.mkdirSync(root, { recursive: true });
        const real = fs.realpathSync(root);
        return {
            version: 1,
            host: { kind: 'windows-native' },
            worktreeRoot: real,
            schemaPath: path.join(path.dirname(real), 'plan.schema.json'),
            sandboxVerified: false,
        };
    }
    if (!which('wsl.exe')) {
        throw new errors_1.AgyError('AGY_NOT_INSTALLED', 'neither agy.exe nor wsl.exe is on PATH', 'Install agy so agy.exe is on PATH, or install it inside WSL.');
    }
    const distro = set('YELLOW_AGY_WSL_DISTRO');
    if (distro !== undefined && !DISTRO_RE.test(distro)) {
        throw new errors_1.AgyError('AGY_BRIDGE', `YELLOW_AGY_WSL_DISTRO is not a distro name: ${JSON.stringify(distro)}`);
    }
    const run = options.wslRun ?? defaultWslRun;
    let real;
    try {
        if (run(distro, ['sh', '-c', 'command -v agy']) === '') {
            throw new Error('no agy');
        }
        // A fixed script; nothing from the caller is interpolated into it.
        real = run(distro, [
            'sh',
            '-c',
            'd="$HOME/.local/share/yellow-agy/worktrees" && mkdir -p -m 700 "$d" && chmod 700 "$d" && realpath -e -- "$d"',
        ]);
    }
    catch {
        throw new errors_1.AgyError('AGY_BRIDGE', `agy or its worktree root could not be reached in ${distro ?? 'the default WSL distro'}`);
    }
    (0, invocation_1.assertWslPath)(real, 'the WSL worktree root');
    return {
        version: 1,
        host: distro === undefined
            ? { kind: 'wsl-bridge' }
            : { kind: 'wsl-bridge', distro },
        worktreeRoot: real,
        schemaPath: path.posix.join(path.posix.dirname(real), 'plan.schema.json'),
        sandboxVerified: false,
    };
}
function isHost(v) {
    if (v === null || typeof v !== 'object')
        return false;
    const h = v;
    if (h['kind'] === 'posix' || h['kind'] === 'windows-native')
        return true;
    return (h['kind'] === 'wsl-bridge' &&
        (h['distro'] === undefined ||
            (typeof h['distro'] === 'string' && DISTRO_RE.test(h['distro']))));
}
function writeHostConfig(dataDir, config) {
    const file = path.join(dataDir, FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
    });
    fs.renameSync(tmp, file);
}
/** The recorded host; refuses until setup has recorded one. */
function readHostConfig(dataDir) {
    let value;
    try {
        value = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), 'utf8'));
    }
    catch {
        throw new errors_1.AgyError('AGY_NOT_INSTALLED', 'no host is recorded yet', 'Run /agy:setup first.');
    }
    const c = value;
    if (c === null ||
        typeof c !== 'object' ||
        c.version !== 1 ||
        !isHost(c.host) ||
        typeof c.worktreeRoot !== 'string' ||
        typeof c.schemaPath !== 'string') {
        throw new errors_1.AgyError('AGY_INTERNAL', `${path.join(dataDir, FILE)} has an unknown format`, 'Run /agy:setup again.');
    }
    if (c.host.kind === 'wsl-bridge') {
        (0, invocation_1.assertWslPath)(c.worktreeRoot, 'the recorded worktree root');
        (0, invocation_1.assertWslPath)(c.schemaPath, 'the recorded schema path');
    }
    return {
        version: 1,
        host: c.host,
        worktreeRoot: c.worktreeRoot,
        schemaPath: c.schemaPath,
        sandboxVerified: false,
    };
}
