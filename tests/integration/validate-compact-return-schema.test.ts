/**
 * Integration test for `scripts/validate-compact-return-schema.js`.
 *
 * Fixture roots hold a canonical pr-review-workflow SKILL.md plus persona
 * copies; VALIDATE_COMPACT_RETURN_ROOT points the validator at them so the
 * real repo is never touched. One test also runs it against the repo itself.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const VALIDATOR = join(
  REPO_ROOT,
  'scripts',
  'validate-compact-return-schema.js'
);
const CANONICAL = 'plugins/yellow-review/skills/pr-review-workflow/SKILL.md';
const PERSONA = 'plugins/yellow-review/agents/review/example-reviewer.md';

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(root?: string): Run {
  const env = { ...process.env };
  if (root) env.VALIDATE_COMPACT_RETURN_ROOT = root;
  else delete env.VALIDATE_COMPACT_RETURN_ROOT;
  try {
    const stdout = execFileSync('node', [VALIDATOR], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const NOTES = [
  '`line` must be an integer.',
  '',
  '`residual_risks` and `testing_gaps` are always empty arrays.',
].join('\n');

interface Finding {
  [key: string]: unknown;
}

function finding(overrides: Finding = {}): Finding {
  return {
    title: '<short actionable summary>',
    severity: 'P0|P1|P2|P3',
    category: '<reviewer category>',
    rule: '<slug from the injected rule-vocabulary>',
    scope: '<enclosing dotted symbol path or nearest markdown heading>',
    file: '<repo-relative path>',
    line: 42,
    confidence: 75,
    autofix_class: 'safe_auto|gated_auto|manual|advisory',
    owner: 'review-fixer|downstream-resolver|human|release',
    requires_verification: true,
    pre_existing: false,
    suggested_fix: '<one-sentence concrete fix or null>',
    ...overrides,
  };
}

function schemaJson(reviewer: string, f: Finding): string {
  return JSON.stringify(
    { reviewer, findings: [f], residual_risks: [], testing_gaps: [] },
    null,
    2
  );
}

function schemaBlock(json: string, fence = 'json'): string {
  return [
    '<!-- compact-return-schema:begin -->',
    '',
    '```' + fence,
    json,
    '```',
    '',
    '<!-- compact-return-schema:end -->',
  ].join('\n');
}

function notesBlock(text = NOTES): string {
  return [
    '<!-- compact-return-notes:begin -->',
    '',
    text,
    '',
    '<!-- compact-return-notes:end -->',
  ].join('\n');
}

function write(root: string, rel: string, body: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function persona(
  f: Finding = finding({ category: 'example' }),
  notes = NOTES
): string {
  return [
    '# Example reviewer',
    '',
    schemaBlock(schemaJson('example', f)),
    '',
    notesBlock(notes),
    '',
  ].join('\n');
}

describe('validate-compact-return-schema', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'yellow-compact-return-'));
    write(
      root,
      CANONICAL,
      [
        '## Finding Output Format',
        '',
        schemaBlock(schemaJson('<name>', finding())),
        '',
        notesBlock(),
        '',
      ].join('\n')
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes on the real repository', () => {
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('passes a persona that narrows enums, fills placeholders and adds extensions', () => {
    write(
      root,
      PERSONA,
      persona(
        finding({
          title: 'Concise one-line title',
          severity: 'P1|P2|P3',
          category: 'example',
          file: 'path/to/file',
          confidence: 100,
          autofix_class: 'advisory',
          owner: 'human',
          requires_verification: false,
          principle: '1|2|3',
        })
      )
    );
    expect(run(root).status).toBe(0);
  });

  it('accepts a jsonc fence with // comment lines', () => {
    const json = schemaJson('example', finding()).replace(
      '"title"',
      '// base fields\n      "title"'
    );
    write(root, PERSONA, `${schemaBlock(json, 'jsonc')}\n\n${notesBlock()}\n`);
    expect(run(root).status).toBe(0);
  });

  it('fails an unmarked schema copy', () => {
    write(
      root,
      PERSONA,
      '```json\n' + schemaJson('example', finding()) + '\n```\n'
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /example-reviewer\.md: line 1: compact-return schema copy is not wrapped/
    );
  });

  it('fails a missing base key', () => {
    const f = finding();
    delete f.scope;
    write(root, PERSONA, persona(f));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /finding keys must start with the canonical keys in order/
    );
  });

  it('fails an extension key placed before suggested_fix', () => {
    const { suggested_fix, ...rest } = finding();
    write(root, PERSONA, persona({ ...rest, extra: 'x', suggested_fix }));
    expect(run(root).stderr).toMatch(
      /finding keys must start with the canonical keys/
    );
  });

  it('fails an enum value outside the canonical set', () => {
    write(root, PERSONA, persona(finding({ severity: 'P1|P4' })));
    expect(run(root).stderr).toMatch(
      /finding\.severity lists values outside the canonical set.*P4/
    );
  });

  it('fails a changed value type', () => {
    write(root, PERSONA, persona(finding({ line: '42' })));
    expect(run(root).stderr).toMatch(
      /finding\.line must be integer, found string/
    );
  });

  it('fails a drifted rule placeholder', () => {
    write(root, PERSONA, persona(finding({ rule: '<rule slug>' })));
    expect(run(root).stderr).toMatch(/finding\.rule placeholder must read/);
  });

  it('fails a confidence example that is not a rubric anchor', () => {
    write(root, PERSONA, persona(finding({ confidence: 80 })));
    expect(run(root).stderr).toMatch(/rubric anchor/);
  });

  it('fails populated aggregator buckets', () => {
    const json = schemaJson('example', finding()).replace(
      '"residual_risks": []',
      '"residual_risks": ["x"]'
    );
    write(root, PERSONA, `${schemaBlock(json)}\n\n${notesBlock()}\n`);
    expect(run(root).stderr).toMatch(/residual_risks must be an empty array/);
  });

  it('fails drifted notes', () => {
    write(
      root,
      PERSONA,
      persona(undefined, NOTES.replace('integer', 'number'))
    );
    expect(run(root).stderr).toMatch(
      /notes block differs from the canonical one/
    );
  });

  it('fails an agent copy with no notes block', () => {
    write(root, PERSONA, schemaBlock(schemaJson('example', finding())) + '\n');
    expect(run(root).stderr).toMatch(/persona carries a schema copy but no/);
  });

  it('does not require notes in a skill copy', () => {
    write(
      root,
      'plugins/yellow-review/skills/example/SKILL.md',
      schemaBlock(schemaJson('example', finding())) + '\n'
    );
    expect(run(root).status).toBe(0);
  });

  it('fails when the canonical markers are missing', () => {
    write(root, CANONICAL, '## Finding Output Format\n');
    expect(run(root).stderr).toMatch(/canonical file must carry both/);
  });
});
