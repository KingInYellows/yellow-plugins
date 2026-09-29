/**
 * Unit coverage for `scripts/lib/markdown-fences.js`.
 *
 * Two readings of markdown fences live there:
 *   - the CommonMark reading (`scanFences`, `stripFencedContent`), used by
 *     validate-agent-authoring.js to hide illustrative examples — also
 *     covered end to end by the validate-agent-authoring-rule18 fixtures;
 *   - the raw reading (`extractRawFencedBlocks`), used by the shell-compat
 *     checks because it matches how Claude reads and runs a ```bash block.
 */

import { describe, it, expect } from 'vitest';

/* eslint-disable @typescript-eslint/no-var-requires -- scripts/ is plain CJS */
const {
  scanFences,
  extractRawFencedBlocks,
  stripFencedContent,
  languageOf,
} = require('../../scripts/lib/markdown-fences.js');
/* eslint-enable @typescript-eslint/no-var-requires */

type Block = {
  startLine: number;
  bodyStartLine: number;
  endLine: number;
  closed: boolean;
  endReason: 'closer' | 'container' | 'eof';
  info: string;
  lang: string;
  indent: number;
  body: string;
};

const raw = (md: string): Block[] => extractRawFencedBlocks(md);

describe('scanFences', () => {
  it('drops a quoted list item when the block quote ends, so a following 4-space code line is not a fence', () => {
    const md = ['> - item', '', '    ```bash', '    x', '    ```', ''].join(
      '\n'
    );
    expect(scanFences(md.split('\n'))).toHaveLength(0);
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe(md);
  });

  it('drops a list item when a block quote starts at column 0, so a 4-space quoted code line is not a fence', () => {
    const md = [
      '- item',
      '>     ```text',
      '>   skill: "missing:target"',
      '>     ```',
    ].join('\n');
    expect(scanFences(md.split('\n'))).toHaveLength(0);
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe(md);
  });

  it('still recognizes a fence in a block quote nested inside a list item', () => {
    const md = ['- item', '  > ```bash', '  > x', '  > ```', 'after'].join(
      '\n'
    );
    const fences = scanFences(md.split('\n'));
    expect(fences).toHaveLength(1);
    expect(fences[0]).toMatchObject({ info: 'bash', endReason: 'closer' });
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe(
      '- item\n\nafter'
    );
  });
});

