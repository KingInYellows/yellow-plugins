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
        if (!ENV_NAME_RE.test(key)) {
            throw new errors_1.AgyError('AGY_INTERNAL', `invalid env name ${JSON.stringify(key)}`);
        }
    }
    const nullDevice = host.kind === 'windows-native' ? 'NUL' : '/dev/null';
    const hooks = {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: nullDevice,
    };
    if (host.kind !== 'wsl-bridge') {
        return {
            file: cmd,
            args: [...args],
            cwd: options.cwd,
            env: { ...(0, invocation_1.scrubEnv)(baseEnv), ...hooks, ...extra },
        };
    }
    if (!options.cwd.startsWith('/') || options.cwd.startsWith('/mnt/')) {
        throw new errors_1.AgyError('AGY_BRIDGE', `bridge commands must run inside the WSL filesystem, not ${JSON.stringify(options.cwd)}`);
    }
    const wslArgs = [];
    if (host.distro !== undefined)
        wslArgs.push('-d', host.distro);
    wslArgs.push('--cd', options.cwd, '-e', 'env');
    for (const [key, value] of Object.entries({ ...hooks, ...extra })) {
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
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(spec.file, [...spec.args], {
            cwd: spec.cwd,
            env: spec.env,
            stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const out = [];
        const err = [];
        let size = 0;
        const collect = (sink) => (chunk) => {
            size += chunk.length;
            if (size > MAX_OUTPUT_BYTES) {
                child.kill('SIGKILL');
                return;
            }
            sink.push(chunk);
        };
        child.stdout?.on('data', collect(out));
        child.stderr?.on('data', collect(err));
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (size > MAX_OUTPUT_BYTES) {
                reject(new errors_1.AgyError('AGY_INTERNAL', `${spec.file} printed more than ${MAX_OUTPUT_BYTES} bytes`));
                return;
            }
            resolve({
                code,
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8'),
            });
        });
        if (stdin !== undefined)
            child.stdin?.end(stdin);
    });
}
/** The real HostExec for `host`. */
function createHostExec(host, baseEnv = process.env) {
    const run = (cmd, args, options) => runSpawn(hostCommand(host, cmd, args, options, baseEnv), options.stdin, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return {
        host,
        git: (args, options) => run('git', args, options),
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
            await run('rm', ['-f', '--', filePath], { cwd: '/' });
        },
    };
}
