/**
 * Integration tests for scripts/validate-jules.js, the drift check over the
 * units yellow-jules copies from yellow-cursor.
 *
 * Each negative case copies the live plugin sources into a temp fixture,
 * breaks one unit, and points the validator at it with VALIDATE_JULES_ROOT,
 * so the assertions exercise the real script end to end.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const VALIDATOR = join(REPO_ROOT, 'scripts', 'validate-jules.js');
const JULES_CODE = 'ERROR-' + 'JULES';

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidator(root?: string): Run {
  try {
    const stdout = execFileSync('node', [VALIDATOR], {
      env: {
        ...process.env,
        ...(root !== undefined ? { VALIDATE_JULES_ROOT: root } : {}),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const fixtures: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'validate-jules-'));
  fixtures.push(root);
  for (const plugin of ['yellow-cursor', 'yellow-jules']) {
    cpSync(
      join(REPO_ROOT, 'plugins', plugin, 'src'),
      join(root, 'plugins', plugin, 'src'),
      { recursive: true }
    );
  }
  return root;
}

function edit(
  root: string,
  relative: string,
  fn: (text: string) => string
): void {
  const full = join(root, relative);
  const before = readFileSync(full, 'utf8');
  const after = fn(before);
  if (after === before)
    throw new Error(`fixture edit did not apply to ${relative}`);
  writeFileSync(full, after, 'utf8');
}

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('validate-jules.js', () => {
  it('passes on the live repository', () => {
    const run = runValidator();
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('7 replica unit(s) match yellow-cursor');
  });

  it('passes a faithful fixture copy', () => {
    expect(runValidator(fixture()).status).toBe(0);
  });

  it('flags a behavioral change inside a unit as drift (-002)', () => {
    const root = fixture();
    edit(root, 'plugins/yellow-jules/src/validate.ts', (t) =>
      t.replace("if (input.startsWith('-')) {", "if (input.startsWith('--')) {")
    );
    const run = runValidator(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${JULES_CODE}-002`);
    expect(run.stderr).toContain('unit "validateRef"');
  });

  it('flags a change on the yellow-cursor side too', () => {
    const root = fixture();
    edit(root, 'plugins/yellow-cursor/src/redact.ts', (t) =>
      t.replace('out[key] = redactDeep(nested);', 'out[key] = nested;')
    );
    const run = runValidator(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unit "redactDeep"');
  });

  it('flags a missing marker pair (-001)', () => {
    const root = fixture();
    edit(root, 'plugins/yellow-jules/src/config.ts', (t) =>
      t.replace('// replica:resolveDataDir:end\n', '')
    );
    const run = runValidator(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${JULES_CODE}-001`);
    expect(run.stderr).toContain('resolveDataDir');
  });

  it('flags a duplicated marker (-001)', () => {
    const root = fixture();
    edit(
      root,
      'plugins/yellow-cursor/src/errors.ts',
      (t) => `${t}\n// replica:AppError:start\n`
    );
    const run = runValidator(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${JULES_CODE}-001`);
  });

  it('flags an unreadable source file (-001)', () => {
    const root = fixture();
    rmSync(join(root, 'plugins', 'yellow-jules', 'src', 'errors.ts'));
    const run = runValidator(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${JULES_CODE}-001`);
  });

  it('tolerates CRLF line endings and formatter line-folding', () => {
    const root = fixture();
    edit(root, 'plugins/yellow-jules/src/validate.ts', (t) =>
      t
        .replace(
          "return throwAppError('JULES_INVALID_INPUT', 'ref must be 1-255 characters');",
          "return throwAppError(\n      'JULES_INVALID_INPUT',\n      'ref must be 1-255 characters',\n    );"
        )
        .replace(/\n/g, '\r\n')
    );
    expect(runValidator(root).status).toBe(0);
  });

  it('applies the declared substitution map only', () => {
    const root = fixture();
    // A CURSOR name left behind in the jules copy is drift, not a substitution.
    edit(root, 'plugins/yellow-jules/src/validate.ts', (t) =>
      t.replace(
        "'JULES_INVALID_INPUT',\n      'idempotency key",
        "'CURSOR_INVALID_INPUT',\n      'idempotency key"
      )
    );
    const run = runValidator(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unit "validateIdempotencyKey"');
  });
});
