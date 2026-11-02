"use strict";
/**
 * Builds the one way the CLI spawns agy on each host (contract-v0 "Host
 * bridge" and the hard rules). Pure: it returns an argv array and an env
 * object and never spawns anything. Every spawn in the CLI goes through
 * buildInvocation, so the env scrub, the hook-disabling git config and the
 * permission-flag guard cannot be skipped.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WINDOWS_ARGV_LIMIT = exports.AUTH_MODE_VARS = void 0;
exports.scrubEnv = scrubEnv;
exports.authModeVarsSet = authModeVarsSet;
exports.windowsCommandLineLength = windowsCommandLineLength;
exports.buildInvocation = buildInvocation;
const errors_1 = require("./errors");
/** Variables that switch agy off the subscription sign-in. */
exports.AUTH_MODE_VARS = [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'AGY_ADC_AUTH',
];
/** Flags the CLI never passes, whatever the caller asks for. */
const FORBIDDEN_FLAGS = ['--dangerously-skip-permissions'];
/** Windows caps a command line at 32,767 characters; keep a margin. */
exports.WINDOWS_ARGV_LIMIT = 30_000;
const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function hookConfig(nullDevice) {
    return {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: nullDevice,
    };
}
/** A copy of `env` without the auth-mode variables or WSLENV forwarding. */
function scrubEnv(env) {
    const out = {};
    const drop = new Set([...exports.AUTH_MODE_VARS, 'WSLENV']);
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined)
            continue;
        // Windows env names are case-insensitive, so compare upper-cased.
        if (drop.has(key.toUpperCase()))
            continue;
        if (key.toUpperCase().startsWith('GIT_CONFIG_'))
            continue;
        out[key] = value;
    }
    return out;
}
/** Names (never values) of auth-mode variables set in `env`. */
function authModeVarsSet(env) {
    const set = new Set();
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined || value === '')
            continue;
        const upper = key.toUpperCase();
        if (exports.AUTH_MODE_VARS.includes(upper))
            set.add(upper);
    }
    return [...set].sort();
}
function assertNoForbiddenFlags(agyArgs) {
    for (const arg of agyArgs) {
        for (const flag of FORBIDDEN_FLAGS) {
            if (arg === flag || arg.startsWith(`${flag}=`)) {
                throw new errors_1.AgyError('AGY_INTERNAL', `refusing to build an agy invocation with ${flag}`);
            }
        }
    }
}
/**
 * Length of the Windows command line CreateProcess would see, counting a
 * space between arguments and the quotes and escapes Node adds.
 */
function windowsCommandLineLength(file, args) {
    let total = 0;
    for (const arg of [file, ...args]) {
        const needsQuotes = arg === '' || /[\s"]/.test(arg);
        const escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
        total += escaped.length + (needsQuotes ? 2 : 0) + 1;
    }
    return total - 1;
}
function buildInvocation(host, agyArgs, options) {
    assertNoForbiddenFlags(agyArgs);
    const env = scrubEnv(options.baseEnv);
    if (host.kind === 'posix') {
        return {
            file: 'agy',
            args: [...agyArgs],
            cwd: options.cwd,
            env: { ...env, ...hookConfig('/dev/null') },
        };
    }
    if (host.kind === 'windows-native') {
        const inv = {
            file: 'agy.exe',
            args: [...agyArgs],
            cwd: options.cwd,
            env: { ...env, ...hookConfig('NUL') },
        };
        checkWindowsLength(inv);
        return inv;
    }
    const wslCwd = options.cwd;
    if (!wslCwd.startsWith('/') || wslCwd.startsWith('/mnt/')) {
        throw new errors_1.AgyError('AGY_BRIDGE', `the bridge worktree must be an absolute path inside the WSL filesystem, not ${JSON.stringify(wslCwd)}`);
    }
    const args = [];
    if (host.distro !== undefined) {
        if (!DISTRO_RE.test(host.distro)) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `invalid WSL distro name ${JSON.stringify(host.distro)}`);
        }
        args.push('-d', host.distro);
    }
    // Exec-only: -e runs env directly, so no distro shell re-parses argv.
    args.push('--cd', wslCwd, '-e', 'env');
    for (const name of exports.AUTH_MODE_VARS)
        args.push('-u', name);
    for (const [key, value] of Object.entries(hookConfig('/dev/null'))) {
        args.push(`${key}=${value}`);
    }
    args.push('agy', ...agyArgs);
    const inv = { file: 'wsl.exe', args, cwd: undefined, env };
    checkWindowsLength(inv);
    return inv;
}
function checkWindowsLength(inv) {
    const length = windowsCommandLineLength(inv.file, inv.args);
    if (length > exports.WINDOWS_ARGV_LIMIT) {
        throw new errors_1.AgyError('AGY_PROMPT_TOO_LONG', `the agy command line would be ${length} characters; the limit is ${exports.WINDOWS_ARGV_LIMIT}`);
    }
}
