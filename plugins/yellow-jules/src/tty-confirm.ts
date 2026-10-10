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

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as tty from 'node:tty';

import { throwAppError } from './errors.js';
import { redact } from './redact.js';

/** Unambiguous base32 (no 0/O/1/I): 32 symbols, so `byte & 31` is unbiased. */
const CHALLENGE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CHALLENGE_LENGTH = 6;
export const DEFAULT_CONFIRM_DEADLINE_MS = 120_000;

export interface TtyHandle {
  write(text: string): void;
  /** Resolves one line, or `null` on EOF; rejects with `timeout` once `deadlineMs` passes. */
  readLine(deadlineMs: number): Promise<string | null>;
  close(): void;
}

export type OpenTty = () => TtyHandle;

export interface ConfirmOptions {
  /** What the owner is approving; redacted before it is printed. */
  readonly summary: string;
  readonly deadlineMs: number;
  readonly openTty?: OpenTty;
  readonly platform?: NodeJS.Platform;
}

export function mintChallenge(): string {
  const bytes = crypto.randomBytes(CHALLENGE_LENGTH);
  let code = '';
  for (const byte of bytes) code += CHALLENGE_ALPHABET[byte & 31];
  return code;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  const length = Math.max(left.length, right.length, 1);
  const paddedLeft = Buffer.alloc(length);
  const paddedRight = Buffer.alloc(length);
  left.copy(paddedLeft);
  right.copy(paddedRight);
  return (
    crypto.timingSafeEqual(paddedLeft, paddedRight) &&
    left.length === right.length
  );
}

const RETRY_RECOVERY =
  'Nothing was changed. Run the command again in a terminal and type the code exactly as shown.';

const NO_TTY_RECOVERY =
  'Run this command yourself in a terminal on the controller host; an agent without a controlling terminal cannot confirm it.';

/** Opens `/dev/tty` read-write; failure to open means the caller has no controlling terminal. */
export function defaultOpenTty(): TtyHandle {
  const fd = fs.openSync('/dev/tty', fs.constants.O_RDWR);
  const input = new tty.ReadStream(fd);
  let buffered = '';
  let ended = false;
  const waiters: Array<() => void> = [];
  const wake = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
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
    write(text: string): void {
      fs.writeSync(fd, text);
    },
    readLine(deadlineMs: number): Promise<string | null> {
      const stopAt = Date.now() + deadlineMs;
      return new Promise((resolve, reject) => {
        const check = (): void => {
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
    close(): void {
      input.destroy();
    },
  };
}

function isNoTerminal(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENXIO' || code === 'ENOENT' || code === 'EACCES';
}

/**
 * Resolves only when the owner typed the exact challenge code. Every other
 * outcome throws: no terminal -> JULES_CONFIRMATION_REQUIRED, win32 ->
 * JULES_UNSUPPORTED_CAPABILITY, wrong code or EOF -> JULES_AUTHORITY_DENIED,
 * no answer in time -> JULES_DEADLINE_EXCEEDED.
 */
export async function confirmOnTty(options: ConfirmOptions): Promise<void> {
  if ((options.platform ?? process.platform) === 'win32') {
    return throwAppError(
      'JULES_UNSUPPORTED_CAPABILITY',
      'terminal confirmation needs /dev/tty, which this platform does not provide'
    );
  }
  let handle: TtyHandle;
  try {
    handle = (options.openTty ?? defaultOpenTty)();
  } catch (err) {
    if (isNoTerminal(err)) {
      return throwAppError(
        'JULES_CONFIRMATION_REQUIRED',
        'no controlling terminal is available to confirm this operation',
        { recoveryAction: NO_TTY_RECOVERY }
      );
    }
    throw err;
  }
  const code = mintChallenge();
  try {
    handle.write(
      `\n${redact(options.summary)}\n\nType ${code} to confirm, anything else to cancel: `
    );
    let answer: string | null;
    try {
      answer = await handle.readLine(options.deadlineMs);
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        return throwAppError(
          'JULES_DEADLINE_EXCEEDED',
          'no confirmation was typed before the deadline; nothing was changed',
          {
            recoveryAction:
              'Run the command again and type the code shown within the time limit.',
          }
        );
      }
      throw err;
    }
    if (answer === null) {
      return throwAppError(
        'JULES_AUTHORITY_DENIED',
        'the terminal closed before a confirmation was typed',
        { recoveryAction: RETRY_RECOVERY }
      );
    }
    if (!constantTimeEqual(answer.trim().toUpperCase(), code)) {
      return throwAppError(
        'JULES_AUTHORITY_DENIED',
        'the confirmation code did not match; nothing was changed',
        { recoveryAction: RETRY_RECOVERY }
      );
    }
    handle.write('\nConfirmed.\n');
  } finally {
    handle.close();
  }
}