describe('extractRawFencedBlocks', () => {
  it('returns body, language and 1-based line numbers for a plain fence', () => {
    const md = ['# Title', '', '```bash', 'echo hi', 'ls -la', '```', 'after'].join('\n');
    const [block, ...rest] = raw(md);
    expect(rest).toHaveLength(0);
    expect(block).toMatchObject({
      startLine: 3,
      bodyStartLine: 4,
      endLine: 6,
      closed: true,
      endReason: 'closer',
      lang: 'bash',
      body: 'echo hi\nls -la',
    });
  });

  it('keeps line numbers relative to the file when frontmatter is present', () => {
    const md = ['---', 'name: x', '---', '', '```sh', 'true', '```'].join('\n');
    expect(raw(md)[0]).toMatchObject({ startLine: 5, lang: 'sh', body: 'true' });
  });

  it('handles tilde fences and info strings with attributes', () => {
    const [block] = raw(['~~~bash title="setup"', 'x=1', '~~~'].join('\n'));
    expect(block).toMatchObject({ lang: 'bash', info: 'bash title="setup"', body: 'x=1' });
  });

  it('keeps a list-item fence whose body sits at column 0 (Claude runs it)', () => {
    const md = [
      '1. Step:',
      '   ```bash',
      'echo col0',
      '   ```',
      '2. Next',
      '   ```bash',
      'echo two',
      '   ```',
    ].join('\n');
    expect(raw(md).map((b) => [b.startLine, b.lang, b.body])).toEqual([
      [2, 'bash', 'echo col0'],
      [6, 'bash', 'echo two'],
    ]);
    // The CommonMark reading ends the list item — and the fence — instead.
    expect(scanFences(md.split('\n'))[0]).toMatchObject({ endReason: 'container' });
  });

  it('dedents by the opener indent and tolerates a differently indented closer', () => {
    expect(raw(['  ```sh', '  a', '    b', '```'].join('\n'))[0]).toMatchObject({
      closed: true,
      indent: 2,
      body: 'a\n  b',
    });
  });

  it('removes only the block-quote markers the fence is nested in', () => {
    expect(raw(['> ```bash', '> echo quoted', '> ```'].join('\n'))[0].body).toBe('echo quoted');
    expect(raw(['> ```bash', '> cmd \\', '>   > "$out"', '> ```'].join('\n'))[0].body).toBe(
      'cmd \\\n  > "$out"'
    );
  });

  it('keeps a leading `>` redirect inside an unquoted fence', () => {
    const md = ['```bash', 'cmd \\', '  > "$out" 2> "$err"', '```'].join('\n');
    expect(raw(md)[0].body).toBe('cmd \\\n  > "$out" 2> "$err"');
  });

  it('requires the closer to reuse the opener character and length', () => {
    const md = ['````markdown', '```bash', 'echo inner', '```', '````'].join('\n');
    const blocks = raw(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ lang: 'markdown', body: '```bash\necho inner\n```' });
  });

  it('runs an unterminated fence to EOF', () => {
    expect(raw(['```bash', 'echo a', 'echo b'].join('\n'))[0]).toMatchObject({
      closed: false,
      endReason: 'eof',
      endLine: 3,
      body: 'echo a\necho b',
    });
  });

  it('does not treat a backtick opener whose info string has a backtick as a fence', () => {
    expect(raw(['```lang`suffix', 'echo nope'].join('\n'))).toHaveLength(0);
  });

  it('strips trailing carriage returns from CRLF bodies', () => {
    expect(raw('```bash\r\necho crlf\r\n```\r\n')[0]).toMatchObject({
      closed: true,
      body: 'echo crlf',
    });
  });

  // Follow-up 10: an unterminated quoted fence must not swallow a later
  // top-level ```bash block, whose opener it used to read as its closer.
  it.each([
    [
      'a blank line',
      ['> ```text', '> quoted', '', '```bash', 'x', '```'],
      '\n',
    ],
    [
      'an unquoted line',
      ['> ```text', '> quoted', '```bash', 'x', '```'],
      // The CommonMark reading keeps the line that ended the quote as prose.
      '```bash\nx',
    ],
  ])(
    'ends a quoted fence where the block quote ends (%s)',
    (_name, lines, stripped) => {
      const md = lines.join('\n');
      const blocks = raw(md);
      expect(blocks.map((b) => [b.lang, b.endReason, b.body])).toEqual([
        ['text', 'container', 'quoted'],
        ['bash', 'closer', 'x'],
      ]);
      expect(blocks[0]).toMatchObject({ closed: false, endLine: 2 });
      expect(stripFencedContent(md, { stripFrontmatter: false })).toBe(
        stripped
      );
    }
  );

  it('keeps a quoted fence open across deeper-quoted lines', () => {
    const md = ['> ```bash', '> > x', '> ```'].join('\n');
    expect(raw(md)[0]).toMatchObject({ closed: true, body: '> x' });
  });
});

describe('scanFences (CommonMark reading)', () => {
  const scan = (md: string) => scanFences(md.split('\n'));

  it('does not treat a 4-space indented marker at top level as a fence', () => {
    expect(scan(['    ```bash', '    echo code-block', '    ```'].join('\n'))).toHaveLength(0);
  });

  it('ends a fence when its list item ends before a closer', () => {
    const md = ['- item', '  ```bash', '  echo a', 'outdented prose', '```'].join('\n');
    expect(scan(md)[0]).toMatchObject({ endReason: 'container', endIndex: 3 });
  });
});

describe('languageOf', () => {
  it.each([
    ['bash', 'bash'],
    ['Bash title=x', 'bash'],
    ['{.sh}', 'sh'],
    ['', ''],
    ['shell-session', 'shell-session'],
  ])('%j -> %j', (info, expected) => {
    expect(languageOf(info)).toBe(expected);
  });
});

describe('stripFencedContent', () => {
  it('replaces a closed fence with one blank line and keeps surrounding prose', () => {
    const md = ['before', '```bash', 'hidden', '```', 'after'].join('\n');
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe('before\n\nafter');
  });

  it('keeps the line that ended a container but drops the unclosed fence body', () => {
    const md = ['- item', '  ```bash', '  hidden', 'outdented prose'].join('\n');
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe('- item\noutdented prose');
  });

  it('drops an unterminated fence through EOF', () => {
    const md = ['keep', '```', 'gone', 'also gone'].join('\n');
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe('keep');
  });
});
