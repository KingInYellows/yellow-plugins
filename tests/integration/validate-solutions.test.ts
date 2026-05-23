/**
 * Integration tests for `scripts/validate-solutions.js`.
 *
 * Mirrors the fixture-tmpdir pattern of
 * `tests/integration/backfill-solution-frontmatter.test.ts`:
 *   - Each describe builds a synthetic `docs/solutions/` tree under
 *     `os.tmpdir()` and points the script at it via `SOLUTIONS_DIR`.
 *   - Diff input is injected via the `VALIDATE_SOLUTIONS_DIFF` env var
 *     (newline-separated `A path` / `M path` lines), bypassing git so
 *     tests never depend on repo history.
 *
 * Covers the 9 fixture cases listed in
 * `plans/solution-doc-git-workflow.md` Phase 1.8.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const SCRIPT = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'validate-solutions.js'
);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface RunOpts {
  diff?: string;
  // Override the base ref. Setting an unreachable ref triggers the
  // soft-skip branch.
  baseRef?: string;
  // Force GITHUB_ACTIONS=true to assert annotation formatting.
  ci?: boolean;
}

function runScript(solutionsDir: string, opts: RunOpts = {}): RunResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SOLUTIONS_DIR: solutionsDir,
  };
  if (opts.diff !== undefined) env.VALIDATE_SOLUTIONS_DIFF = opts.diff;
  if (opts.baseRef !== undefined) env.VALIDATE_SOLUTIONS_BASE_REF = opts.baseRef;
  // Default CI to false; tests that want annotations opt in explicitly.
  if (opts.ci) env.GITHUB_ACTIONS = 'true';
  else delete env.GITHUB_ACTIONS;

  const result = spawnSync('node', [SCRIPT], { env, encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writeDoc(
  solutionsDir: string,
  category: string,
  slug: string,
  frontmatter: string,
  body = '\nBody.\n'
): string {
  const dir = join(solutionsDir, category);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${slug}.md`);
  writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}`, 'utf8');
  return filePath;
}

const validFrontmatter = (slug = 'sample-doc') =>
  [
    `title: 'Sample title for ${slug}'`,
    'date: 2026-05-21',
    'category: workflow',
    'track: knowledge',
    `problem: 'A one-line problem statement for ${slug}'`,
    'tags: [sample, test]',
  ].join('\n');

describe('validate-solutions — slug collision (SOL-001)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-collision-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('blocks an ADDED doc whose slug collides with an existing one in another category', () => {
    // Pre-existing doc in workflow/ with this slug.
    writeDoc(tmpRoot, 'workflow', 'collision-target', validFrontmatter());
    // New doc in code-quality/ with the SAME slug.
    writeDoc(tmpRoot, 'code-quality', 'collision-target', validFrontmatter());

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/code-quality/collision-target.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-SOL-001/);
    expect(stdout + stderr).toMatch(/collision-target/);
  });

  it('does NOT flag the existing doc when only its own path is in the diff (modify-self)', () => {
    writeDoc(tmpRoot, 'workflow', 'only-one', validFrontmatter());

    const { status } = runScript(tmpRoot, {
      diff: 'M\tdocs/solutions/workflow/only-one.md',
    });

    expect(status).toBe(0);
  });
});

describe('validate-solutions — missing required frontmatter (SOL-002)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-frontmatter-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('blocks an ADDED doc missing the `track` field', () => {
    writeDoc(
      tmpRoot,
      'workflow',
      'missing-track',
      [
        "title: 'Missing track field'",
        'date: 2026-05-21',
        'category: workflow',
        "problem: 'Track was forgotten'",
        'tags: [test]',
      ].join('\n')
    );

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/missing-track.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-SOL-002/);
    expect(stdout + stderr).toMatch(/missing required field: track/);
  });

  it('blocks an ADDED doc missing the `tags` field entirely', () => {
    writeDoc(
      tmpRoot,
      'workflow',
      'missing-tags',
      [
        "title: 'Missing tags'",
        'date: 2026-05-21',
        'category: workflow',
        'track: knowledge',
        "problem: 'No tags here'",
      ].join('\n')
    );

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/missing-tags.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/missing required field: tags/);
  });
});

describe('validate-solutions — invalid enum values (SOL-002)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-enum-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('blocks a doc with an invalid `track:` value', () => {
    writeDoc(
      tmpRoot,
      'workflow',
      'bad-track',
      [
        "title: 'Bad track value'",
        'date: 2026-05-21',
        'category: workflow',
        'track: feature',
        "problem: 'Track must be bug or knowledge'",
        'tags: [test]',
      ].join('\n')
    );

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/bad-track.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/invalid track "feature"/);
  });

  it('blocks a doc with an invalid `category:` value', () => {
    // Note: category in frontmatter is what's validated; the on-disk
    // directory still has to be one we created.
    writeDoc(
      tmpRoot,
      'workflow',
      'bad-category-fm',
      [
        "title: 'Bad category in frontmatter'",
        'date: 2026-05-21',
        'category: bugs',
        'track: bug',
        "problem: 'Category must be one of the 6'",
        'tags: [test]',
      ].join('\n')
    );

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/bad-category-fm.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/invalid category "bugs"/);
  });
});

describe('validate-solutions — slug regex', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-slug-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('blocks an ADDED doc with a trailing-hyphen slug', () => {
    writeDoc(tmpRoot, 'workflow', 'trailing-hyphen-', validFrontmatter());

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/trailing-hyphen-.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/slug "trailing-hyphen-" must match/);
  });

  it('blocks an ADDED doc with uppercase characters in slug', () => {
    writeDoc(tmpRoot, 'workflow', 'BadSlug', validFrontmatter());

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/BadSlug.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/slug "BadSlug" must match/);
  });
});

describe('validate-solutions — happy path', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-happy-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes when an ADDED doc has valid frontmatter and a unique slug', () => {
    writeDoc(tmpRoot, 'code-quality', 'unique-new-doc', validFrontmatter());

    const { status, stdout } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/code-quality/unique-new-doc.md',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/checked 1 file/);
  });
});

describe('validate-solutions — modified (not added) skips collision check', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-modified-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does not run collision check on M (modify) entries, only on A (add)', () => {
    // Two pre-existing docs with the same slug in different categories — a
    // historical artifact we do not want to break on every unrelated edit.
    writeDoc(tmpRoot, 'workflow', 'historic-clone', validFrontmatter());
    writeDoc(tmpRoot, 'code-quality', 'historic-clone', validFrontmatter());

    // Modifying one of them must not trigger a collision error.
    const { status } = runScript(tmpRoot, {
      diff: 'M\tdocs/solutions/workflow/historic-clone.md',
    });

    expect(status).toBe(0);
  });
});

describe('validate-solutions — empty diff exits 0', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-empty-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exits 0 with a notice when no docs/solutions/ files are in the diff', () => {
    writeDoc(tmpRoot, 'workflow', 'unrelated', validFrontmatter());

    const { status, stdout } = runScript(tmpRoot, { diff: '' });

    expect(status).toBe(0);
    expect(stdout).toMatch(/no docs\/solutions\/ changes/);
  });
});

describe('validate-solutions — origin/main unreachable soft-skip', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-soft-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exits 0 when the base ref does not exist (fork PR / shallow clone)', () => {
    // No VALIDATE_SOLUTIONS_DIFF override → real git diff. Use a base ref
    // that is guaranteed not to exist.
    const { status, stdout } = runScript(tmpRoot, {
      baseRef: 'refs/heads/this-ref-does-not-exist-anywhere',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/cannot reach/);
  });
});

describe('validate-solutions — parseFrontmatter no-trailing-newline', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-eof-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('parses a doc whose closing --- has no trailing newline (P1 regression test)', () => {
    // Some editors (vim default, certain CRLF normalizers) strip the
    // trailing newline. Before the fix, the regex required `\r?\n---\r?\n`
    // and would emit a false SOL-002 'missing YAML frontmatter block'.
    const dir = join(tmpRoot, 'workflow');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'no-trailing-newline.md'),
      `---\n${validFrontmatter()}\n---`, // no \n after closing ---
      'utf8'
    );

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/no-trailing-newline.md',
    });

    expect(status).toBe(0);
    expect(stdout + stderr).not.toMatch(/missing YAML frontmatter block/);
  });
});

describe('validate-solutions — nested path depth rejection (P2 regression test)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-depth-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('rejects a diff entry with more than 4 path segments (nested subdirectory)', () => {
    // docs/solutions/workflow/nested/doc.md has 5 segments — deeper than the
    // required docs/solutions/<category>/<slug>.md layout. Before the fix,
    // segments.length < 4 silently skipped these; now they emit ERROR-SOL-002
    // so the gap is visible instead of a quiet bypass.
    const nestedDir = join(tmpRoot, 'workflow', 'nested');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(nestedDir, 'doc.md'),
      `---\n${validFrontmatter('doc')}\n---\nBody.\n`,
      'utf8'
    );

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/nested/doc.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-SOL-002/);
    expect(stdout + stderr).toMatch(/expected docs\/solutions\/<category>\/<slug>\.md \(depth 4\)/);
  });
});

describe('validate-solutions — path-traversal rejection (P1 regression test)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-traversal-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('rejects a diff entry attempting docs/solutions/../../etc/passwd-style traversal', () => {
    // Use a .md suffix so the entry passes the early file-type filter and
    // reaches the path-traversal guard. Before the fix,
    // startsWith('docs/solutions/') passed and path.join resolved the
    // traversal segments outside the corpus root.
    const { status, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/../../../etc/sneaky.md',
    });

    expect(status).toBe(0);
    expect(stderr).toMatch(/rejecting suspicious diff path/);
  });
});

describe('validate-solutions — GitHub Actions annotation format', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-gha-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('emits ::error file=...:: annotations when GITHUB_ACTIONS=true', () => {
    writeDoc(
      tmpRoot,
      'workflow',
      'missing-title',
      [
        'date: 2026-05-21',
        'category: workflow',
        'track: knowledge',
        "problem: 'missing title'",
        'tags: [t]',
      ].join('\n')
    );

    const { status, stdout } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/missing-title.md',
      ci: true,
    });

    expect(status).toBe(1);
    expect(stdout).toMatch(
      /::error file=docs\/solutions\/workflow\/missing-title\.md::ERROR-SOL-002/
    );
  });
});
