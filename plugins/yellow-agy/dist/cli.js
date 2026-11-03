"use strict";
/**
 * The yellow-agy CLI (contract-v0 "Output envelope, exit codes"): one JSON
 * object on stdout, exit 0/1/2. Commands under commands/agy/ call it with
 * `node dist/cli.js <operation> …`.
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
exports.main = main;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_util_1 = require("node:util");
const errors_1 = require("./errors");
const grants_1 = require("./grants");
const host_config_1 = require("./host-config");
const host_exec_1 = require("./host-exec");
const invocation_1 = require("./invocation");
const lifecycle_1 = require("./lifecycle");
const process_1 = require("./process");
const quota_1 = require("./quota");
const redact_1 = require("./redact");
const state_1 = require("./state");
const tty_1 = require("./tty");
const worktree_1 = require("./worktree");
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_TEXT_BYTES = 100_000;
/**
 * The command wrappers' Bash timeout is 600 s. The quota probe (60 s + 10 s
 * kill grace) and the turn (print timeout + 30 s slack + 10 s grace) both run
 * inside it, so 420 leaves about 70 s for git and node.
 */
const DEFAULT_PRINT_TIMEOUT_S = 420;
const MAX_PRINT_TIMEOUT_S = 420;
const DEADLINE_SLACK_MS = 30_000;
function usage(message) {
    return new errors_1.AgyError('AGY_INVALID_INPUT', message);
}
function str(v, flag) {
    if (typeof v !== 'string' || v === '')
        throw usage(`missing ${flag}`);
    return v;
}
function int(v, flag) {
    if (v === undefined)
        return undefined;
    if (typeof v !== 'string' || !/^\d{1,6}$/.test(v)) {
        throw usage(`${flag} must be a whole number`);
    }
    return Number(v);
}
function requestId(v) {
    if (v === undefined)
        return `req-${(0, node_crypto_1.randomBytes)(8).toString('hex')}`;
    if (typeof v !== 'string' || !REQUEST_ID_RE.test(v)) {
        throw usage('--request-id must match [A-Za-z0-9._:-]{1,200}');
    }
    return v;
}
/** Free text from a file the wrapper wrote; never from argv. */
function readText(file, flag) {
    const p = str(file, flag);
    let st;
    try {
        st = fs.lstatSync(p);
    }
    catch {
        throw usage(`${flag} ${p} does not exist`);
    }
    if (!st.isFile() || st.size === 0 || st.size > MAX_TEXT_BYTES) {
        throw usage(`${flag} must be a regular file of 1-${MAX_TEXT_BYTES} bytes`);
    }
    return fs.readFileSync(p, 'utf8');
}
function printTimeoutSeconds(env) {
    const raw = env['YELLOW_AGY_PRINT_TIMEOUT_SECONDS'];
    if (raw === undefined || raw === '')
        return DEFAULT_PRINT_TIMEOUT_S;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 60 || n > MAX_PRINT_TIMEOUT_S) {
        throw usage(`YELLOW_AGY_PRINT_TIMEOUT_SECONDS must be 60-${MAX_PRINT_TIMEOUT_S}`);
    }
    return n;
}
/** The repo path as agy's filesystem sees it, symlinks resolved. */
function canonicalRepo(config, repo, wslRun) {
    if (config.host.kind !== 'wsl-bridge') {
        try {
            return fs.realpathSync(path.resolve(repo));
        }
        catch {
            throw usage(`--repo ${repo} does not exist`);
        }
    }
    (0, invocation_1.assertWslPath)(repo, '--repo');
    const run = wslRun ??
        ((distro, args) => {
            const argv = distro === undefined ? ['-e', ...args] : ['-d', distro, '-e', ...args];
            return (0, node_child_process_1.execFileSync)('wsl.exe', argv, {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 60_000,
            })
                .replace(/\r/g, '')
                .trim();
        });
    let real;
    try {
        real = run(config.host.distro, ['realpath', '-e', '--', repo]);
    }
    catch {
        throw usage(`--repo ${repo} does not exist in WSL`);
    }
    (0, invocation_1.assertWslPath)(real, '--repo');
    return real;
}
/** The latest-expiring live grant that covers a new task. */
function coveringGrant(j, repo, branch, now) {
    return Object.values((0, grants_1.grants)(j))
        .filter((g) => g.revokedAt === undefined &&
        !(0, grants_1.grantExpired)(g, now) &&
        g.repo === repo &&
        g.operations.includes('create') &&
        g.totalTasks < g.maxTotalTasks &&
        (0, grants_1.branchMatches)(g.branchPattern, branch))
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
        .pop();
}
function noGrant(repo, branch) {
    return new errors_1.AgyError('AGY_AUTHORITY_DENIED', `no live grant covers ${repo} on branch ${branch}`, `Run /agy:authorize --repo ${JSON.stringify(repo)} --branch ${JSON.stringify(branch)} for the command the owner runs in a terminal, then retry.`);
}
function lifecycleFor(ctx, config, grant, probeCwd) {
    const exec = (0, host_exec_1.createHostExec)(config.host, ctx.deps.env);
    const printTimeout = printTimeoutSeconds(ctx.deps.env);
    const deps = {
        host: config.host,
        exec,
        dataDir: ctx.dir,
        worktreeRoot: config.worktreeRoot,
        schemaPath: config.schemaPath,
        baseEnv: ctx.deps.env,
        runTurn: process_1.runTurn,
        // Without a grant the Lifecycle only recovers a dead run; it never
        // reaches a turn.
        quotaGate: grant === undefined
            ? async () => {
                throw new errors_1.AgyError('AGY_INTERNAL', 'no grant for a model turn');
            }
            : (0, quota_1.quotaGate)({
                host: config.host,
                cwd: probeCwd,
                baseEnv: ctx.deps.env,
                filterDrivers: () => exec.filterDrivers(probeCwd),
                minQuotaPercent: grant.minQuotaPercent,
                runTurn: process_1.runTurn,
            }),
        allowCommands: grant?.allowCommands ?? [],
        sandboxVerified: config.sandboxVerified,
        printTimeoutSeconds: printTimeout,
        deadlineMs: printTimeout * 1000 + DEADLINE_SLACK_MS,
        ...(grant === undefined ? {} : { grantId: grant.grantId }),
        now: ctx.now,
    };
    return (ctx.deps.lifecycle ?? ((d) => new lifecycle_1.Lifecycle(d)))(deps);
}
/** The grant a task was created under; it governs every later call. */
function taskGrant(j, localId) {
    const task = (0, state_1.getTask)(j, localId);
    const grant = task.grantId === undefined ? undefined : (0, grants_1.grants)(j)[task.grantId];
    if (grant === undefined) {
        throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', `task ${localId} has no grant on this host`);
    }
    return grant;
}
async function authorize(ctx, flags) {
    const now = ctx.now();
    if (flags['list'] === true) {
        return { grants: (0, grants_1.listGrants)((0, state_1.readJournal)(ctx.dir), now) };
    }
    if (flags['revoke'] !== undefined) {
        const id = str(flags['revoke'], '--revoke');
        return (0, state_1.updateJournal)(ctx.dir, (j) => {
            const next = (0, grants_1.revokeGrant)(j, id, now);
            return {
                journal: next,
                result: { grantId: id, revokedAt: (0, grants_1.grants)(next)[id]?.revokedAt },
            };
        });
    }
    const config = (0, host_config_1.readHostConfig)(ctx.dir);
    const commands = flags['allow-command'];
    const minQuota = int(flags['min-quota-percent'], '--min-quota-percent');
    const maxTasks = int(flags['max-tasks'], '--max-tasks');
    const rounds = int(flags['max-corrective-rounds'], '--max-corrective-rounds');
    const ttl = int(flags['ttl-minutes'], '--ttl-minutes');
    const grant = (0, grants_1.buildGrant)({
        repo: canonicalRepo(config, str(flags['repo'], '--repo'), ctx.deps.wslRun),
        branchPattern: str(flags['branch'], '--branch'),
        operations: flags['operations'] === undefined
            ? 'create,approve,reply,collect'
            : str(flags['operations'], '--operations'),
        ...(Array.isArray(commands) ? { allowCommands: commands } : {}),
        ...(minQuota === undefined ? {} : { minQuotaPercent: minQuota }),
        ...(maxTasks === undefined ? {} : { maxTotalTasks: maxTasks }),
        ...(rounds === undefined ? {} : { maxCorrectiveRounds: rounds }),
        ...(ttl === undefined ? {} : { ttlMinutes: ttl }),
    }, now);
    // Confirm before taking the lock, so a waiting owner never holds it.
    await (0, tty_1.confirmOnTty)({
        summary: (0, grants_1.grantSummary)(grant),
        ...(ctx.deps.openTty === undefined ? {} : { openTty: ctx.deps.openTty }),
    });
    await (0, state_1.updateJournal)(ctx.dir, (j) => ({
        journal: (0, grants_1.putGrant)(j, grant),
        result: undefined,
    }));
    return { grant };
}
async function run(ctx, op, flags) {
    switch (op) {
        case 'setup': {
            const config = (0, host_config_1.detectHost)({
                env: ctx.deps.env,
                ...(ctx.deps.wslRun === undefined ? {} : { wslRun: ctx.deps.wslRun }),
            });
            (0, host_config_1.writeHostConfig)(ctx.dir, config);
            return { host: config.host, worktreeRoot: config.worktreeRoot };
        }
        case 'authorize':
            return authorize(ctx, flags);
        case 'status':
        case 'list': {
            const j = (0, state_1.readJournal)(ctx.dir);
            const id = flags['task'];
            const tasks = typeof id === 'string'
                ? [(0, state_1.getTask)(j, id)]
                : Object.values(j.tasks).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            return {
                tasks: tasks.map(({ plan, ...t }) => ({
                    ...t,
                    ...(plan === undefined ? {} : { plan }),
                })),
                ...(j.activeRun === undefined ? {} : { activeRun: j.activeRun }),
            };
        }
        case 'delegate': {
            const config = (0, host_config_1.readHostConfig)(ctx.dir);
            const repo = canonicalRepo(config, str(flags['repo'], '--repo'), ctx.deps.wslRun);
            const branch = (0, worktree_1.validateBranchName)(str(flags['branch'], '--branch'));
            const base = (0, worktree_1.validateBranchName)(str(flags['base'], '--base'));
            const remote = flags['remote'] ?? 'origin';
            if (!REMOTE_RE.test(remote))
                throw usage('--remote is not a remote name');
            const prompt = readText(flags['prompt-file'], '--prompt-file');
            const rid = requestId(flags['request-id']);
            // A dead run may hold a task its grant should get back, and a retry
            // of a finished delegate replays its outcome whatever the grant's
            // state now; both come before a grant is chosen.
            await lifecycleFor(ctx, config, undefined, repo).recover();
            const j = (0, state_1.readJournal)(ctx.dir);
            const prior = (0, state_1.own)(j.requests, rid);
            if (prior?.op === 'delegate' && prior.status === 'done') {
                return prior.outcome;
            }
            const grant = coveringGrant(j, repo, branch, ctx.now());
            if (grant === undefined)
                throw noGrant(repo, branch);
            return lifecycleFor(ctx, config, grant, repo).delegate({
                requestId: rid,
                branch,
                prompt,
                repo,
                remote,
                baseBranch: base,
            });
        }
        case 'approve':
        case 'reply':
        case 'collect':
        case 'abandon': {
            const config = (0, host_config_1.readHostConfig)(ctx.dir);
            const localId = str(flags['task'], '--task');
            await lifecycleFor(ctx, config, undefined, ctx.dir).recover();
            const j = (0, state_1.readJournal)(ctx.dir);
            const task = (0, state_1.getTask)(j, localId);
            // Abandon is confirmed on the terminal instead, so it works for a task
            // whose grant is gone or that predates grants.
            const grant = op === 'abandon' ? undefined : taskGrant(j, localId);
            const life = lifecycleFor(ctx, config, grant, task.worktree);
            const partial = {
                keepPartial: flags['keep-partial'] === true,
                resetPartial: flags['reset-partial'] === true,
            };
            if (op === 'approve') {
                return life.approve({
                    requestId: requestId(flags['request-id']),
                    localId,
                    ...partial,
                });
            }
            if (op === 'reply') {
                return life.reply({
                    requestId: requestId(flags['request-id']),
                    localId,
                    message: readText(flags['message-file'], '--message-file'),
                    correction: flags['correction'] === true,
                    ...partial,
                });
            }
            if (op === 'collect')
                return life.collect(localId);
            await (0, tty_1.confirmOnTty)({
                summary: [
                    'yellow-agy: abandon a task',
                    `  task:      ${localId}`,
                    `  branch:    ${task.branch} (kept)`,
                    `  worktree:  ${task.worktree} (collected, then removed)`,
                ].join('\n'),
                ...(ctx.deps.openTty === undefined
                    ? {}
                    : { openTty: ctx.deps.openTty }),
            });
            return life.abandon({
                requestId: requestId(flags['request-id']),
                localId,
            });
        }
        default:
            throw usage(`unknown operation ${JSON.stringify(op)}`);
    }
}
/** Every string in the envelope redacted, shape kept. */
function redactDeep(value) {
    if (typeof value === 'string')
        return (0, redact_1.redact)(value);
    if (Array.isArray(value))
        return value.map(redactDeep);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
    }
    return value;
}
const OPTIONS = {
    repo: { type: 'string' },
    branch: { type: 'string' },
    base: { type: 'string' },
    remote: { type: 'string' },
    task: { type: 'string' },
    'prompt-file': { type: 'string' },
    'message-file': { type: 'string' },
    'request-id': { type: 'string' },
    correction: { type: 'boolean' },
    'keep-partial': { type: 'boolean' },
    'reset-partial': { type: 'boolean' },
    operations: { type: 'string' },
    'allow-command': { type: 'string', multiple: true },
    'min-quota-percent': { type: 'string' },
    'max-tasks': { type: 'string' },
    'max-corrective-rounds': { type: 'string' },
    'ttl-minutes': { type: 'string' },
    list: { type: 'boolean' },
    revoke: { type: 'string' },
};
/** Runs one operation and returns the exit code. */
async function main(argv, deps) {
    const op = argv[0] ?? '';
    const now = deps.now ?? (() => new Date());
    try {
        const { values } = (0, node_util_1.parseArgs)({
            args: argv.slice(1),
            options: OPTIONS,
            strict: true,
            allowPositionals: false,
        });
        const dir = (0, state_1.dataDir)(deps.env);
        (0, state_1.ensureDataDir)(dir);
        const result = (await run({ deps, dir, now }, op, values));
        const code = result['code'];
        const failed = typeof code === 'string';
        const exit = failed ? new errors_1.AgyError(code, '').exit : 0;
        deps.stdout(`${JSON.stringify(redactDeep({ ok: !failed, operation: op, ...result }))}\n`);
        return exit;
    }
    catch (err) {
        const e = err instanceof errors_1.AgyError
            ? err
            : err.code
                ?.toString()
                .startsWith('ERR_PARSE_ARGS')
                ? usage(String(err.message))
                : new errors_1.AgyError('AGY_INTERNAL', String(err));
        deps.stdout(`${JSON.stringify(redactDeep({
            ok: false,
            operation: op,
            error: {
                code: e.code,
                message: e.message,
                recoveryAction: e.recoveryAction,
            },
        }))}\n`);
        return e.exit;
    }
}
if (require.main === module) {
    void main(process.argv.slice(2), {
        env: process.env,
        stdout: (t) => process.stdout.write(t),
    }).then((code) => {
        process.exitCode = code;
    });
}
