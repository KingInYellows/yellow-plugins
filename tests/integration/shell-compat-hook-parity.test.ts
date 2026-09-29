/**
 * The Tier 2 wrapper must be transparent to the stacked-PR providers'
 * git-push PreToolUse hook. Exactly one of gt-workflow or github-workflow is
 * always enabled, and both refuse commands their detector cannot verify — a
 * `bash -c "$(…)"` wrapper, for example, is denied outright. The fd-3 wrapper
 * (`bash /dev/fd/3 3<<'TAG'`) is inspected instead, so every wrapped block in
 * plugin markdown must get the same verdict as its body run bare, and a
 * `git push` inside a wrapper is still caught.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

/* eslint-disable @typescript-eslint/no-var-requires -- scripts/ and hooks are plain CJS */
const {
  extractRawFencedBlocks,
} = require('../../scripts/lib/markdown-fences.js');
const {
  findFdWrappers,
  listMarkdownFiles,
  SHELL_LANGS,
} = require('../../scripts/validate-shell-compat.js');
const detectors = {
  'gt-workflow': require('../../plugins/gt-workflow/hooks/scripts/lib/git-push-detector.js'),
  'github-workflow': require('../../plugins/github-workflow/hooks/scripts/lib/git-push-detector.js'),
};
/* eslint-enable @typescript-eslint/no-var-requires */

const ROOT = join(__dirname, '..', '..');

// Wrapped blocks the hook already could not verify before they were
// wrapped (plans/shell-compat-followups.md item 4), counted per file. Every
// other wrapped block must be allowed outright. Lower a count when a block
// starts passing; never raise one to admit a new block.
const KNOWN_UNVERIFIABLE: Record<string, number> = {
  'plugins/yellow-debt/agents/remediation/debt-fixer.md': 2,
  'plugins/yellow-debt/commands/debt/audit.md': 1,
  'plugins/yellow-debt/commands/debt/fix.md': 1,
  'plugins/yellow-debt/commands/debt/status.md': 1,
  'plugins/yellow-ruvector/commands/ruvector/status.md': 1,
};

type Block = { startLine: number; lang: string; body: string };
type Wrapper = { open: number; close: number; tag: string };

// What the block would run bare: every wrapper's opening line and closing
// tag removed, its body and all lines outside it kept.
function unwrap(body: string, wrappers: Wrapper[]): string {
  const drop = new Set(wrappers.flatMap((w) => [w.open, w.close]));
  return body
    .split('\n')
    .filter((_line, i) => !drop.has(i))
    .join('\n');
}

const wrappedBlocks: {
  rel: string;
  where: string;
  body: string;
  wrappers: Wrapper[];
}[] = [];
for (const rel of listMarkdownFiles(ROOT) as string[]) {
  const content = readFileSync(join(ROOT, rel), 'utf8');
  for (const block of extractRawFencedBlocks(content) as Block[]) {
    if (!SHELL_LANGS.has(block.lang)) continue;
    const wrappers = findFdWrappers(block.body.split('\n')) as Wrapper[];
    if (wrappers.length === 0) continue;
    for (const w of wrappers) {
      if (w.close === -1) {
        throw new Error(
          `${rel}:${block.startLine}: wrapper tag ${w.tag} is never closed`
        );
      }
    }
    wrappedBlocks.push({
      rel,
      where: `${rel}:${block.startLine}`,
      body: block.body,
      wrappers,
    });
  }
}

describe('unwrap', () => {
  it('keeps lines outside the wrapper and handles several wrappers', () => {
    const body = [
      'echo before',
      "bash /dev/fd/3 3<<'__A__'",
      'echo a',
      '__A__',
      'echo between',
      "bash /dev/fd/3 3<<'__B__'",
      'echo b',
      '__B__',
      'echo after',
    ].join('\n');
    const wrappers = findFdWrappers(body.split('\n')) as Wrapper[];
    expect(wrappers.map((w) => w.tag)).toEqual(['__A__', '__B__']);
    expect(unwrap(body, wrappers)).toBe(
      ['echo before', 'echo a', 'echo between', 'echo b', 'echo after'].join(
        '\n'
      )
    );
  });
});

describe.each(Object.entries(detectors))(
  '%s git-push detector',
  (_name, detector) => {
    it('finds wrapped blocks to check', () => {
      expect(wrappedBlocks.length).toBeGreaterThan(0);
    });

    it.each(wrappedBlocks.map((b) => [b.where, b]))(
      'gives %s the same verdict wrapped and bare',
      (_where, b) => {
        expect(detector.classifyGitPushCommand(b.body)).toBe(
          detector.classifyGitPushCommand(unwrap(b.body, b.wrappers))
        );
      }
    );

    it('allows every wrapped block except the known-unverifiable ones', () => {
      const counts: Record<string, number> = {};
      for (const b of wrappedBlocks) {
        const verdict = detector.classifyGitPushCommand(b.body);
        if (verdict === 'allow') continue;
        expect(verdict, b.where).toBe('unverifiable');
        counts[b.rel] = (counts[b.rel] || 0) + 1;
      }
      expect(counts).toEqual(KNOWN_UNVERIFIABLE);
    });

    it('still catches a git push inside an fd-3 wrapper', () => {
      const body = "bash /dev/fd/3 3<<'__T__'\ngit push origin HEAD\n__T__";
      expect(detector.classifyGitPushCommand(body)).toBe('verified-push');
    });

    it('refuses the bash -c "$(cat <<TAG …)" form that SHC-009 rejects', () => {
      const body = `bash -c "$(cat <<'__T__'\ntrue\n__T__\n)"`;
      expect(detector.classifyGitPushCommand(body)).toBe('unverifiable');
    });
  }
);
