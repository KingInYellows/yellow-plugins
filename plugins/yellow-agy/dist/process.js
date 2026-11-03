"use strict";
/**
 * Runs one agy turn as a child process and reports a TurnOutcome for
 * classify.ts. stdin is closed, the child gets its own process group on
 * POSIX so a deadline or cancel reaches agy's tools too, and a deadline sends
 * SIGTERM first (agy then reports "interrupted" with partial text) and
 * SIGKILL after a grace period.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitPgidMarker = splitPgidMarker;
exports.runTurn = runTurn;
const node_child_process_1 = require("node:child_process");
const errors_1 = require("./errors");
const invocation_1 = require("./invocation");
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_GRACE_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;
function defaultSpawnKill(file, args) {
    const k = (0, node_child_process_1.spawn)(file, [...args], { stdio: 'ignore', windowsHide: true });
    k.on('error', () => undefined);
}
/** Stderr bytes to search for the pgid line before giving up on it. */
const MARKER_SCAN_BYTES = 64 * 1024;
/**
 * Splits the bridge's pgid line off `stderr`. WSL may print diagnostics
 * first, so every complete line is checked; the wrapper prints the line
 * before it execs agy, so the first match is always the wrapper's. Returns
 * undefined while the line may still arrive, and no pgid once
 * MARKER_SCAN_BYTES have gone by without it.
 */
