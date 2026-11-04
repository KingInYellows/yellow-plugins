"use strict";
/**
 * Owner confirmation (from yellow-jules' tty-confirm): the CLI opens the
 * controlling terminal itself, prints a summary and a random code there, and
 * needs the owner to type the code back. An agent's Bash tool, CI or any
 * caller with no terminal can't answer it. Nothing goes to stdout or stderr,
 * and the code is never logged or returned.
 *
 * POSIX uses /dev/tty. Windows uses the console (CONIN$ / CONOUT$); that
 * path is unverified until the real-Windows check.
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
exports.CONFIRM_DEADLINE_MS = exports.CHALLENGE_LENGTH = void 0;
exports.mintChallenge = mintChallenge;
exports.defaultOpenTty = defaultOpenTty;
exports.printable = printable;
exports.confirmOnTty = confirmOnTty;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const tty = __importStar(require("node:tty"));
const errors_1 = require("./errors");
const redact_1 = require("./redact");
/** No 0/O/1/I: 32 symbols, so `byte & 31` is unbiased. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
exports.CHALLENGE_LENGTH = 6;
exports.CONFIRM_DEADLINE_MS = 120_000;
function mintChallenge() {
    let code = '';
    for (const byte of crypto.randomBytes(exports.CHALLENGE_LENGTH))
        code += ALPHABET[byte & 31];
    return code;
}
function sameCode(a, b) {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    const n = Math.max(left.length, right.length, 1);
    const l = Buffer.alloc(n);
    const r = Buffer.alloc(n);
    left.copy(l);
    right.copy(r);
    return crypto.timingSafeEqual(l, r) && left.length === right.length;
}
/** Opens the controlling terminal; a failure means there is none. */
function defaultOpenTty(platform = process.platform) {
    const win = platform === 'win32';
    const inFd = fs.openSync(win ? '\\\\.\\CONIN$' : '/dev/tty', win ? 'r' : 'r+');
    const outFd = win ? fs.openSync('\\\\.\\CONOUT$', 'w') : inFd;
    const input = new tty.ReadStream(inFd);
    let buffered = '';
    let ended = false;
    const waiters = [];
    const wake = () => {
        for (const w of waiters.splice(0))
            w();
    };
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
        buffered += chunk;
        wake();
    });
    const end = () => {
        ended = true;
        wake();
    };
    input.on('end', end);
    input.on('error', end);
    return {
        write(text) {
            fs.writeSync(outFd, text);
        },
        readLine(deadlineMs) {
            const stopAt = Date.now() + deadlineMs;
            return new Promise((resolve, reject) => {
                const check = () => {
                    const nl = buffered.search(/\r|\n/);
                    if (nl !== -1) {
                        const line = buffered.slice(0, nl);
                        buffered = '';
                        resolve(line);
                        return;
                    }
                    if (ended) {
                        resolve(null);
                        return;
                    }
                    const left = stopAt - Date.now();
                    if (left <= 0) {
                        reject(new Error('timeout'));
                        return;
                    }
                    const timer = setTimeout(check, left);
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
            if (outFd !== inFd)
                fs.closeSync(outFd);
        },
    };
}
/**
 * Replaces terminal control characters (C0 but newline, DEL, C1) and Unicode
 * bidi and zero-width format characters, so a crafted path in the summary
 * can't move the cursor or make what the owner reads differ from the grant.
 */
function printable(text) {
    return text.replace(
    // eslint-disable-next-line no-control-regex, no-misleading-character-class
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, '?');
}
const RETRY = 'Nothing was changed. Run the command again in a terminal and type the code exactly as shown.';
/**
 * Resolves only when the owner typed the code. No terminal throws
 * AGY_CONFIRMATION_REQUIRED; a wrong code, EOF or timeout throws
 * AGY_AUTHORITY_DENIED.
 */
async function confirmOnTty(options) {
    let handle;
    try {
        handle = (options.openTty ?? (() => defaultOpenTty()))();
    }
    catch {
        throw new errors_1.AgyError('AGY_CONFIRMATION_REQUIRED', 'no terminal is available to confirm this operation');
    }
    const code = mintChallenge();
    try {
        handle.write(`\n${printable((0, redact_1.redact)(options.summary))}\n\nType ${code} to confirm, anything else to cancel: `);
        let answer;
        try {
            answer = await handle.readLine(options.deadlineMs ?? exports.CONFIRM_DEADLINE_MS);
        }
        catch (err) {
            if (err instanceof Error && err.message === 'timeout') {
                throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', 'no code was typed in time; nothing was changed', RETRY);
            }
            throw err;
        }
        if (answer === null || !sameCode(answer.trim().toUpperCase(), code)) {
            throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', answer === null
                ? 'the terminal closed before a code was typed'
                : 'the code did not match; nothing was changed', RETRY);
        }
        handle.write('\nConfirmed.\n');
    }
    finally {
        handle.close();
    }
}
