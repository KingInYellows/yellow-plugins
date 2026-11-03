import { describe, expect, it } from 'vitest';

import { confirmOnTty, printable } from '../src/tty';

describe('tty confirmation', () => {
  it('replaces bidi and zero-width characters in the summary', () => {
    expect(printable('repo /r/\u202egpj.exe\u200b\u2066x\ufeff')).toBe(
      'repo /r/?gpj.exe??x?'
    );
  });

  it('replaces terminal control characters in the summary', async () => {
    expect(printable('repo /r\x1b[2J\x9b\x07\nbranch\tx')).toBe(
      'repo /r?[2J??\nbranch?x'
    );
    let shown = '';
    await expect(
      confirmOnTty({
        summary: 'path /r\x1b]0;spoof\x07',
        openTty: () => ({
          write: (t: string) => {
            shown += t;
          },
          readLine: async () => 'nope',
          close: () => undefined,
        }),
      })
    ).rejects.toMatchObject({ code: 'AGY_AUTHORITY_DENIED' });
    expect(shown).not.toContain('\x1b');
    expect(shown).not.toContain('\x07');
  });
});
