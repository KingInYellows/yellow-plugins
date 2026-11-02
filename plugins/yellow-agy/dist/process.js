"use strict";
/**
 * Runs one agy turn as a child process and reports a TurnOutcome for
 * classify.ts. stdin is closed, the child gets its own process group on
 * POSIX so a deadline or cancel reaches agy's tools too, and a deadline sends
 * SIGTERM first (agy then reports "interrupted" with partial text) and
 * SIGKILL after a grace period.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTurn = runTurn;
const node_child_process_1 = require("node:child_process");
const errors_1 = require("./errors");
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_GRACE_MS = 10_000;
function runTurn(inv, options) {
    if (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0) {
        return Promise.reject(new errors_1.AgyError('AGY_INTERNAL', 'deadlineMs must be a positive number'));
    }
    const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
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
        let closed = false;
        // After the leader exits, a tool it started can still hold the pipes open,
        // so on POSIX the group stays killable until 'close'. The group id can't be
        // reused while any member is alive.
        const kill = (sig) => {
            if (child.pid === undefined || closed)
                return;
            if (!groupKill && child.exitCode !== null)
                return;
            try {
                if (groupKill)
                    process.kill(-child.pid, sig);
                else
                    child.kill(sig);
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
        child.stderr?.on('data', collect(err));
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
            options.signal?.removeEventListener('abort', onAbort);
        };
        child.on('error', (e) => {
            cleanup();
            reject(e.code === 'ENOENT'
                ? new errors_1.AgyError('AGY_NOT_INSTALLED', `${inv.file} was not found`)
                : e);
        });
        child.on('spawn', () => {
            if (child.pid !== undefined)
                options.onSpawn?.(child.pid);
        });
        child.on('exit', () => {
            // agy is done; a tool still in its group would keep 'close' from firing.
            if (groupKill)
                kill('SIGKILL');
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
        });
    });
}
