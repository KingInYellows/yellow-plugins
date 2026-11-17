import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import YAML from 'yaml';

const REPO_ROOT = resolve(__dirname, '..', '..');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'linear-link.yml');

type Workflow = {
  jobs: { 'linear-link': { steps: Array<{ run?: string }> } };
};

const script = (YAML.parse(readFileSync(WORKFLOW, 'utf8')) as Workflow).jobs[
  'linear-link'
].steps.find((step) => step.run)?.run as string;

const workDir = mkdtempSync(join(tmpdir(), 'linear-link-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

let runCount = 0;
function runCheck(branch: string, title: string, body: string | null) {
  const summary = join(workDir, `summary-${runCount++}.md`);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    PR_BRANCH: branch,
    PR_TITLE: title,
    GITHUB_STEP_SUMMARY: summary,
  };
  if (body !== null) env.PR_BODY = body;
  const result = spawnSync('bash', ['-e', '-c', script], {
    env,
    encoding: 'utf8',
  });
  let summaryText = '';
  try {
    summaryText = readFileSync(summary, 'utf8');
  } catch {
    // No summary is written when a link is found.
  }
  return { ...result, summaryText };
}

// [name, branch, title, body, expect linked]
const CASES: Array<[string, string, string, string | null, boolean]> = [
  ['title only', 'feat/x', 'feat: thing (CLAUDE-123)', '', true],
  ['body only', 'feat/x', 'feat: thing', 'Fixes CLAUDE-45', true],
  [
    'body CLAUDE-NEW',
    'feat/x',
    'feat',
    '## Linear\n\nFixes CLAUDE-NEW\n',
    true,
  ],
  [
    'branch only, Linear lowercase',
    'me/claude-123-add-thing',
    'feat',
    '',
    true,
  ],
  ['branch only, uppercase', 'CLAUDE-77-thing', 'feat', '', true],
  ['CLAUDE-NEW in branch does not count', 'feat/CLAUDE-NEW', 'feat', '', false],
  [
    'CLAUDE-NEW in title does not count',
    'feat/x',
    'feat: CLAUDE-NEW',
    '',
    false,
  ],
  ['wrong team key', 'feat/x', 'fix: HML-12 thing', 'Fixes GOAL-3', false],
  ['lowercase key in title', 'feat/x', 'fix: claude-123 thing', '', false],
  ['lowercase key in body', 'feat/x', 'fix', 'Fixes claude-123', false],
  ['no reference', 'feat/x', 'fix: thing', '', false],
  ['no body at all', 'feat/x', 'fix: thing', null, false],
  ['no word boundary before', 'feat/x', 'XCLAUDE-12', 'MYCLAUDE-NEW', false],
  ['no word boundary after', 'feat/x', 'CLAUDE-12a', 'CLAUDE-NEWS', false],
  [
    'only inside an HTML comment',
    'feat/x',
    'fix',
    '<!-- Fixes CLAUDE-123 -->\n',
    false,
  ],
  [
    'reference after a multi-line comment',
    'feat/x',
    'fix',
    '<!--\nFixes CLAUDE-1\n-->\nRefs CLAUDE-9',
    true,
  ],
  [
    'unclosed comment hides reference',
    'feat/x',
    'fix',
    'text\n<!-- Fixes CLAUDE-123',
    false,
  ],
  [
    'reference before unclosed comment',
    'feat/x',
    'fix',
    'Fixes CLAUDE-5\n<!-- note',
    true,
  ],
  ['Ignore only', 'feat/x', 'fix', 'Ignore CLAUDE-123', false],
  ['ignore: CLAUDE-NEW', 'feat/x', 'fix', 'ignore: CLAUDE-NEW', false],
  [
    'Ignore plus Fixes',
    'feat/x',
    'fix',
    'Ignore CLAUDE-9\nFixes CLAUDE-10',
    true,
  ],
  [
    'branch ID ignored in body',
    'u/claude-123-change',
    'fix',
    'Ignore CLAUDE-123',
    false,
  ],
  [
    'branch ID, another ID ignored',
    'u/claude-123-change',
    'fix',
    'Ignore CLAUDE-9',
    true,
  ],
  [
    'title ID ignored in lowercase',
    'feat/x',
    'fix CLAUDE-5',
    'ignore claude-5',
    false,
  ],
  [
    'branch ID ignored, CLAUDE-NEW in body',
    'u/claude-123-x',
    'fix',
    'Ignore CLAUDE-123\nFixes CLAUDE-NEW',
    true,
  ],
  [
    'same ID fixed and ignored',
    'feat/x',
    'fix',
    'Fixes CLAUDE-8\nIgnore CLAUDE-8',
    false,
  ],
  [
    'adjacent branch IDs, first ignored',
    'dev/claude-123-claude-456',
    'fix',
    'Ignore CLAUDE-123',
    true,
  ],
  [
    'adjacent branch IDs, both ignored',
    'dev/claude-123-claude-456',
    'fix',
    'Ignore CLAUDE-123 Ignore CLAUDE-456',
    false,
  ],
  [
    'bare mention in description does not link',
    'feat/x',
    'fix',
    'Notes: CLAUDE-123',
    false,
  ],
  ['Part of links', 'feat/x', 'fix', 'Part of CLAUDE-3', true],
  ['Closes: with a colon links', 'feat/x', 'fix', 'Closes: CLAUDE-3', true],
  [
    'list after a magic word, first ignored',
    'feat/x',
    'fix',
    'Fixes CLAUDE-1, CLAUDE-2\nIgnore CLAUDE-1',
    true,
  ],
  ['magic word inside another word', 'feat/x', 'fix', 'prefix CLAUDE-3', false],
  [
    'list with a comma and "and"',
    'feat/x',
    'fix',
    'Fixes ENG-123, DES-5, and CLAUDE-256',
    true,
  ],
  [
    'Linear issue URL after a magic word',
    'feat/x',
    'fix',
    'Fixes https://linear.app/acme/issue/CLAUDE-123/some-title',
    true,
  ],
  [
    'bare Linear issue URL does not link',
    'feat/x',
    'fix',
    'See https://linear.app/acme/issue/CLAUDE-123/some-title',
    false,
  ],
  [
    'Skip works like Ignore',
    'u/claude-123-change',
    'fix',
    'Skip CLAUDE-123',
    false,
  ],
  ['Ignore across a newline', 'u/claude-5-x', 'fix', 'Ignore\nCLAUDE-5', false],
  [
    'large body, early reference',
    'feat/x',
    'fix',
    'Fixes CLAUDE-7\n' + `${'x'.repeat(200)}\n`.repeat(500),
    true,
  ],
];

describe('linear-link workflow script', () => {
  it('has a run script', () => {
    expect(script).toContain('set -euo pipefail');
  });

  it.each(CASES)('%s', (_name, branch, title, body, linked) => {
    const result = runCheck(branch, title, body);
    expect(result.status, result.stderr).toBe(0);
    if (linked) {
      expect(result.stdout).toContain('Linear link found');
    } else {
      expect(result.stdout).toContain('::warning title=Missing Linear issue::');
      expect(result.summaryText.startsWith('## Missing Linear issue')).toBe(
        true
      );
    }
  });

  // [name, branch, title, body, expected warning or null when it links]
  const NEW_CASES: Array<[string, string, string, string, string | null]> = [
    [
      'other team in branch',
      'u/eng-123-change',
      'fix',
      'Fixes CLAUDE-NEW',
      'ENG-123',
    ],
    [
      'other team in description',
      'feat/x',
      'fix',
      'Fixes ENG-9\nFixes CLAUDE-NEW',
      'ENG-9',
    ],
    [
      'other team ignored',
      'u/eng-123-change',
      'fix',
      'Ignore ENG-123\nFixes CLAUDE-NEW',
      null,
    ],
    [
      'bare key without a magic word',
      'feat/x',
      'fix',
      'Uses SHA-256\nFixes CLAUDE-NEW',
      null,
    ],
    [
      'numeric CLAUDE beats other team',
      'u/eng-1-x',
      'fix',
      'Fixes CLAUDE-7',
      null,
    ],
    ['non-Linear branch segment', 'deps/node', 'fix', 'Fixes CLAUDE-NEW', null],
  ];

  it.each(NEW_CASES)('CLAUDE-NEW: %s', (_name, branch, title, body, other) => {
    const result = runCheck(branch, title, body);
    expect(result.status, result.stderr).toBe(0);
    if (other === null) {
      expect(result.stdout).toContain('Linear link found');
    } else {
      expect(result.stdout).toContain(
        `::warning title=CLAUDE-NEW will not create an issue::This PR also references ${other},`
      );
      expect(result.summaryText).toContain(
        '## CLAUDE-NEW will not create an issue'
      );
    }
  });

  it('never executes PR fields', () => {
    const marker = join(workDir, 'pwned');
    const result = runCheck(
      `a$(touch ${marker})`,
      `\`touch ${marker}\`; CLAUDE-`,
      '"; exit 0; "'
    );
    expect(result.status).toBe(0);
    expect(spawnSync('test', ['-e', marker]).status).not.toBe(0);
  });
});