function splitPgidMarker(stderr) {
    let start = 0;
    for (;;) {
        const nl = stderr.indexOf(0x0a, start);
        if (nl < 0 || nl >= MARKER_SCAN_BYTES)
            break;
        const line = stderr
            .subarray(start, nl)
            .toString('utf8')
            .replace(/^\0+/, '')
            .replace(/\r$/, '');
        if (line.startsWith(invocation_1.BRIDGE_PGID_MARKER)) {
            const pgid = Number(line.slice(invocation_1.BRIDGE_PGID_MARKER.length));
            return {
                pgid: Number.isInteger(pgid) && pgid > 1 ? pgid : undefined,
                rest: Buffer.concat([
                    stderr.subarray(0, start),
                    stderr.subarray(nl + 1),
                ]),
            };
        }
        start = nl + 1;
    }
    if (stderr.length > MARKER_SCAN_BYTES)
        return { pgid: undefined, rest: stderr };
    return undefined;
}
function runTurn(inv, options) {
    const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    // Node clamps a delay outside 1..2^31-1 ms to 1 ms, which would kill the
    // turn at once.
    const validDelay = (ms) => Number.isFinite(ms) && ms >= 1 && ms <= MAX_TIMER_MS;
    if (!validDelay(options.deadlineMs) || !validDelay(graceMs)) {
        return Promise.reject(new errors_1.AgyError('AGY_INTERNAL', `deadlineMs and graceMs must be between 1 and ${MAX_TIMER_MS} ms`));
    }
    const groupKill = process.platform !== 'win32';
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(inv.file, [...inv.args], {
            cwd: inv.cwd,
            env: inv.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: groupKill,
            windowsHide: true,
        });
        let killedByDeadline = false;
        let cancelled = false;
        let overflow = false;
        let size = 0;
        const out = [];
        const err = [];
        let graceTimer;
        let drainTimer;
        let closed = false;
        let spawnFailed = false;
        let spawnError;
        let spawnDone = Promise.resolve();
        const bridge = inv.linuxGroup;
        let linuxPgid;
        let markerPending = bridge !== undefined;
        const spawnKill = options.spawnKill ?? defaultSpawnKill;
        const killLinux = (sig) => {
            if (bridge === undefined || linuxPgid === undefined)
                return;
            const cmd = (0, invocation_1.bridgeKillCommand)(bridge.distro, linuxPgid, sig === 'SIGKILL' ? 'KILL' : 'TERM');
            try {
                spawnKill(cmd.file, cmd.args);
            }
            catch {
                // best effort; wsl.exe is killed below too
            }
        };
        // After the leader exits, a tool it started can still hold the pipes open,
        // so on POSIX the group stays killable until 'close'. The group id can't be
        // reused while any member is alive.
        const kill = (sig) => {
            if (child.pid === undefined || closed)
                return;
            killLinux(sig);
            // On the bridge a SIGTERM goes to the Linux group only: killing
            // wsl.exe now would orphan agy before its pgid arrives. SIGKILL (after
            // the grace period) still takes wsl.exe down too.
            if (bridge !== undefined && sig === 'SIGTERM')
                return;
            if (!groupKill && child.exitCode !== null)
                return;
            try {
                if (groupKill)
                    process.kill(-child.pid, sig);
                else {
                    // Windows has no groups: taskkill /T takes the tree while the
                    // leader still lives (the drain timer covers what outlives it).
                    if (bridge === undefined) {
                        spawnKill('taskkill', ['/PID', String(child.pid), '/T', '/F']);
                    }
                    child.kill(sig);
                }
            }
            catch {
                // already gone
            }
        };
        const stop = () => {
            kill('SIGTERM');
            graceTimer ??= setTimeout(() => kill('SIGKILL'), graceMs);
        };
        const collect = (sink) => (chunk) => {
            size += chunk.length;
            if (size > MAX_OUTPUT_BYTES) {
                overflow = true;
                kill('SIGKILL');
                return;
            }
            sink.push(chunk);
        };
        child.stdout?.on('data', collect(out));
        const collectErr = collect(err);
        child.stderr?.on('data', (chunk) => {
            collectErr(chunk);
            if (!markerPending)
                return;
            const split = splitPgidMarker(Buffer.concat(err));
            if (split === undefined)
                return;
            markerPending = false;
            linuxPgid = split.pgid;
            err.length = 0;
            if (split.rest.length > 0)
                err.push(split.rest);
            // A stop requested before the pgid arrived reaches the group now.
            if (killedByDeadline || cancelled)
                killLinux('SIGTERM');
        });
        const deadline = setTimeout(() => {
            killedByDeadline = true;
            stop();
        }, options.deadlineMs);
        const onAbort = () => {
            cancelled = true;
            stop();
        };
        if (options.signal?.aborted === true)
            onAbort();
        else
            options.signal?.addEventListener('abort', onAbort, { once: true });
        const cleanup = () => {
            clearTimeout(deadline);
            if (graceTimer !== undefined)
                clearTimeout(graceTimer);
            if (drainTimer !== undefined)
                clearTimeout(drainTimer);
            options.signal?.removeEventListener('abort', onAbort);
        };
        child.on('error', (e) => {
            cleanup();
            reject(e.code === 'ENOENT'
                ? new errors_1.AgyError('AGY_NOT_INSTALLED', `${inv.file} was not found`)
                : e);
        });
        child.on('spawn', () => {
            if (child.pid === undefined || options.onSpawn === undefined)
                return;
            spawnDone = Promise.resolve()
                .then(() => options.onSpawn?.(child.pid))
                .catch((e) => {
                spawnFailed = true;
                spawnError = e;
                cancelled = true;
                stop();
            });
        });
        child.on('exit', () => {
            // agy is done; a tool still in its group would keep 'close' from firing.
            if (groupKill)
                kill('SIGKILL');
            killLinux('SIGKILL');
            // A descendant we could not kill (Windows) may still hold the pipes;
            // stop waiting for it so the turn always settles.
            drainTimer ??= setTimeout(() => {
                child.stdout?.destroy();
                child.stderr?.destroy();
            }, graceMs);
        });
        child.on('close', (code, signal) => {
            closed = true;
            cleanup();
            // Leave nothing behind in the group once the leader is gone.
            if (groupKill && child.pid !== undefined) {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                }
                catch {
                    // group already empty
                }
            }
            void spawnDone.then(() => finish(code, signal));
        });
        const finish = (code, signal) => {
            if (spawnFailed) {
                reject(spawnError);
                return;
            }
            if (overflow) {
                reject(new errors_1.AgyError('AGY_INTERNAL', `agy printed more than ${MAX_OUTPUT_BYTES} bytes`));
                return;
            }
            resolve({
                exitCode: code,
                signal,
                killedByDeadline,
                cancelled,
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8'),
            });
        };
    });
}
