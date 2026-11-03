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
  if (opts.baseRef !== undefined)
    env.VALIDATE_SOLUTIONS_BASE_REF = opts.baseRef;
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
    expect(stdout + stderr).toMatch(
      /expected docs\/solutions\/<category>\/<slug>\.md \(depth 4\)/
    );
  });
});

describe('validate-solutions — unicode path passes through (P1 regression test for -z parsing)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-unicode-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes a non-ASCII path through to slug validation (not silently dropped)', () => {
    // Without `-z` parsing, git would emit a quoted/escaped path for `café`
    // (`"docs/solutions/workflow/caf\\303\\251.md"`) and the later
    // startsWith('docs/solutions/') check would fail, silently bypassing the
    // validator. With `-z`, the path arrives verbatim and reaches the slug
    // regex check — which rejects `café` as a non-ASCII slug. The test pins
    // that the path was *seen* (SOL-002 emitted) rather than silently dropped
    // (exit 0). The VALIDATE_SOLUTIONS_DIFF injection bypasses git, so this
    // fixture exercises the post-parse contract; real-git -z parsing is
    // exercised in CI by any PR touching a non-ASCII filename.
    writeDoc(tmpRoot, 'workflow', 'café', validFrontmatter('café'));

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/café.md',
    });

    // Slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` rejects `é`, so validation runs
    // and emits SOL-002 — proving the path was not silently skipped.
    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-SOL-002/);
    expect(stdout + stderr).toMatch(/slug "café"/);
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

describe('validate-solutions — malformed YAML frontmatter (SOL-002)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-malformed-yaml-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('blocks a doc with an unclosed flow sequence in frontmatter (e.g. title: [broken)', () => {
    // The regex parser accepts `title: [broken` by capturing `[broken` as the
    // value; real YAML parsers reject it. This test pins that parseFrontmatter
    // now catches the unclosed bracket and emits ERROR-SOL-002.
    const dir = join(tmpRoot, 'workflow');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'bad-yaml.md'),
      '---\ntitle: [broken\ndate: 2026-05-21\ncategory: workflow\ntrack: knowledge\nproblem: p\ntags: [t]\n---\nBody.\n',
      'utf8'
    );

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/bad-yaml.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-SOL-002/);
    expect(stdout + stderr).toMatch(/malformed YAML/);
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

describe('validate-solutions — optional retire_when (SOL-002)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vs-retire-when-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const run = (extra: string) => {
    writeDoc(
      tmpRoot,
      'workflow',
      'retire-doc',
      `${validFrontmatter()}\n${extra}`
    );
    return runScript(tmpRoot, {
      diff: 'A\tdocs/solutions/workflow/retire-doc.md',
    });
  };

  it('passes a doc without retire_when', () => {
    expect(run('').status).toBe(0);
  });

  it('passes a single-line retire_when string', () => {
    const { status } = run(
      "retire_when: 'anthropics/claude-code issue closed as fixed in a released version; check the issue and release notes'"
    );
    expect(status).toBe(0);
  });

  it('passes a single-line retire_when followed by an indented comment', () => {
    const { status } = run('retire_when: upstream fix released\n  # note');
    expect(status).toBe(0);
  });

  it.each([
    ['a list', 'retire_when: [one, two]'],
    ['an empty value', 'retire_when:'],
    ['a blank string', "retire_when: '  '"],
    ['a number', 'retire_when: 3'],
    ['a literal block scalar', 'retire_when: |\n  line one\n  line two'],
    [
      'a stripped folded block scalar',
      'retire_when: >-\n  line one\n  line two',
    ],
    [
      'a plain scalar continued on the next line',
      'retire_when: line one\n  and line two',
    ],
    [
      'a quoted scalar continued on the next line',
      "retire_when: 'line one\n  and line two'",
    ],
    [
      'a folded block scalar under a quoted key',
      '"retire_when": >-\n  line one\n  line two',
    ],
  ])('blocks retire_when given %s', (_label, extra) => {
    const { status, stdout, stderr } = run(extra);
    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-SOL-002/);
    expect(stdout + stderr).toMatch(/retire_when/);
  });
});

