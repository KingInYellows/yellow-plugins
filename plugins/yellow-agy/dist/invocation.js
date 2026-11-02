"use strict";
/**
 * Builds the one way the CLI spawns agy on each host (contract-v0 "Host
 * bridge" and the hard rules). Pure: it returns an argv array and an env
 * object and never spawns anything. Every spawn in the CLI goes through
 * buildInvocation, so the env scrub, the hook-disabling git config and the
 * permission-flag guard cannot be skipped.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIDGE_GROUP_SCRIPT = exports.BRIDGE_PGID_MARKER = exports.WINDOWS_ARGV_LIMIT = exports.BRIDGE_UNSET_VARS = exports.AUTH_MODE_VARS = void 0;
exports.bridgeKillCommand = bridgeKillCommand;
exports.assertWslPath = assertWslPath;
exports.filterDriverNames = filterDriverNames;
exports.hookConfig = hookConfig;
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
/**
 * Unset inside WSL on the bridge, where the Windows-side scrub (which drops
 * every GIT_* name) can't reach the distro's own environment. `env` can't
 * unset by prefix, so this lists every variable git(1) documents that runs a
 * program, reroutes the repository or config, or writes files.
 * GIT_CONFIG_PARAMETERS (what `git -c` sets) overrides GIT_CONFIG_COUNT.
 */
exports.BRIDGE_UNSET_VARS = [
    ...exports.AUTH_MODE_VARS,
    // Config sources.
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_NOSYSTEM',
    // Repository routing.
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
    'GIT_CEILING_DIRECTORIES',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    'GIT_ATTR_SOURCE',
    'GIT_REPLACE_REF_BASE',
    'GIT_GRAFT_FILE',
    'GIT_SHALLOW_FILE',
    'GIT_TEMPLATE_DIR',
    // Programs git runs.
    'GIT_EXEC_PATH',
    'GIT_EDITOR',
    'GIT_SEQUENCE_EDITOR',
    'GIT_PAGER',
    'GIT_EXTERNAL_DIFF',
    'GIT_DIFF_OPTS',
    'GIT_ASKPASS',
    'GIT_SSH',
    'GIT_SSH_COMMAND',
    'GIT_SSH_VARIANT',
    'GIT_PROXY_COMMAND',
    'GIT_ALLOW_PROTOCOL',
    'GIT_PROTOCOL_FROM_USER',
    // Trace output goes to a path the variable names.
    'GIT_TRACE',
    'GIT_TRACE2',
    'GIT_TRACE2_EVENT',
    'GIT_TRACE2_PERF',
    'GIT_TRACE_PACKET',
    'GIT_TRACE_PACKFILE',
    'GIT_TRACE_PERFORMANCE',
    'GIT_TRACE_SETUP',
    'GIT_TRACE_SHALLOW',
    'GIT_TRACE_CURL',
    'GIT_TRACE_FSMONITOR',
    'GIT_TRACE_REFS',
];
/** Flags the CLI never passes, whatever the caller asks for. */
const FORBIDDEN_FLAGS = ['--dangerously-skip-permissions'];
/** Windows caps a command line at 32,767 characters; keep a margin. */
exports.WINDOWS_ARGV_LIMIT = 30_000;
/** Prefix of the first stderr line a bridge turn prints: its Linux pgid. */
exports.BRIDGE_PGID_MARKER = 'yellow-agy-pgid:';
// Fixed script, arguments passed positionally: no shell re-parses argv.
exports.BRIDGE_GROUP_SCRIPT = `printf '${exports.BRIDGE_PGID_MARKER}%s\\n' "$$" >&2; exec "$@"`;
/** `wsl.exe … kill -s <sig> -- -<pgid>`: signals a bridge turn's Linux group. */
function bridgeKillCommand(distro, pgid, sig) {
    if (!Number.isInteger(pgid) || pgid <= 1) {
        throw new errors_1.AgyError('AGY_INTERNAL', `invalid Linux pgid ${pgid}`);
    }
    const args = [];
    if (distro !== undefined)
        args.push('-d', distro);
    args.push('-e', 'kill', '-s', sig, '--', `-${pgid}`);
    return { file: 'wsl.exe', args };
}
/**
 * Throws unless `wslPath` is absolute, inside the WSL filesystem (not /mnt
 * or below), and free of `.`, `..` and empty segments, so the string check
 * sees the real path. A symlink into /mnt can't be seen from here; setup
 * checks the worktree root with realpath inside WSL.
 */
function assertWslPath(wslPath, what) {
    const segments = wslPath.split('/');
    if (!wslPath.startsWith('/') ||
        wslPath === '/mnt' ||
        wslPath.startsWith('/mnt/') ||
        segments.some((seg, i) => seg === '.' || seg === '..' || (seg === '' && i > 0 && wslPath !== '/'))) {
        throw new errors_1.AgyError('AGY_BRIDGE', `${what} must be an absolute path inside the WSL filesystem, not ${JSON.stringify(wslPath)}`);
    }
}
const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FILTER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/**
 * Driver names from `git config --name-only --get-regexp '^filter\.'`
 * output (lines like `filter.lfs.clean`; a name may itself hold dots, so the
 * key is the last segment). Throws on any line of another shape, so a
 * discovery result that isn't what we expect fails closed.
 */
