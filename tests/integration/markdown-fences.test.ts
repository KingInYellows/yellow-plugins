/**
 * Unit coverage for `scripts/lib/markdown-fences.js`, the CommonMark fence
 * scanner shared by validate-agent-authoring.js (strip) and the shell-compat
 * validators (extract). The strip view is also covered end-to-end by the
 * validate-agent-authoring-rule18 fixtures; these tests pin the extract view
 * the shell linters depend on: body text, dedent, language tag, line numbers
 * and end reason.
 */

import { describe, it, expect } from 'vitest';

/* eslint-disable @typescript-eslint/no-var-requires -- scripts/ is plain CJS */
const {
  extractFencedBlocks,
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

const extract = (md: string): Block[] => extractFencedBlocks(md);

describe('extractFencedBlocks', () => {
  it('returns body, language and 1-based line numbers for a plain fence', () => {
    const md = [
      '# Title',
      '',
      '```bash',
      'echo hi',
      'ls -la',
      '```',
      'after',
    ].join('\n');
    const [block, ...rest] = extract(md);
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
    expect(extract(md)[0]).toMatchObject({
      startLine: 5,
      lang: 'sh',
      body: 'true',
    });
  });

  it('handles tilde fences and info strings with attributes', () => {
    const md = ['~~~bash title="setup"', 'x=1', '~~~'].join('\n');
    const [block] = extract(md);
    expect(block.lang).toBe('bash');
    expect(block.info).toBe('bash title="setup"');
    expect(block.body).toBe('x=1');
  });

  it('dedents a fence nested in a list item so the body parses as shell', () => {
    const md = [
      '1. Run this:',
      '',
      '   ```bash',
      '   if true; then',
      '     echo nested',
      '   fi',
      '   ```',
      '2. Next step',
    ].join('\n');
    const [block] = extract(md);
    expect(block.closed).toBe(true);
    expect(block.indent).toBe(3);
    expect(block.body).toBe('if true; then\n  echo nested\nfi');
  });

  it('strips the opener indent inside a list item as well as the container column', () => {
    const md = ['- item', '    ```bash', '    echo x', '    ```'].join('\n');
    expect(extract(md)[0]).toMatchObject({ indent: 4, body: 'echo x' });
  });

  it('removes block-quote markers from the body', () => {
    const md = ['> ```bash', '> echo quoted', '> ```'].join('\n');
    expect(extract(md)[0]).toMatchObject({ closed: true, body: 'echo quoted' });
  });

  it('treats an inner fence inside a longer outer fence as body text', () => {
    const md = ['````markdown', '```bash', 'echo inner', '```', '````'].join(
      '\n'
    );
    const blocks = extract(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('markdown');
    expect(blocks[0].body).toBe('```bash\necho inner\n```');
  });

  it('marks an unterminated fence as running to EOF', () => {
    const md = ['```bash', 'echo a', 'echo b'].join('\n');
    expect(extract(md)[0]).toMatchObject({
      closed: false,
      endReason: 'eof',
      endLine: 3,
      body: 'echo a\necho b',
    });
  });

  it('ends a fence when its list item ends before a closer', () => {
    const md = [
      '- item',
      '  ```bash',
      '  echo a',
      'outdented prose',
      '```',
    ].join('\n');
    const [first] = extract(md);
    expect(first).toMatchObject({
      closed: false,
      endReason: 'container',
      body: 'echo a',
    });
  });

  it('does not treat a backtick opener whose info string has a backtick as a fence', () => {
    const md = ['```lang`suffix', 'echo nope'].join('\n');
    expect(extract(md)).toHaveLength(0);
  });

  it('does not treat a 4-space indented marker at top level as a fence', () => {
    const md = ['    ```bash', '    echo code-block', '    ```'].join('\n');
    expect(extract(md)).toHaveLength(0);
  });

  it('strips trailing carriage returns from CRLF bodies', () => {
    const md = '```bash\r\necho crlf\r\n```\r\n';
    expect(extract(md)[0]).toMatchObject({ closed: true, body: 'echo crlf' });
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
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe(
      'before\n\nafter'
    );
  });

  it('keeps the line that ended a container but drops the unclosed fence body', () => {
    const md = ['- item', '  ```bash', '  hidden', 'outdented prose'].join(
      '\n'
    );
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe(
      '- item\noutdented prose'
    );
  });

  it('drops an unterminated fence through EOF', () => {
    const md = ['keep', '```', 'gone', 'also gone'].join('\n');
    expect(stripFencedContent(md, { stripFrontmatter: false })).toBe('keep');
  });
});
