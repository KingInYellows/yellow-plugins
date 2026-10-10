import { describe, expect, it } from 'vitest';

import {
  CHALLENGE_LENGTH,
  confirmOnTty,
  mintChallenge,
} from '../src/tty-confirm.js';

import { codeOfAsync } from './support/app-error.js';
import { fakeTty } from './support/grants.js';

const SUMMARY = 'yellow-jules: CREATE GRANT\n  repository: acme/widgets';

describe('confirmOnTty', () => {
  it('resolves only when the owner types the challenge back', async () => {
    const tty = fakeTty('correct');
    await confirmOnTty({
      summary: SUMMARY,
      deadlineMs: 1000,
      openTty: tty.openTty,
    });
    const prompt = tty.written.join('');
    expect(prompt).toContain('CREATE GRANT');
    expect(prompt).toMatch(/Type [A-Z2-9]{6} to confirm/);
  });

  it('no controlling terminal -> JULES_CONFIRMATION_REQUIRED with the run-it-yourself recovery', async () => {
    const tty = fakeTty('no-tty');
    let recovery = '';
    try {
      await confirmOnTty({
        summary: SUMMARY,
        deadlineMs: 1000,
        openTty: tty.openTty,
      });
    } catch (err) {
      recovery =
        (err as { appError?: { code: string; recoveryAction: string } })
          .appError?.recoveryAction ?? '';
      expect((err as { appError?: { code: string } }).appError?.code).toBe(
        'JULES_CONFIRMATION_REQUIRED'
      );
    }
    expect(recovery).toContain('yourself in a terminal');
    expect(tty.written).toEqual([]);
  });

  it('a wrong code -> JULES_AUTHORITY_DENIED', async () => {
    const tty = fakeTty('wrong');
    expect(
      await codeOfAsync(() =>
        confirmOnTty({
          summary: SUMMARY,
          deadlineMs: 1000,
          openTty: tty.openTty,
        })
      )
    ).toBe('JULES_AUTHORITY_DENIED');
  });

  it('EOF before an answer -> JULES_AUTHORITY_DENIED', async () => {
    const tty = fakeTty('eof');
    expect(
      await codeOfAsync(() =>
        confirmOnTty({
          summary: SUMMARY,
          deadlineMs: 1000,
          openTty: tty.openTty,
        })
      )
    ).toBe('JULES_AUTHORITY_DENIED');
  });

  it('no answer before the deadline -> JULES_DEADLINE_EXCEEDED', async () => {
    const tty = fakeTty('timeout');
    expect(
      await codeOfAsync(() =>
        confirmOnTty({
          summary: SUMMARY,
          deadlineMs: 5,
          openTty: tty.openTty,
        })
      )
    ).toBe('JULES_DEADLINE_EXCEEDED');
  });

  it('win32 -> JULES_UNSUPPORTED_CAPABILITY without opening anything', async () => {
    const tty = fakeTty('correct');
    expect(
      await codeOfAsync(() =>
        confirmOnTty({
          summary: SUMMARY,
          deadlineMs: 1000,
          openTty: tty.openTty,
          platform: 'win32',
        })
      )
    ).toBe('JULES_UNSUPPORTED_CAPABILITY');
    expect(tty.opened).toBe(0);
  });

  it('prints the redacted summary and keeps the code off stdout and stderr', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const tty = fakeTty('correct');
    try {
      await confirmOnTty({
        summary: `${SUMMARY}\n  note: Bearer abcdefghijklmnop`,
        deadlineMs: 1000,
        openTty: tty.openTty,
      });
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }
    const code = /Type ([A-Z0-9]{6}) to confirm/.exec(
      tty.written.join('')
    )?.[1];
    expect(code).toBeDefined();
    expect(stdout.join('')).not.toContain(code);
    expect(stderr.join('')).not.toContain(code);
    expect(tty.written.join('')).not.toContain('abcdefghijklmnop');
  });
});

describe('mintChallenge', () => {
  it('is 6 unambiguous base32 characters and varies per call', () => {
    const codes = new Set(Array.from({ length: 50 }, () => mintChallenge()));
    for (const code of codes) {
      expect(code).toHaveLength(CHALLENGE_LENGTH);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
    expect(codes.size).toBeGreaterThan(40);
  });
});