// Claim grounding (SOL-003) runs against a throwaway git repo so path and
// commit checks have a real tree, history and base ref to resolve against.
describe('validate-solutions — claim grounding (SOL-003)', () => {
  let repo: string;
  let solutions: string;
  let realSha: string;

  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim();

  const commitAll = (msg: string) => {
    git('add', '-A');
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-q',
      '-m',
      msg
    );
  };

  const runClaims = (
    slug: string,
    body: string,
    opts: { status?: 'A' | 'M'; docMode?: boolean } = {}
  ): RunResult => {
    writeDoc(solutions, 'workflow', slug, validFrontmatter(slug), body);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SOLUTIONS_DIR: solutions,
      VALIDATE_SOLUTIONS_REPO_ROOT: repo,
      VALIDATE_SOLUTIONS_BASE_REF: 'main',
    };
    delete env.GITHUB_ACTIONS;
    const docPath = join(solutions, 'workflow', `${slug}.md`);
    const args = [SCRIPT];
    if (opts.docMode) args.push('--doc', docPath);
    else
      env.VALIDATE_SOLUTIONS_DIFF = `${opts.status ?? 'A'}\tdocs/solutions/workflow/${slug}.md`;
    const r = spawnSync('node', args, { env, encoding: 'utf8', cwd: repo });
    return {
      status: r.status ?? -1,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    };
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'yellow-vs-claims-'));
    solutions = join(repo, 'docs', 'solutions');
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    mkdirSync(join(repo, 'plugins', 'foo', 'lib'), { recursive: true });
    writeFileSync(join(repo, 'plugins', 'foo', 'real.md'), 'x\n');
    writeFileSync(join(repo, 'plugins', 'foo', 'lib', 'real.sh'), 'x\n');
    writeDoc(solutions, 'workflow', 'existing-doc', validFrontmatter());
    mkdirSync(join(solutions, 'archived', 'workflow'), { recursive: true });
    writeFileSync(
      join(solutions, 'archived', 'workflow', 'old-doc.md'),
      '---\ntitle: old\n---\n'
    );
    commitAll('seed');
    realSha = git('rev-parse', '--short=9', 'HEAD');
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('blocks a cited repo path that exists nowhere', () => {
    const r = runClaims(
      'bad-path',
      '\nSee `plugins/foo/bar.md` for the fix.\n'
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/ERROR-SOL-003.*plugins\/foo\/bar\.md/);
  });

  it('blocks a fabricated commit citation', () => {
    const r = runClaims('bad-sha', '\nThis was fixed in commit deadbeef1.\n');
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/ERROR-SOL-003.*deadbeef1/);
  });

  it('passes real paths, real commits, and doc-relative ../ paths', () => {
    const r = runClaims(
      'good-claims',
      [
        '',
        'See `plugins/foo/real.md` and `plugins/foo/real.md:12-20`.',
        `Landed in ${realSha}.`,
        'Relative: `../../../plugins/foo/real.md`.',
        'Plugin-relative: `lib/real.sh`.',
        '',
      ].join('\n')
    );
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('skips placeholders, identifiers and other repos', () => {
    const r = runClaims(
      'placeholders',
      [
        '',
        'Template: `path/to/file.md`, `<plugin>/agents/x.md`, `$ROOT/a/b.sh`.',
        'Branch `feat/` and model `anthropic/claude-sonnet`.',
        'Upstream pin EveryInc/compound-engineering-plugin@b405537 is external.',
        'Runtime `.claude/agents/foo.md` lives outside the repo.',
        '',
      ].join('\n')
    );
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('treats an uncued hex word as a note, not an error', () => {
    const r = runClaims(
      'hex-note',
      '\nThe digest 9f86d081884c and session a1b2c3d4e5 are ids.\n'
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/note: hex 9f86d081884c/);
  });

  it('masks code spans and fences before the scaffold check', () => {
    const ok = runClaims(
      'scaffold-ok',
      '\nUse `{{ secrets.TOKEN }}` here.\n\n```yaml\nx: {{ y }}\n```\n'
    );
    expect(ok.status).toBe(0);
    const bad = runClaims('scaffold-bad', '\nThe fix lives in {{FIX_PATH}}.\n');
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).toMatch(/ERROR-SOL-003.*\{\{FIX_PATH\}\}/);
  });

  it('masks a double-backtick code span as a whole', () => {
    const r = runClaims(
      'double-backtick',
      '\nExample ``x `{{VALUE}}` and `[a](./nope.md)` y`` here.\n'
    );
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('checks repo-owned dot-directories but skips machine-local ones', () => {
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    mkdirSync(join(repo, '.github'), { recursive: true });
    const bad = runClaims(
      'dot-dir',
      '\nSee `.claude-plugin/nonexistent.json` and `.github/nope.yml`.\n'
    );
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).toMatch(
      /\.claude-plugin\/nonexistent\.json/
    );
    expect(bad.stdout + bad.stderr).toMatch(/\.github\/nope\.yml/);
    const ok = runClaims(
      'dot-dir-local',
      '\nState in `.git/hooks/pre-push.sh` and `.ruvector/db.json`.\n'
    );
    expect(ok.stdout + ok.stderr).not.toMatch(/ERROR-SOL-003/);
  });

  it('downgrades a line marked (historical) to a warning', () => {
    const r = runClaims(
      'historical',
      '\nThe old `plugins/foo/gone.md` (historical) was removed by this fix.\n'
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/warning: path `plugins\/foo\/gone\.md`/);
  });

  it('blocks a broken relative link but only warns for an archived target', () => {
    const bad = runClaims('bad-link', '\nSee [x](./missing-doc.md).\n');
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).toMatch(/ERROR-SOL-003.*missing-doc/);
    const archived = runClaims('archived-link', '\nSee [old](./old-doc.md).\n');
    expect(archived.status).toBe(0);
    expect(archived.stderr).toMatch(/warning: link/);
  });

  it('treats a commit URL to another repo as external', () => {
    const r = runClaims(
      'external-url',
      [
        '',
        'Upstream fix: https://github.com/other/repo/commit/abc1234def.',
        'Also https://github.com/other/repo/commits/fed4321cba for history.',
        '',
      ].join('\n')
    );
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('ignores link-shaped code inside spans and fences', () => {
    const r = runClaims(
      'code-links',
      [
        '',
        'Dispatch with `handlers[type](event)`.',
        '',
        '```js',
        'const out = map[key](./not-a-link.md);',
        '```',
        '',
      ].join('\n')
    );
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('checks links that carry a title', () => {
    const r = runClaims(
      'titled-link',
      '\nSee [details](./missing-doc.md "Details").\n'
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/ERROR-SOL-003.*missing-doc/);
  });

  it('skips commit words inside fenced examples but checks inline spans', () => {
    const fenced = runClaims(
      'fenced-sha',
      '\n```bash\ngit revert deadbeef1\n```\n'
    );
    expect(fenced.stdout + fenced.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(fenced.status).toBe(0);
    const inline = runClaims(
      'inline-sha',
      '\nReverted in commit `deadbeef1`.\n'
    );
    expect(inline.status).toBe(1);
    expect(inline.stdout + inline.stderr).toMatch(/ERROR-SOL-003.*deadbeef1/);
  });

  it('does not excuse a live mention after a (historical) one', () => {
    const r = runClaims(
      'historical-then-live',
      '\nOld `plugins/foo/gone.md` (historical).\n\nNow use `plugins/foo/gone.md`.\n'
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(
      /ERROR-SOL-003.*plugins\/foo\/gone\.md/
    );
  });

  it('decodes percent-encoded link targets', () => {
    writeDoc(
      solutions,
      'workflow',
      'real-doc',
      validFrontmatter('real-doc'),
      '\nx\n'
    );
    const r = runClaims('encoded-link', '\nSee [doc](./real%2Ddoc.md).\n');
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('a baseline citation does not excuse a shorter new one inside it', () => {
    writeDoc(
      solutions,
      'workflow',
      'fragment',
      validFrontmatter('fragment'),
      '\nSee [a](../../missing/deep-doc.md).\n'
    );
    commitAll('add fragment');
    git('checkout', '-q', '-b', 'feature');
    const r = runClaims(
      'fragment',
      '\nSee [a](../../missing/deep-doc.md).\n\nAnd [b](deep-doc.md).\n',
      { status: 'M' }
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/ERROR-SOL-003.*\(deep-doc\.md\)/);
  });

  it('keeps the (historical) exemption for a titled link', () => {
    const r = runClaims(
      'titled-historical',
      '\nSee [old](./gone-doc.md "Old") (historical).\n'
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/warning: link/);
  });

  it('ignores backticked paths inside fenced examples', () => {
    const r = runClaims(
      'fenced-path',
      '\n```markdown\nSee `plugins/nonexistent/example.md`.\n```\n'
    );
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('does not let a (historical) commit excuse a later live one', () => {
    const r = runClaims(
      'historical-sha',
      '\nOld commit deadbeef1 (historical).\n\nNow fixed in commit deadbeef1.\n'
    );
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/ERROR-SOL-003.*deadbeef1/);
  });

  it('strips a query string from link targets', () => {
    writeDoc(
      solutions,
      'workflow',
      'query-doc',
      validFrontmatter('query-doc'),
      '\nx\n'
    );
    const r = runClaims('query-link', '\nSee [doc](./query-doc.md?plain=1).\n');
    expect(r.stdout + r.stderr).not.toMatch(/ERROR-SOL-003/);
    expect(r.status).toBe(0);
  });

  it('a fenced example does not decide a citation line', () => {
    const r = runClaims(
      'fence-then-historical',
      '\n```markdown\nSee `plugins/foo/gone.md`.\n```\n\nOld `plugins/foo/gone.md` (historical).\n'
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/warning: path `plugins\/foo\/gone\.md`/);
  });

  it('warns for a path that existed in history but was deleted', () => {
    rmSync(join(repo, 'plugins', 'foo', 'real.md'));
    commitAll('delete');
    const r = runClaims('deleted', '\nThe old `plugins/foo/real.md` file.\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/existed in git history/);
  });

  it('on a modified doc, only new ungrounded citations block', () => {
    writeDoc(
      solutions,
      'workflow',
      'amended',
      validFrontmatter('amended'),
      '\nOld stale `plugins/foo/stale.md`.\n'
    );
    commitAll('add amended');
    git('checkout', '-q', '-b', 'feature');
    const preExisting = runClaims(
      'amended',
      '\nOld stale `plugins/foo/stale.md`.\n\nNew section.\n',
      { status: 'M' }
    );
    expect(preExisting.status).toBe(0);
    expect(preExisting.stderr).toMatch(/pre-existing/);
    const added = runClaims(
      'amended',
      '\nOld stale `plugins/foo/stale.md`.\n\nNew `plugins/foo/new-bad.md`.\n',
      { status: 'M' }
    );
    expect(added.status).toBe(1);
    expect(added.stdout + added.stderr).toMatch(/new-bad\.md/);
  });

  it('--doc validates one doc without a diff', () => {
    const r = runClaims('doc-mode', '\nSee `plugins/foo/nope.md`.\n', {
      docMode: true,
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/ERROR-SOL-003.*nope\.md/);
  });
});