function filterDriverNames(configOutput) {
    const names = new Set();
    for (const raw of configOutput.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (line === '')
            continue;
        const m = /^filter\.(.+)\.([a-z]+)$/.exec(line);
        if (m === null || m[1] === undefined) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `unexpected git filter config line ${JSON.stringify(line)}`);
        }
        names.add(m[1]);
    }
    return [...names].sort();
}
/**
 * Config every git child sees (defense in depth: no profile allows git, but a
 * granted test command or the adapter's own host calls may run it): no hooks,
 * fsmonitor, editors, signing programs or submodule recursion, and every named
 * filter driver emptied (its clean/smudge/process commands run on status and
 * add).
 */
function hookConfig(nullDevice, filterDrivers) {
    const pairs = [
        ['core.hooksPath', nullDevice],
        ['core.fsmonitor', 'false'],
        // `git commit --edit` runs the editor; `true` exits 0 without editing.
        ['core.editor', 'true'],
        ['sequence.editor', 'true'],
        // `git commit -S` runs the signer.
        ['commit.gpgSign', 'false'],
        ['gpg.program', 'false'],
        ['gpg.ssh.program', 'false'],
        ['gpg.x509.program', 'false'],
        // Submodules have their own config (filters, fsmonitor) we can't see.
        ['diff.ignoreSubmodules', 'all'],
        ['status.submoduleSummary', 'false'],
    ];
    for (const name of new Set(filterDrivers)) {
        if (!FILTER_NAME_RE.test(name)) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `the repository's git config defines a filter driver yellow-agy can't turn off safely: ${JSON.stringify(name)}`);
        }
        for (const key of ['clean', 'smudge', 'process']) {
            pairs.push([`filter.${name}.${key}`, '']);
        }
        pairs.push([`filter.${name}.required`, 'false']);
    }
    const out = {
        GIT_CONFIG_COUNT: String(pairs.length),
    };
    pairs.forEach(([key, value], i) => {
        out[`GIT_CONFIG_KEY_${i}`] = key;
        out[`GIT_CONFIG_VALUE_${i}`] = value;
    });
    return out;
}
/**
 * A copy of `env` without the auth-mode variables, WSLENV forwarding, or any
 * GIT_* variable (config overrides and repository routing such as GIT_DIR
 * would point git somewhere other than the worktree).
 */
function scrubEnv(env) {
    const out = {};
    const drop = new Set([...exports.AUTH_MODE_VARS, 'WSLENV']);
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined)
            continue;
        // Windows env names are case-insensitive, so compare upper-cased.
        if (drop.has(key.toUpperCase()))
            continue;
        if (key.toUpperCase().startsWith('GIT_'))
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
        let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
        // Inside quotes, trailing backslashes are doubled before the closing quote.
        if (needsQuotes)
            escaped = escaped.replace(/(\\+)$/, '$1$1');
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
            env: { ...env, ...hookConfig('/dev/null', options.filterDrivers) },
        };
    }
    if (host.kind === 'windows-native') {
        const inv = {
            file: 'agy.exe',
            args: [...agyArgs],
            cwd: options.cwd,
            env: { ...env, ...hookConfig('NUL', options.filterDrivers) },
        };
        checkWindowsLength(inv);
        return inv;
    }
    const wslCwd = options.cwd;
    assertWslPath(wslCwd, 'the bridge worktree');
    const args = [];
    if (host.distro !== undefined) {
        if (!DISTRO_RE.test(host.distro)) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `invalid WSL distro name ${JSON.stringify(host.distro)}`);
        }
        args.push('-d', host.distro);
    }
    // Exec-only: -e runs env directly, so no distro shell re-parses argv.
    args.push('--cd', wslCwd, '-e', 'env');
    for (const name of exports.BRIDGE_UNSET_VARS)
        args.push('-u', name);
    for (const [key, value] of Object.entries(hookConfig('/dev/null', options.filterDrivers))) {
        args.push(`${key}=${value}`);
    }
    // setsid makes the shell (then agy, via exec) lead a new Linux group.
    args.push('setsid', '-w', 'sh', '-c', exports.BRIDGE_GROUP_SCRIPT, 'sh');
    args.push('agy', ...agyArgs);
    const inv = {
        file: 'wsl.exe',
        args,
        cwd: undefined,
        env,
        linuxGroup: host.distro === undefined ? {} : { distro: host.distro },
    };
    checkWindowsLength(inv);
    return inv;
}
function checkWindowsLength(inv) {
    const length = windowsCommandLineLength(inv.file, inv.args);
    if (length > exports.WINDOWS_ARGV_LIMIT) {
        throw new errors_1.AgyError('AGY_PROMPT_TOO_LONG', `the agy command line would be ${length} characters; the limit is ${exports.WINDOWS_ARGV_LIMIT}`);
    }
}
