/**
 * Integration tests for `scripts/validate-plans.js`.
 *
 * Mirrors the fixture-tmpdir + synthetic-diff-injection pattern of
 * `tests/integration/validate-solutions.test.ts`:
 *   - Each describe builds a synthetic `plans/complete/` tree under
 *     `os.tmpdir()` and points the script at it via `PLANS_DIR`.
 *   - Diff input is injected via the `PLAN_VALIDATOR_DIFF` env var
 *     (newline-separated tab-delimited records matching
 *     `git diff --name-status` without `-z`), bypassing git so tests never
 *     depend on repo history.
 *
 * Covers the cases listed in `plans/plan-lifecycle-management.md` Task 1.3.
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
  'validate-plans.js'
);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface RunOpts {
  diff?: string;
  // Override the base ref. Setting an unreachable ref triggers the
  // soft-skip branch when no `diff` is injected.
  baseRef?: string;
  // Force GITHUB_ACTIONS=true to assert annotation formatting.
  ci?: boolean;
}

function runScript(plansDir: string, opts: RunOpts = {}): RunResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLANS_DIR: plansDir,
  };
  if (opts.diff !== undefined) env.PLAN_VALIDATOR_DIFF = opts.diff;
  if (opts.baseRef !== undefined) env.PLAN_VALIDATOR_BASE_REF = opts.baseRef;
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

function writePlan(
  plansDir: string,
  subdir: 'complete' | '',
  slug: string,
  body: string
): string {
  const dir = subdir ? join(plansDir, subdir) : plansDir;
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${slug}.md`);
  writeFileSync(filePath, body, 'utf8');
  return filePath;
}

const cleanBody = `# Feature: Clean plan

## Overview
All tasks completed.

## Implementation Plan
- [x] 1.1: Step one
- [x] 1.2: Step two
`;

const dirtyBody = `# Feature: Dirty plan

## Overview
One task left.

## Implementation Plan
- [x] 1.1: Step one
- [ ] 1.2: Step two not done
- [x] 1.3: Step three
`;

describe('validate-plans — stray-checkbox detection (ERROR-PLAN-001)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vp-stray-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('PASS: PR adds a clean archived plan with no stray boxes', () => {
    writePlan(tmpRoot, 'complete', 'clean-plan', cleanBody);

    const { status, stdout } = runScript(tmpRoot, {
      diff: 'A\tplans/complete/clean-plan.md',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/checked 1 file\(s\); 0 error\(s\)/);
  });

  it('FAIL: PR adds an archived plan with one stray `- [ ]`', () => {
    writePlan(tmpRoot, 'complete', 'dirty-plan', dirtyBody);

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'A\tplans/complete/dirty-plan.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-PLAN-001/);
    expect(stdout + stderr).toMatch(/dirty-plan\.md/);
    expect(stdout + stderr).toMatch(/unchecked task box/);
  });

  it('FAIL: PR modifies an existing archived plan to add stray boxes', () => {
    writePlan(tmpRoot, 'complete', 'modified-plan', dirtyBody);

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'M\tplans/complete/modified-plan.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-PLAN-001/);
  });

  it('PASS: PR touches only files outside plans/complete/', () => {
    writePlan(tmpRoot, '', 'open-plan', dirtyBody);

    const { status, stdout } = runScript(tmpRoot, {
      diff: 'M\tplans/open-plan.md\nA\tdocs/research/foo.md',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/no plans\/complete\/ changes in diff/);
  });

  it('PASS (core YAGNI behaviour): pre-existing dirty archived plan that the PR does NOT touch is ignored', () => {
    // Two pre-existing dirty plans, both with stray boxes.
    writePlan(tmpRoot, 'complete', 'untouched-legacy-1', dirtyBody);
    writePlan(tmpRoot, 'complete', 'untouched-legacy-2', dirtyBody);
    // The PR touches an unrelated open plan only.
    writePlan(tmpRoot, '', 'unrelated-open', cleanBody);

    const { status, stdout } = runScript(tmpRoot, {
      diff: 'M\tplans/unrelated-open.md',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/no plans\/complete\/ changes in diff/);
  });
});

describe('validate-plans — rename routing (R-record)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vp-rename-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('PASS: archival rename plans/<slug>.md → plans/complete/<slug>.md with a clean destination', () => {
    // The destination file (post-mv) is what's read.
    writePlan(tmpRoot, 'complete', 'archived-via-rename', cleanBody);

    const { status, stdout } = runScript(tmpRoot, {
      diff: 'R100\tplans/archived-via-rename.md\tplans/complete/archived-via-rename.md',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/checked 1 file\(s\); 0 error\(s\)/);
  });

  it('FAIL: archival rename with stray boxes in destination triggers ERROR-PLAN-001', () => {
    writePlan(tmpRoot, 'complete', 'archived-dirty', dirtyBody);

    const { status, stdout, stderr } = runScript(tmpRoot, {
      diff: 'R95\tplans/archived-dirty.md\tplans/complete/archived-dirty.md',
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toMatch(/ERROR-PLAN-001/);
    expect(stdout + stderr).toMatch(/archived-dirty\.md/);
  });
});

describe('validate-plans — soft-skip and edge cases', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-vp-skip-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('PASS (soft-skip): BASE_REF unreachable emits notice and exits 0', () => {
    // No PLAN_VALIDATOR_DIFF, force the git path. The base ref is bogus.
    const { status, stdout } = runScript(tmpRoot, {
      baseRef: 'refs/heads/this-ref-does-not-exist-anywhere-2026-05-28',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/cannot reach/);
    expect(stdout).toMatch(/skipping plan-archival validation/);
  });

  it('PASS (path-traversal): suspicious diff path is rejected silently with stderr warning', () => {
    // Even though the diff claims plans/complete/..., the normalized form
    // escapes the corpus directory. The entry is dropped; nothing to check.
    const { status, stderr, stdout } = runScript(tmpRoot, {
      diff: 'A\tplans/complete/../../../etc/sneaky.md',
    });

    expect(status).toBe(0);
    expect(stderr).toMatch(/rejecting suspicious diff path/);
    expect(stdout).toMatch(/no plans\/complete\/ changes in diff/);
  });

  it('PASS (empty diff): no diff records → notice, exit 0', () => {
    const { status, stdout } = runScript(tmpRoot, { diff: '' });

    expect(status).toBe(0);
    expect(stdout).toMatch(/no plans\/complete\/ changes in diff/);
  });

  it('PASS (D record): deletion of an archived plan is not flagged', () => {
    const { status, stdout } = runScript(tmpRoot, {
      diff: 'D\tplans/complete/removed-plan.md',
    });

    expect(status).toBe(0);
    expect(stdout).toMatch(/no plans\/complete\/ changes in diff/);
  });

  it('emits GHA annotation when GITHUB_ACTIONS=true', () => {
    writePlan(tmpRoot, 'complete', 'ci-annotated', dirtyBody);

    const { status, stdout } = runScript(tmpRoot, {
      diff: 'A\tplans/complete/ci-annotated.md',
      ci: true,
    });

    expect(status).toBe(1);
    expect(stdout).toMatch(
      /::error file=plans\/complete\/ci-annotated\.md,line=\d+::ERROR-PLAN-001:/
    );
  });
});
