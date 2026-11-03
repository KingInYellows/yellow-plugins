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

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as tty from 'node:tty';

import { AgyError } from './errors';
import { redact } from './redact';

/** No 0/O/1/I: 32 symbols, so `byte & 31` is unbiased. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CHALLENGE_LENGTH = 6;
export const CONFIRM_DEADLINE_MS = 120_000;

export interface TtyHandle {
  write(text: string): void;
  /** One line, or null on EOF; rejects with `timeout` after `deadlineMs`. */
  readLine(deadlineMs: number): Promise<string | null>;
  close(): void;
}

export type OpenTty = () => TtyHandle;

export function mintChallenge(): string {
  let code = '';
  for (const byte of crypto.randomBytes(CHALLENGE_LENGTH))
    code += ALPHABET[byte & 31];
  return code;
}

function sameCode(a: string, b: string): boolean {
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
export function defaultOpenTty(
  platform: NodeJS.Platform = process.platform
): TtyHandle {
  const win = platform === 'win32';
  const inFd = fs.openSync(
    win ? '\\\\.\\CONIN$' : '/dev/tty',
    win ? 'r' : 'r+'
  );
  const outFd = win ? fs.openSync('\\\\.\\CONOUT$', 'w') : inFd;
  const input = new tty.ReadStream(inFd);
  let buffered = '';
  let ended = false;
  const waiters: Array<() => void> = [];
  const wake = (): void => {
    for (const w of waiters.splice(0)) w();
  };
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffered += chunk;
    wake();
  });
  const end = (): void => {
    ended = true;
    wake();
  };
  input.on('end', end);
  input.on('error', end);
  return {
    write(text: string): void {
      fs.writeSync(outFd, text);
    },
    readLine(deadlineMs: number): Promise<string | null> {
      const stopAt = Date.now() + deadlineMs;
      return new Promise((resolve, reject) => {
        const check = (): void => {
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
    close(): void {
      input.destroy();
      if (outFd !== inFd) fs.closeSync(outFd);
    },
  };
}

/**
 * Replaces terminal control characters (C0 but newline, DEL, C1) so a crafted
 * path in the summary can't move the cursor or rewrite what the owner reads.
 */
export function printable(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '?');
}

const RETRY =
  'Nothing was changed. Run the command again in a terminal and type the code exactly as shown.';

/**
 * Resolves only when the owner typed the code. No terminal throws
 * AGY_CONFIRMATION_REQUIRED; a wrong code, EOF or timeout throws
 * AGY_AUTHORITY_DENIED.
 */
export async function confirmOnTty(options: {
  readonly summary: string;
  readonly deadlineMs?: number;
  readonly openTty?: OpenTty;
}): Promise<void> {
  let handle: TtyHandle;
  try {
    handle = (options.openTty ?? (() => defaultOpenTty()))();
  } catch {
    throw new AgyError(
      'AGY_CONFIRMATION_REQUIRED',
      'no terminal is available to confirm this operation'
    );
  }
  const code = mintChallenge();
  try {
    handle.write(
      `\n${printable(redact(options.summary))}\n\nType ${code} to confirm, anything else to cancel: `
    );
    let answer: string | null;
    try {
      answer = await handle.readLine(options.deadlineMs ?? CONFIRM_DEADLINE_MS);
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        throw new AgyError(
          'AGY_AUTHORITY_DENIED',
          'no code was typed in time; nothing was changed',
          RETRY
        );
      }
      throw err;
    }
    if (answer === null || !sameCode(answer.trim().toUpperCase(), code)) {
      throw new AgyError(
        'AGY_AUTHORITY_DENIED',
        answer === null
          ? 'the terminal closed before a code was typed'
          : 'the code did not match; nothing was changed',
        RETRY
      );
    }
    handle.write('\nConfirmed.\n');
  } finally {
    handle.close();
  }
}
