/**
 * Integration tests for `scripts/backfill-solution-frontmatter.js`.
 *
 * Covers the P1 critical paths flagged during the W2.0a self-review:
 *   - deriveTrack security-issues marker branch (auto-bug vs flagged)
 *   - --check exit-code contract (2 if changes needed, 0 if complete)
 *   - injectFrontmatter YAML correctness incl. category vs problem_type
 *     fallback and single-quote escaping
 *   - Idempotency (apply then re-run = 0 modifications)
 *   - Multi-line title joining (regression test for the bug that produced
 *     truncated `problem` values during the initial backfill)
 *   - Empty-value idempotency bypass (a bare `problem:` should not count
 *     as already-complete)
 *   - SOLUTIONS_DIR path-traversal guard
 *
 * The script is parameterized via `SOLUTIONS_DIR` so each test builds a
 * synthetic fixture tree under `os.tmpdir()` and invokes the script as a
 * child process. The script accepts paths under `os.tmpdir()` for exactly
 * this purpose; production runs leave `SOLUTIONS_DIR` unset and the script
 * uses `docs/solutions/` under the repo root.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'backfill-solution-frontmatter.js');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(solutionsDir: string, args: string[] = []): RunResult {
  // Use spawnSync so we always capture both stdout and stderr regardless of
  // exit code. execFileSync drops stderr on success.
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const result = spawnSync('node', [SCRIPT, ...args], {
    env: { ...process.env, SOLUTIONS_DIR: solutionsDir },
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writeEntry(
  solutionsDir: string,
  category: string,
  slug: string,
  frontmatter: string,
  body: string = '\nBody.\n'
): string {
  const dir = join(solutionsDir, category);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${slug}.md`);
  writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}`, 'utf8');
  return filePath;
}

describe('backfill-solution-frontmatter — deriveTrack security marker branch', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-track-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('flags security-issues entry whose title contains "pre-implementation" for manual review', () => {
    writeEntry(
      tmpRoot,
      'security-issues',
      'sample-audit',
      `title: 'Pre-Implementation Threat Analysis for Sample'\ncategory: security-issues\ndate: 2026-04-29\ntags: [audit]`
    );

    const { status, stdout } = runScript(tmpRoot);

    expect(status).toBe(0);
    expect(stdout).toMatch(/flagged for manual review:\s*1/);
    expect(stdout).toMatch(/sample-audit\.md/);
    expect(stdout).toMatch(/pre-implementation/);
  });

  it('flags security-issues entry with "audit" in first paragraph for manual review', () => {
    writeEntry(
      tmpRoot,
      'security-issues',
      'sample-audit-body',
      `title: 'Sample'\ncategory: security-issues\ndate: 2026-04-29\ntags: [security]`,
      '\nThis is a security audit of the sample plugin. Twenty-one concerns identified.\n'
    );

    const { status, stdout } = runScript(tmpRoot);

    expect(status).toBe(0);
    expect(stdout).toMatch(/flagged for manual review:\s*1/);
  });

  it('auto-assigns track:bug to security-issues entry with no audit/threat-model/pre-implementation markers', () => {
    const filePath = writeEntry(
      tmpRoot,
      'security-issues',
      'sql-injection-fix',
      `title: 'SQL injection fix in user signup'\ncategory: security-issues\ndate: 2026-04-29\ntags: [sql-injection]`,
      '\nThe signup endpoint passed user input directly to a SQL query.\n'
    );

    const { status, stdout } = runScript(tmpRoot);
    const after = readFileSync(filePath, 'utf8');

    expect(status).toBe(0);
    expect(stdout).toMatch(/modified:\s*1/);
    expect(stdout).toMatch(/flagged for manual review:\s*0/);
    expect(after).toMatch(/track: bug/);
  });
});

describe('backfill-solution-frontmatter — --check exit code contract', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-check-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exits 2 when files would change', () => {
    writeEntry(
      tmpRoot,
      'logic-errors',
      'incomplete',
      `title: 'Incomplete'\ncategory: logic-errors\ndate: 2026-04-29\ntags: [logic]`
    );

    const { status, stdout } = runScript(tmpRoot, ['--check']);

    expect(status).toBe(2);
    expect(stdout).toMatch(/\[check\] Files would be modified/);
  });

  it('exits 0 on a fully-complete tree', () => {
    writeEntry(
      tmpRoot,
      'logic-errors',
      'complete',
      `title: 'Complete'\ncategory: logic-errors\ntrack: bug\nproblem: 'Some specific bug fix'\ndate: 2026-04-29\ntags: [logic]`
    );

    const { status } = runScript(tmpRoot, ['--check']);

    expect(status).toBe(0);
  });
});

describe('backfill-solution-frontmatter — injectFrontmatter placement', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-inject-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('inserts track and problem immediately after category: line', () => {
    const filePath = writeEntry(
      tmpRoot,
      'workflow',
      'after-category',
      `title: 'After Category'\ncategory: workflow\ndate: 2026-04-29\ntags: [workflow]`,
      '\nA pattern.\n'
    );

    runScript(tmpRoot);

    const after = readFileSync(filePath, 'utf8');
    const fmEnd = after.indexOf('\n---\n', 4);
    const fm = after.slice(4, fmEnd);
    const lines = fm.split('\n');
    const categoryIdx = lines.findIndex((l) => l.startsWith('category:'));
    const trackIdx = lines.findIndex((l) => l.startsWith('track:'));
    expect(trackIdx).toBe(categoryIdx + 1);
  });

  it('falls back to problem_type: line when category: is absent (legacy frontmatter)', () => {
    const filePath = writeEntry(
      tmpRoot,
      'code-quality',
      'legacy-problem-type',
      `title: 'Legacy'\nproblem_type: code-quality\ndate: 2026-04-29\ntags: [legacy]`,
      '\nLegacy entry.\n'
    );

    runScript(tmpRoot);

    const after = readFileSync(filePath, 'utf8');
    const fmEnd = after.indexOf('\n---\n', 4);
    const fm = after.slice(4, fmEnd);
    const lines = fm.split('\n');
    const ptIdx = lines.findIndex((l) => l.startsWith('problem_type:'));
    const trackIdx = lines.findIndex((l) => l.startsWith('track:'));
    expect(trackIdx).toBe(ptIdx + 1);
  });

  it("escapes single quotes in problem values via doubled single-quote", () => {
    const filePath = writeEntry(
      tmpRoot,
      'code-quality',
      'apostrophe',
      `title: "It's broken: a guide"\ncategory: code-quality\ndate: 2026-04-29\ntags: [test]`,
      '\nBody.\n'
    );

    runScript(tmpRoot);

    const after = readFileSync(filePath, 'utf8');
    expect(after).toMatch(/problem: 'It''s broken: a guide'/);
  });
});

describe('backfill-solution-frontmatter — multi-line title joining (regression test)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-multi-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("joins continuation lines under a multi-line title without truncating mid-sentence", () => {
    // Mimics the wsl2-crlf-pr-merge-unblocking.md original frontmatter shape
    // that produced the truncated `problem` value during the initial backfill.
    const filePath = writeEntry(
      tmpRoot,
      'workflow',
      'multi-title',
      `title:
  'Unblocking stuck PRs: CRLF git conflicts, mergeStateStatus, and multi-round
  conflict resolution'
category: workflow
date: 2026-04-29
tags: [git, crlf]`,
      '\nBody.\n'
    );

    runScript(tmpRoot);

    const after = readFileSync(filePath, 'utf8');
    // The derived problem value MUST contain the full title, not truncate at
    // "multi-round" or any other line boundary.
    expect(after).toMatch(/problem: '.*conflict resolution.*'/);
    expect(after).not.toMatch(/problem: '[^']*multi-round'$/m);
  });
});

describe('backfill-solution-frontmatter — idempotency', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-idem-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('second apply run produces 0 modifications', () => {
    writeEntry(
      tmpRoot,
      'logic-errors',
      'first',
      `title: 'First'\ncategory: logic-errors\ndate: 2026-04-29\ntags: [logic]`
    );
    writeEntry(
      tmpRoot,
      'code-quality',
      'second',
      `title: 'Second'\ncategory: code-quality\ndate: 2026-04-29\ntags: [quality]`
    );

    const first = runScript(tmpRoot);
    expect(first.stdout).toMatch(/modified:\s*2/);

    const second = runScript(tmpRoot);
    expect(second.stdout).toMatch(/modified:\s*0/);
    expect(second.stdout).toMatch(/already complete:\s*2/);
  });
});

describe('backfill-solution-frontmatter — empty-value idempotency bypass', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-empty-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does NOT count an empty `problem:` field as already-complete', () => {
    // Bare `problem:` (empty value) should NOT bypass derivation just because
    // the key is present. The fix uses fmHasNonEmptyField for the gate.
    writeEntry(
      tmpRoot,
      'logic-errors',
      'empty-problem',
      `title: 'Empty Problem'\ncategory: logic-errors\ntrack: bug\nproblem:\ndate: 2026-04-29\ntags: [logic]`
    );

    const { status, stdout } = runScript(tmpRoot);

    expect(status).toBe(0);
    // Either it's modified (problem derived) OR flagged (no source) — but
    // it must NOT be counted as already-complete.
    expect(stdout).not.toMatch(/already complete:\s*1/);
  });
});

describe('backfill-solution-frontmatter — empty tags list bypass', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-emptytags-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does NOT count `tags: []` as already-complete (parser must beat scalar length)', () => {
    // Regression for PR #278 round-2 thread 1: fmGetScalar returns the literal
    // string "[]" for `tags: []`, which would pass a length>0 check and make
    // the scalar-first code path short-circuit parseTagsList. The fix reorders
    // the function so the parser is consulted first for list-style keys.
    writeEntry(
      tmpRoot,
      'logic-errors',
      'empty-tags-list',
      `title: 'Empty Tags'\ncategory: logic-errors\ntrack: bug\nproblem: 'something'\ndate: 2026-04-29\ntags: []`
    );

    const { status, stdout } = runScript(tmpRoot);

    expect(status).toBe(0);
    // Must NOT be silently classified as already-complete.
    expect(stdout).not.toMatch(/already complete:\s*1/);
  });
});

describe('backfill-solution-frontmatter — deriveTags duplicate-key guard', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-dedup-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does NOT inject a second `tags:` block when the key already exists with zero parseable items', () => {
    // Regression for PR #278 round-2 threads 2 & 3: a bare `tags:` (no list
    // items) used to fall through deriveTags to `return [category]`, producing
    // duplicate `tags:` YAML keys. The fix returns null whenever the key is
    // present, regardless of parseable item count.
    const filePath = writeEntry(
      tmpRoot,
      'workflow',
      'bare-tags',
      `title: 'Bare Tags'\ncategory: workflow\ndate: 2026-04-29\ntags:`,
      '\nA pattern without list items.\n'
    );

    runScript(tmpRoot);

    const after = readFileSync(filePath, 'utf8');
    // Frontmatter must contain exactly one `tags:` line (the original empty
    // one), never a second injected block.
    const fmEnd = after.indexOf('\n---\n', 4);
    const fm = after.slice(4, fmEnd);
    const tagsLines = fm.split('\n').filter((l) => /^tags\s*:/.test(l));
    expect(tagsLines.length).toBe(1);
  });
});

describe('backfill-solution-frontmatter — CRLF preservation around delimiters', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-crlf-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('preserves CRLF line endings around the `---` delimiters when input is CRLF', () => {
    // Regression for PR #278 round-2 thread 4: processEntry hardcoded `\n`
    // for the `---` delimiter newlines, which would mix LF delimiters into a
    // CRLF file. The fix detects the line ending from the original text and
    // uses it consistently.
    const dir = join(tmpRoot, 'logic-errors');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'crlf-entry.md');
    // Manually construct CRLF content (writeEntry uses LF).
    const crlf = (s: string) => s.replace(/\n/g, '\r\n');
    writeFileSync(
      filePath,
      crlf(`---\ntitle: 'CRLF Entry'\ncategory: logic-errors\ndate: 2026-04-29\ntags: [crlf]\n---\n\nBody.\n`),
      'utf8'
    );

    runScript(tmpRoot);

    const after = readFileSync(filePath, 'utf8');
    // Must NOT contain a bare LF newline anywhere — every newline in a CRLF
    // file is preceded by CR. Negative lookbehind catches LF at start-of-string
    // too (the `[^\r]` form would silently miss a leading bare LF).
    const bareLf = /(?<!\r)\n/;
    expect(after).not.toMatch(bareLf);
    // Frontmatter additions still applied (track derived).
    expect(after).toMatch(/track: bug/);
  });
});

describe('backfill-solution-frontmatter — error handling', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-backfill-err-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('records files without YAML frontmatter in the errors bucket and exits 1', () => {
    const dir = join(tmpRoot, 'workflow');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'no-frontmatter.md'),
      '# A title\n\nBody with no frontmatter at all.\n',
      'utf8'
    );

    const { status, stdout } = runScript(tmpRoot);

    expect(status).toBe(1);
    expect(stdout).toMatch(/errors:\s*1/);
    expect(stdout).toMatch(/no-frontmatter\.md.*missing YAML frontmatter/);
  });

  it('warns on root-level .md files without erroring', () => {
    writeFileSync(join(tmpRoot, 'README.md'), '# Top-level file\n', 'utf8');
    writeEntry(
      tmpRoot,
      'workflow',
      'real-entry',
      `title: 'Real'\ncategory: workflow\ndate: 2026-04-29\ntags: [w]`
    );

    const { status, stderr, stdout } = runScript(tmpRoot);

    expect(status).toBe(0);
    expect(stderr + stdout).toMatch(/skipping root-level file README\.md/);
  });
});

describe('backfill-solution-frontmatter — SOLUTIONS_DIR path-traversal guard', () => {
  it('refuses to operate on a path outside repo root and outside system temp', () => {
    // /var/lib (or /etc) is not under repo root or under os.tmpdir(); the
    // guard should reject before doing any filesystem work.
    const badDir = '/var/lib/backfill-test-should-not-exist';
    const { status, stderr } = runScript(badDir);

    expect(status).toBe(1);
    expect(stderr).toMatch(/SOLUTIONS_DIR resolves outside/);
  });
});
