"use strict";
/**
 * The sole human-confirmation primitive (R29): a runtime-owned challenge on
 * the controlling terminal. The runtime opens `/dev/tty` itself, prints the
 * redacted summary and a random 6-character code there, and requires the
 * owner to type the code back. A caller with no controlling terminal — the
 * agent's Bash tool, a Codex sandbox, the engine's closed-stdin interface, CI —
 * cannot satisfy it. Whether stdin is a TTY is never consulted.
 *
 * Nothing is written to stdout or stderr and the code is never logged,
 * returned, or placed in an envelope. Tests inject `openTty`; the real
 * `/dev/tty` path is exercised only in the manual smoke.
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
exports.DEFAULT_CONFIRM_DEADLINE_MS = exports.CHALLENGE_LENGTH = void 0;
exports.mintChallenge = mintChallenge;
exports.defaultOpenTty = defaultOpenTty;
exports.confirmOnTty = confirmOnTty;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const tty = __importStar(require("node:tty"));
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
/** Unambiguous base32 (no 0/O/1/I): 32 symbols, so `byte & 31` is unbiased. */
const CHALLENGE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
exports.CHALLENGE_LENGTH = 6;
exports.DEFAULT_CONFIRM_DEADLINE_MS = 120_000;
function mintChallenge() {
    const bytes = crypto.randomBytes(exports.CHALLENGE_LENGTH);
    let code = '';
    for (const byte of bytes)
        code += CHALLENGE_ALPHABET[byte & 31];
    return code;
}
function constantTimeEqual(a, b) {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    const length = Math.max(left.length, right.length, 1);
    const paddedLeft = Buffer.alloc(length);
    const paddedRight = Buffer.alloc(length);
    left.copy(paddedLeft);
    right.copy(paddedRight);
    return (crypto.timingSafeEqual(paddedLeft, paddedRight) &&
        left.length === right.length);
}
const RETRY_RECOVERY = 'Nothing was changed. Run the command again in a terminal and type the code exactly as shown.';
const NO_TTY_RECOVERY = 'Run this command yourself in a terminal on the controller host; an agent without a controlling terminal cannot confirm it.';
/** Opens `/dev/tty` read-write; failure to open means the caller has no controlling terminal. */
function defaultOpenTty() {
    const fd = fs.openSync('/dev/tty', fs.constants.O_RDWR);
    const input = new tty.ReadStream(fd);
    let buffered = '';
    let ended = false;
    const waiters = [];
    const wake = () => {
        for (const waiter of waiters.splice(0))
            waiter();
    };
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
        buffered += chunk;
        wake();
    });
    input.on('end', () => {
        ended = true;
        wake();
    });
    input.on('error', () => {
        ended = true;
        wake();
    });
    return {
        write(text) {
            fs.writeSync(fd, text);
        },
        readLine(deadlineMs) {
            const stopAt = Date.now() + deadlineMs;
            return new Promise((resolve, reject) => {
                const check = () => {
                    const newline = buffered.search(/\r|\n/);
                    if (newline !== -1) {
                        const line = buffered.slice(0, newline);
                        buffered = '';
                        resolve(line);
                        return;
                    }
                    if (ended) {
                        resolve(null);
                        return;
                    }
                    const remaining = stopAt - Date.now();
                    if (remaining <= 0) {
                        reject(new Error('timeout'));
                        return;
                    }
                    const timer = setTimeout(check, remaining);
                    waiters.push(() => {
                        clearTimeout(timer);
                        check();
                    });
                };
                check();
            });
        },
        close() {
            input.destroy();
        },
    };
}
function isNoTerminal(err) {
    const code = err.code;
    return code === 'ENXIO' || code === 'ENOENT' || code === 'EACCES';
}
/**
 * Resolves only when the owner typed the exact challenge code. Every other
 * outcome throws: no terminal -> JULES_CONFIRMATION_REQUIRED, win32 ->
 * JULES_UNSUPPORTED_CAPABILITY, wrong code or EOF -> JULES_AUTHORITY_DENIED,
 * no answer in time -> JULES_DEADLINE_EXCEEDED.
 */
async function confirmOnTty(options) {
    if ((options.platform ?? process.platform) === 'win32') {
        return (0, errors_js_1.throwAppError)('JULES_UNSUPPORTED_CAPABILITY', 'terminal confirmation needs /dev/tty, which this platform does not provide');
    }
    let handle;
    try {
        handle = (options.openTty ?? defaultOpenTty)();
    }
    catch (err) {
        if (isNoTerminal(err)) {
            return (0, errors_js_1.throwAppError)('JULES_CONFIRMATION_REQUIRED', 'no controlling terminal is available to confirm this operation', { recoveryAction: NO_TTY_RECOVERY });
        }
        throw err;
    }
    const code = mintChallenge();
    try {
        handle.write(`\n${(0, redact_js_1.redact)(options.summary)}\n\nType ${code} to confirm, anything else to cancel: `);
        let answer;
        try {
            answer = await handle.readLine(options.deadlineMs);
        }
        catch (err) {
            if (err instanceof Error && err.message === 'timeout') {
                return (0, errors_js_1.throwAppError)('JULES_DEADLINE_EXCEEDED', 'no confirmation was typed before the deadline; nothing was changed', {
                    recoveryAction: 'Run the command again and type the code shown within the time limit.',
                });
            }
            throw err;
        }
        if (answer === null) {
            return (0, errors_js_1.throwAppError)('JULES_AUTHORITY_DENIED', 'the terminal closed before a confirmation was typed', { recoveryAction: RETRY_RECOVERY });
        }
        if (!constantTimeEqual(answer.trim().toUpperCase(), code)) {
            return (0, errors_js_1.throwAppError)('JULES_AUTHORITY_DENIED', 'the confirmation code did not match; nothing was changed', { recoveryAction: RETRY_RECOVERY });
        }
        handle.write('\nConfirmed.\n');
    }
    finally {
        handle.close();
    }
}
