"use strict";
/**
 * Runs non-agy commands where agy runs: git in the worktree, and the two
 * file operations the bridge needs (writing the plan schema, removing a
 * temporary index). On the WSL bridge every command goes through the same
 * exec-only `wsl.exe [-d <distro>] --cd <dir> -e env K=V <cmd> …` form as agy,
 * so no distro shell parses an argument. agy turns themselves go through
 * invocation.ts and process.ts; this module never starts agy.
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
exports.hostCommand = hostCommand;
exports.runSpawn = runSpawn;
exports.createHostExec = createHostExec;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
const invocation_1 = require("./invocation");
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
/** Pure: how `cmd args` is spawned on `host`, with git hooks off. */
function hostCommand(host, cmd, args, options, baseEnv) {
    const extra = options.env ?? {};
    for (const key of Object.keys(extra)) {
        // GIT_CONFIG_* carries the hook and filter overrides; no caller may touch it.
        if (!ENV_NAME_RE.test(key) || key.startsWith('GIT_CONFIG')) {
            throw new errors_1.AgyError('AGY_INTERNAL', `invalid env name ${JSON.stringify(key)}`);
        }
    }
    const nullDevice = host.kind === 'windows-native' ? 'NUL' : '/dev/null';
    const hooks = (0, invocation_1.hookConfig)(nullDevice, options.filterDrivers);
    if (host.kind !== 'wsl-bridge') {
        return {
            file: cmd,
            args: [...args],
            cwd: options.cwd,
            env: { ...(0, invocation_1.scrubEnv)(baseEnv), ...extra, ...hooks },
        };
    }
    (0, invocation_1.assertWslPath)(options.cwd, 'a bridge command directory');
    const wslArgs = [];
    if (host.distro !== undefined)
        wslArgs.push('-d', host.distro);
    wslArgs.push('--cd', options.cwd, '-e', 'env');
    for (const name of invocation_1.BRIDGE_UNSET_VARS)
        wslArgs.push('-u', name);
    for (const [key, value] of Object.entries({ ...extra, ...hooks })) {
        wslArgs.push(`${key}=${value}`);
    }
    wslArgs.push(cmd, ...args);
    return {
        file: 'wsl.exe',
        args: wslArgs,
        cwd: undefined,
        env: (0, invocation_1.scrubEnv)(baseEnv),
    };
}
function runSpawn(spec, stdin, timeoutMs) {
    // Own process group on POSIX, so a timeout also reaches what git started
    // (a credential helper, ssh).
    const group = process.platform !== 'win32';
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(spec.file, [...spec.args], {
            cwd: spec.cwd,
            env: spec.env,
            stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
            detached: group,
            windowsHide: true,
        });
        let closed = false;
        const killAll = () => {
            if (child.pid === undefined || closed)
                return;
            try {
                if (group)
                    process.kill(-child.pid, 'SIGKILL');
                else
                    child.kill('SIGKILL');
            }
            catch {
                // already gone
            }
        };
        // A child that exits before reading stdin must not crash the host.
        child.stdin?.on('error', () => undefined);
        const out = [];
        const err = [];
        let size = 0;
        const collect = (sink) => (chunk) => {
            size += chunk.length;
            if (size > MAX_OUTPUT_BYTES) {
                killAll();
                return;
            }
            sink.push(chunk);
        };
        child.stdout?.on('data', collect(out));
        child.stderr?.on('data', collect(err));
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killAll();
        }, timeoutMs);
        child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            killAll();
            closed = true;
            if (timedOut) {
                reject(new errors_1.AgyError('AGY_INTERNAL', `${spec.file} did not finish within ${timeoutMs} ms`));
                return;
            }
            if (size > MAX_OUTPUT_BYTES) {
                reject(new errors_1.AgyError('AGY_INTERNAL', `${spec.file} printed more than ${MAX_OUTPUT_BYTES} bytes`));
                return;
            }
            const stdoutBytes = Buffer.concat(out);
            resolve({
                code,
                stdout: stdoutBytes.toString('utf8'),
                stdoutBytes,
                stderr: Buffer.concat(err).toString('utf8'),
            });
        });
        if (stdin !== undefined)
            child.stdin?.end(stdin);
    });
}
/** The real HostExec for `host`. */
function createHostExec(host, baseEnv = process.env) {
    const run = (cmd, args, options, filterDrivers = []) => runSpawn(hostCommand(host, cmd, args, { ...options, filterDrivers }, baseEnv), options.stdin, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // Reading config runs no filter, so discovery itself needs none turned off.
    const discover = async (cwd) => {
        const res = await run('git', ['config', '--name-only', '--get-regexp', '^filter\\.'], { cwd });
        // Exit 1 with no output means no filter.* key is set.
        if (res.code === 1 && res.stdout === '')
            return [];
        if (res.code !== 0) {
            throw new errors_1.AgyError('AGY_WORKTREE', `reading the repository's git filter config failed: ${res.stderr.trim() || `exit ${res.code}`}`);
        }
        return (0, invocation_1.filterDriverNames)(res.stdout);
    };
    return {
        host,
        async git(args, options) {
            return run('git', args, options, await discover(options.cwd));
        },
        filterDrivers: discover,
        async writeFile(filePath, content) {
            if (host.kind !== 'wsl-bridge') {
                fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
                fs.writeFileSync(filePath, content, { mode: 0o600 });
                return;
            }
            const dir = path.posix.dirname(filePath);
            const mk = await run('mkdir', ['-p', '-m', '700', '--', dir], {
                cwd: '/',
            });
            if (mk.code !== 0)
                throw new errors_1.AgyError('AGY_BRIDGE', `mkdir ${dir} failed in WSL: ${mk.stderr.trim()}`);
            // tee writes stdin to the file without a shell; its echo is discarded.
            const res = await run('tee', ['--', filePath], {
                cwd: '/',
                stdin: content,
            });
            if (res.code !== 0)
                throw new errors_1.AgyError('AGY_BRIDGE', `writing ${filePath} in WSL failed: ${res.stderr.trim()}`);
        },
        async removeFile(filePath) {
            if (host.kind !== 'wsl-bridge') {
                fs.rmSync(filePath, { force: true });
                return;
            }
            const res = await run('rm', ['-f', '--', filePath], { cwd: '/' });
            if (res.code !== 0)
                throw new errors_1.AgyError('AGY_BRIDGE', `removing ${filePath} in WSL failed: ${res.stderr.trim()}`);
        },
    };
}
