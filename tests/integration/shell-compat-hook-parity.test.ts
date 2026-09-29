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
  listMarkdownFiles,
  SHELL_LANGS,
} = require('../../scripts/validate-shell-compat.js');
const detectors = {
  'gt-workflow': require('../../plugins/gt-workflow/hooks/scripts/lib/git-push-detector.js'),
  'github-workflow': require('../../plugins/github-workflow/hooks/scripts/lib/git-push-detector.js'),
};
/* eslint-enable @typescript-eslint/no-var-requires */

const ROOT = join(__dirname, '..', '..');
const WRAPPER_RE = /^bash \/dev\/fd\/3 3<<'(__[A-Z0-9_]+__)'$/m;

type Block = { startLine: number; lang: string; body: string };

// The heredoc body of a wrapped block: what the same block would run bare.
function unwrap(body: string): string {
  const tag = (WRAPPER_RE.exec(body) as RegExpExecArray)[1];
  const lines = body.split('\n');
  const open = lines.findIndex((l) => WRAPPER_RE.test(l));
  const close = lines.indexOf(tag, open + 1);
  if (close === -1) throw new Error(`wrapper tag ${tag} is never closed`);
  return lines.slice(open + 1, close).join('\n');
}

const wrappedBlocks: { where: string; body: string }[] = [];
for (const rel of listMarkdownFiles(ROOT) as string[]) {
  const content = readFileSync(join(ROOT, rel), 'utf8');
  for (const block of extractRawFencedBlocks(content) as Block[]) {
    if (SHELL_LANGS.has(block.lang) && WRAPPER_RE.test(block.body)) {
      wrappedBlocks.push({
        where: `${rel}:${block.startLine}`,
        body: block.body,
      });
    }
  }
}

describe.each(Object.entries(detectors))(
  '%s git-push detector',
  (_name, detector) => {
    it('finds the wrapped blocks this suite is meant to cover', () => {
      expect(wrappedBlocks.length).toBeGreaterThanOrEqual(15);
    });

    it.each(wrappedBlocks.map((b) => [b.where, b.body]))(
      'gives %s the same verdict wrapped and bare',
      (_where, body) => {
        expect(detector.classifyGitPushCommand(body)).toBe(
          detector.classifyGitPushCommand(unwrap(body))
        );
      }
    );

    it('allows most wrapped blocks outright', () => {
      const allowed = wrappedBlocks.filter(
        (b) => detector.classifyGitPushCommand(b.body) === 'allow'
      );
      expect(allowed.length).toBeGreaterThanOrEqual(10);
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
